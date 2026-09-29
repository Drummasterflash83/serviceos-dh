// Service-only dispatcher. Configure a verified Slack webhook per workspace.
// At-least-once delivery; durable IDs in messages help identify rare retry duplicates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeCall, record } from "../_shared/receptionist-data.ts";
import { practiceCallMatches } from "../_shared/receptionist-web-call.ts";
import {
  notificationEvent,
  OPENFOLK_TEAM,
  SlackRejected,
  verifySlackChannel,
  sendSlackMessage,
} from "../_shared/notification-slack.ts";
const slackText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
Deno.serve(async (req) => {
  const secret = Deno.env.get("CLIENT_NOTIFICATION_DISPATCH_SECRET");
  if (req.method !== "POST" || !secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return new Response("Unauthorized", { status: 401 });
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: jobs, error } = await db.rpc("claim_client_notifications");
  if (error) return new Response("Queue unavailable", { status: 500 });
  let sent = 0;
  for (const job of jobs ?? []) {
    let posting = false;
    try {
      const { data: w } = await db
        .from("receptionist_workspaces")
        .select("company,name,slack_secret_name,vapi_secret_name")
        .eq("tenant_id", job.tenant_id)
        .single();
      if (!w) throw new Error("Notification workspace unavailable");
      const receptionist = job.source_type === "receptionist_feedback";
      const feedback = receptionist
        ? await db
            .from("receptionist_feedback")
            .select("practice_session_id,call_id,title,body,status,response")
            .eq("tenant_id", job.tenant_id)
            .eq("id", job.source_id)
            .maybeSingle()
        : null;
      if (feedback?.error) throw new Error("Feedback context unavailable");
      if (receptionist && !feedback?.data) throw new Error("Feedback context unavailable");
      let route = job.notification_route;
      if (!route) {
        const event = notificationEvent(
          job.source_type,
          job.priority,
          Boolean(feedback?.data?.practice_session_id),
        );
        if (!event) throw new Error("Notification type unavailable");
        const configured = await db
          .from("operator_notification_routes")
          .select("team_id,channel_id,channel_name,version")
          .eq("tenant_id", job.tenant_id)
          .eq("event_key", event)
          .maybeSingle();
        if (configured.error) throw new Error("Notification route unavailable");
        route = configured.data
          ? { mode: "bot", event, ...configured.data }
          : { mode: "legacy", event };
        const pinned = await db
          .from("client_notification_outbox")
          .update({ notification_route: route, slack_phase: "prepared" })
          .eq("id", job.id)
          .is("notification_route", null)
          .select("id");
        if (pinned.error || pinned.data?.length !== 1)
          throw new Error("Notification route could not be pinned");
      }
      let practiceTranscript = "";
      if (receptionist && feedback?.data?.practice_session_id) {
        const { data: session, error: sessionError } = await db
          .from("receptionist_practice_sessions")
          .select("id,call_id")
          .eq("tenant_id", job.tenant_id)
          .eq("id", feedback.data.practice_session_id)
          .maybeSingle();
        if (sessionError || !session || session.call_id !== feedback.data.call_id)
          throw new Error("Practice report binding unavailable");
        const key = Deno.env.get(w.vapi_secret_name);
        if (!key) throw new Error("Practice provider unavailable");
        const response = await fetch(`https://api.vapi.ai/call/${session.call_id}`, {
          headers: { Authorization: `Bearer ${key}` },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("Practice call unavailable");
        const call = record(await response.json());
        if (!practiceCallMatches(call, session.id, job.tenant_id))
          throw new Error("Practice call scope mismatch");
        const completed = normalizeCall(call);
        if (completed.status !== "ended") throw new Error("Practice call still processing");
        practiceTranscript = completed.transcript ?? "Transcript not supplied by Vapi.";
      }
      const label = receptionist
        ? `${w.name}: ${feedback?.data?.practice_session_id ? "Practice & improve feedback" : "receptionist feedback"}`
        : job.source_type === "programme_updated"
          ? "Client programme updated"
          : "Client programme feedback";
      const url = receptionist
        ? `https://app.openfolk.ai/openfolk/${job.tenant_id}?module=receptionist&view=improvements&tools=false`
        : `https://app.openfolk.ai/client?tenant=${job.tenant_id}`;
      const header = `${job.priority.toUpperCase()} · ${w.company}\n${label}\n${url}\nReference: ${job.source_id} · revision ${job.source_version}`;
      const report =
        receptionist && feedback?.data
          ? `\n\n${slackText(feedback.data.title)}\nStatus: ${slackText(feedback.data.status ?? "New")}${feedback.data.response ? `\nOpenFolk update: ${slackText(feedback.data.response)}` : ""}\n\nCustomer feedback\n${slackText(feedback.data.body)}${practiceTranscript ? `\n\nConversation transcript\n${slackText(practiceTranscript)}` : ""}`
          : "";
      const text =
        header +
        (report.length <= 30000
          ? report
          : "\n\nFull report is too long for this Slack message. Open the private workspace link to review it.");
      let receipt: { channel: string; ts: string } | null = null;
      if (route.mode === "bot") {
        if (route.team_id !== OPENFOLK_TEAM) throw new Error("Notification workspace mismatch");
        const secret = await db.rpc("notification_slack_token");
        if (secret.error || typeof secret.data !== "string")
          throw new Error("Slack bot connection unavailable");
        await verifySlackChannel(secret.data, route.channel_id);
        const began = await db
          .from("client_notification_outbox")
          .update({ slack_phase: "posting" })
          .eq("id", job.id)
          .eq("slack_phase", "prepared")
          .select("id");
        if (began.error || began.data?.length !== 1)
          throw new Error("Notification send could not be reserved");
        posting = true;
        receipt = await sendSlackMessage(secret.data, route.channel_id, text, job.id);
      } else if (route.mode === "legacy") {
        const webhook = w.slack_secret_name ? Deno.env.get(w.slack_secret_name) : null;
        if (!webhook) throw new Error("Slack delivery not configured");
        const parsed = new URL(webhook);
        if (parsed.protocol !== "https:" || parsed.hostname !== "hooks.slack.com")
          throw new Error("Invalid Slack destination");
        const response = await fetch(webhook, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok || (await response.text()).trim() !== "ok")
          throw new Error("Slack did not confirm delivery");
      } else throw new Error("Notification route unavailable");
      const saved = await db
        .from("client_notification_outbox")
        .update({
          state: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
          slack_phase: "confirmed",
          slack_channel: receipt?.channel ?? null,
          slack_ts: receipt?.ts ?? null,
        })
        .eq("id", job.id);
      if (saved.error) throw new Error("Delivery receipt not saved");
      sent++;
    } catch (e) {
      const uncertain = posting && !(e instanceof SlackRejected);
      await db
        .from("client_notification_outbox")
        .update({
          state: "failed",
          slack_phase: uncertain ? "uncertain" : "prepared",
          last_error: uncertain
            ? "Slack delivery needs review before retrying; it may already have arrived."
            : "Delivery not confirmed. Check the configured destination and provider connection.",
          available_at: new Date(
            Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000,
          ).toISOString(),
        })
        .eq("id", job.id);
    }
  }
  return Response.json({ sent, processed: jobs?.length ?? 0 });
});
