// ServiceOS — Edge Function: email-scheduled-sync (OAuth Gmail, queue-driven)
//
// ENQUEUES one `email.gmail_sync` job per connected OAuth mailbox and returns
// fast — the platform-worker claims and runs the heavy sync asynchronously, so a
// slow/failing mailbox never blocks the scheduler or the other mailboxes. Runs on
// a cron every 5 minutes. Multi-tenant: every tenant with an active OAuth Gmail
// account is covered (no hardcoded tenant).
//
// Auth: NOT a user session. `x-schedule-secret` must match EMAIL_SCHEDULE_SECRET,
// else 403. Tokens are never touched here. Deploy with verify_jwt=false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/platform_queue.ts";
import {
  emptySchedulerCounts,
  recordSchedulerHeartbeat,
  scheduleAndCount,
} from "../_shared/email_scheduler_health.ts";
import type { SchedulerCounts } from "../_shared/email_scheduler_health.ts";

const PROVIDER = "gmail";
const MAX_RESULTS = 25;

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

  const expected = Deno.env.get("EMAIL_SCHEDULE_SECRET");
  if (!expected) return fail("config_error", "EMAIL_SCHEDULE_SECRET is not configured", 500);
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) return fail("forbidden", "Invalid or missing secret", 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // Active OAuth Gmail mailboxes across ALL tenants (DWD accounts are handled by
  // email-workspace-scheduled-sync and are excluded by status here).
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("id, tenant_id, auth_state")
    .eq("provider", PROVIDER)
    .eq("status", "active");
  if (error) return fail("db_error", "Could not list Gmail accounts", 500);

  let skippedAuthRequired = 0;
  // Per-tenant tallies so each tenant gets a truthful scheduler heartbeat.
  const perTenant = new Map<string, SchedulerCounts & { skippedAuthRequired: number }>();
  for (const acc of accounts ?? []) {
    const tid = acc.tenant_id as string;
    const t = perTenant.get(tid) ?? { ...emptySchedulerCounts(), skippedAuthRequired: 0 };
    perTenant.set(tid, t);
    // Match the capture engine's OAuth admission. A revoked/expired connection
    // needs reconnection, not a fresh doomed job on every scheduler tick. Keep a
    // scheduler heartbeat even when all this tenant's accounts need attention.
    if (!["ok", "unknown"].includes(acc.auth_state)) {
      skippedAuthRequired += 1;
      t.skippedAuthRequired += 1;
      continue;
    }
    await scheduleAndCount(
      supabase,
      {
        tenantId: tid,
        jobType: "email.gmail_sync",
        jobKey: `email.gmail_sync:${acc.id}`,
        connectorId: "gmail",
        moduleId: "communications.email",
        payload: { email_account_id: acc.id, max_results: MAX_RESULTS },
      },
      t,
      enqueueJob,
    );
    perTenant.set(tid, t);
  }

  // This proves scheduling only, never completed email capture. Paused work is
  // explicit; an uncertain queue or heartbeat write cannot claim success.
  let heartbeatConfirmed = true;
  for (const [tid, counts] of perTenant) {
    if (
      !(await recordSchedulerHeartbeat(supabase, tid, "scheduled_sync", counts, {
        skipped_auth_required: counts.skippedAuthRequired,
      }))
    )
      heartbeatConfirmed = false;
  }
  if (!heartbeatConfirmed)
    return fail(
      "heartbeat_unconfirmed",
      "Scheduler results could not be recorded. Check queued jobs before retrying.",
      503,
    );
  const totals = [...perTenant.values()].reduce(
    (all, c) => ({
      queued: all.queued + c.queued,
      duplicates: all.duplicates + c.duplicates,
      paused: all.paused + c.paused,
      unconfirmed: all.unconfirmed + c.unconfirmed,
    }),
    emptySchedulerCounts(),
  );
  if (totals.unconfirmed)
    return fail(
      "enqueue_unconfirmed",
      "Some scheduling results are uncertain. Check queued jobs before retrying.",
      503,
    );

  return json({
    success: true,
    accounts: (accounts ?? []).length,
    queued: totals.queued,
    duplicates: totals.duplicates,
    capture_paused: totals.paused,
    skipped_auth_required: skippedAuthRequired,
  });
});
