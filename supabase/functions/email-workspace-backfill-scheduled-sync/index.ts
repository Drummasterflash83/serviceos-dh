// ServiceOS — Edge Function: email-workspace-backfill-scheduled-sync (queue-driven)
//
// ENQUEUES one lower-priority `email.workspace_backfill` job per mailbox whose
// backfill is in progress, then returns fast. Backfill is bounded, resumable and
// LOWER priority than live sync (higher priority number → claimed after live
// jobs), so historical import never blocks new mail. It never AUTO-STARTS a
// backfill — an admin starts one; this only continues running ones. Every 15 min.
//
// Auth: `x-schedule-secret` must match EMAIL_WORKSPACE_BACKFILL_SECRET, else 403.
// Deploy with verify_jwt=false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/platform_queue.ts";

const PROVIDER = "gmail";
// Bounded per tick so a large backfill drains gradually without flooding the queue.
const MAX_MAILBOXES = 5;
// Lower than the default live-sync priority (100) — claimed after live work.
const BACKFILL_PRIORITY = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-schedule-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
function fail(code: string, message: string, status: number): Response {
  return json({ success: false, error: { code, message } }, status);
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const expected = Deno.env.get("EMAIL_WORKSPACE_BACKFILL_SECRET");
  if (!expected) {
    return fail("config_error", "EMAIL_WORKSPACE_BACKFILL_SECRET is not configured", 500);
  }
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) return fail("forbidden", "Invalid or missing secret", 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // Mailboxes with an in-progress backfill, oldest-touched first (no starvation).
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("id, tenant_id")
    .eq("provider", PROVIDER)
    .in("status", ["pending_tokenless_dwd", "active_dwd"])
    .eq("backfill_status", "running")
    .order("updated_at", { ascending: true })
    .limit(MAX_MAILBOXES);
  if (error) return fail("db_error", "Could not list backfill mailboxes", 500);

  let queued = 0;
  let duplicates = 0;
  for (const acc of accounts ?? []) {
    const r = await enqueueJob(supabase, {
      tenantId: acc.tenant_id as string,
      jobType: "email.workspace_backfill",
      jobKey: `email.workspace_backfill:${acc.id}`,
      connectorId: "google-workspace",
      moduleId: "communications.email",
      priority: BACKFILL_PRIORITY,
      payload: { email_account_id: acc.id },
    });
    if (r.duplicate) duplicates += 1;
    else if (r.id) queued += 1;
  }

  // Scheduler-acceptance HEARTBEAT per configured Workspace tenant — backfill is
  // idle most of the time (admin-initiated), and an idle tick is HEALTHY, not
  // stale. Heartbeat every tenant with a Workspace connection so scheduler-health
  // ('workspace_backfill_scheduled') is truthful even with zero running backfills.
  const { data: conns } = await supabase
    .from("google_workspace_connections")
    .select("tenant_id")
    .neq("status", "disabled");
  const tenantIds = Array.from(
    new Set(((conns ?? []) as { tenant_id: string }[]).map((c) => c.tenant_id)),
  );
  const hbIso = new Date().toISOString();
  for (const tid of tenantIds) {
    await supabase.from("email_sync_runs").insert({
      tenant_id: tid,
      provider: PROVIDER,
      sync_type: "workspace_backfill_scheduled",
      status: "success",
      started_at: hbIso,
      completed_at: hbIso,
      records_processed: queued,
      metadata: { heartbeat: true, running_backfills_enqueued: queued },
    });
  }

  return json({ success: true, mailboxes: (accounts ?? []).length, queued, duplicates });
});
