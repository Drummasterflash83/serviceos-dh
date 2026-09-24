// Service-only dispatcher. Configure a verified Slack webhook per workspace.
// At-least-once delivery; durable IDs in messages help identify rare retry duplicates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
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
        .select("company,name,slack_secret_name")
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
            .select("practice_session_id,call_id")
            .eq("tenant_id", job.tenant_id)
            .eq("id", job.source_id)
            .maybeSingle()
        : null;
      if (feedback?.error) throw new Error("Feedback context unavailable");
      const label = receptionist
        ? `${w.name}: ${feedback?.data?.practice_session_id ? "Practice & improve feedback" : "receptionist feedback"}`
        : job.source_type === "programme_updated"
          ? "Client programme updated"
          : "Client programme feedback";
      const url = `https://app.openfolk.ai/${receptionist ? "receptionist" : "client"}?tenant=${job.tenant_id}${receptionist ? "&view=improvements" : ""}`;
      const text = `${job.priority.toUpperCase()} · ${w.company}\n${label} is ready for review in OpenFolk.\n${url}\nReference: ${job.source_id} · revision ${job.source_version}`;
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
