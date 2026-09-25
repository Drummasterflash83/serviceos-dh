// Service-only dispatcher. Configure a verified Slack webhook per workspace.
// At-least-once delivery; durable IDs in messages help identify rare retry duplicates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeCall, record } from "../_shared/receptionist-data.ts";
import { practiceCallMatches } from "../_shared/receptionist-web-call.ts";
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
    try {
      const { data: w } = await db
        .from("receptionist_workspaces")
        .select("company,name,slack_secret_name,vapi_secret_name")
        .eq("tenant_id", job.tenant_id)
        .single();
      const webhook = w?.slack_secret_name ? Deno.env.get(w.slack_secret_name) : null;
      if (!w || !webhook) throw new Error("Slack delivery not configured");
      const parsed = new URL(webhook);
      if (parsed.protocol !== "https:" || parsed.hostname !== "hooks.slack.com")
        throw new Error("Invalid Slack destination");
      const receptionist = job.source_type === "receptionist_feedback";
      const feedback = receptionist
        ? await db
            .from("receptionist_feedback")
            .select("practice_session_id,call_id,title,body")
            .eq("tenant_id", job.tenant_id)
            .eq("id", job.source_id)
            .maybeSingle()
        : null;
      if (feedback?.error) throw new Error("Feedback context unavailable");
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
      const url = `https://app.openfolk.ai/${receptionist ? "receptionist" : "client"}?tenant=${job.tenant_id}${receptionist ? "&view=improvements" : ""}`;
      const header = `${job.priority.toUpperCase()} · ${w.company}\n${label}\n${url}\nReference: ${job.source_id} · revision ${job.source_version}`;
      const report =
        receptionist && feedback?.data
          ? `\n\n${slackText(feedback.data.title)}\n${slackText(feedback.data.body)}${practiceTranscript ? `\n\nConversation transcript\n${slackText(practiceTranscript)}` : ""}`
          : "";
      const text =
        header +
        (report.length <= 30000
          ? report
          : "\n\nFull report is too long for this Slack message. Open the private workspace link to review it.");
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Slack did not confirm delivery");
      const saved = await db
        .from("client_notification_outbox")
        .update({ state: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", job.id);
      if (saved.error) throw new Error("Delivery receipt not saved");
      sent++;
    } catch (e) {
      await db
        .from("client_notification_outbox")
        .update({
          state: "failed",
          last_error: e instanceof Error ? e.message : "Delivery failed",
          available_at: new Date(
            Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000,
          ).toISOString(),
        })
        .eq("id", job.id);
    }
  }
  return Response.json({ sent, processed: jobs?.length ?? 0 });
});
