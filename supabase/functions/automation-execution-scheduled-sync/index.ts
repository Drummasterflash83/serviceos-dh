// ServiceOS — Edge Function: automation-execution-scheduled-sync (repair scanner).
//
// The bounded REPAIR/RECOVERY path for the Universal Automation Engine. On a cron it:
//   1. reclaims abandoned leases — a stuck 'claimed' (never executed) is released to
//      'pending'; a stuck 'executing' (result unknown) is parked as 'unknown' for a
//      status lookup / review — NEVER blindly re-executed;
//   2. expires overdue intents (pending/failed past expires_at);
//   3. enqueues eligible pending intents (and within-budget failed intents) that have
//      no active job, so manual/SQL-created or lost-retry intents still execute.
// It NEVER executes here. It is cross-tenant infrastructure (like platform-worker), so
// it authenticates with a shared secret, NOT a user session.
//
// Auth: shared secret header `x-schedule-secret` == AUTOMATION_EXEC_SECRET.
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.
//
// Scale note: v1 uses bounded batches; the idempotent enqueue + the atomic claim in the
// handler keep repeats safe. Cron wiring is a documented deploy step (not wired here).

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { enqueueAutomationExecution } from "../_shared/automation_execution_enqueue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-schedule-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX = 500;

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

  const expected = Deno.env.get("AUTOMATION_EXEC_SECRET");
  if (!expected) return fail("config_error", "AUTOMATION_EXEC_SECRET is not configured", 500);
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const db = createSupabaseAdmin();
  if (!serviceKey || !db)
    return fail("config_error", "Supabase admin client is not configured", 500);

  const now = new Date().toISOString();
  let reclaimedExecuting = 0;
  let releasedClaims = 0;
  let expired = 0;
  let queued = 0;
  let duplicates = 0;

  // 1) reclaim abandoned leases.
  const { data: stuckExecuting } = await db
    .from("automation_intents")
    .update({ status: "unknown", lease_expires_at: null, decided_at: now })
    .eq("status", "executing")
    .lt("lease_expires_at", now)
    .select("id");
  reclaimedExecuting = (stuckExecuting ?? []).length;

  const { data: stuckClaimed } = await db
    .from("automation_intents")
    .update({ status: "pending", lease_expires_at: null, claimed_by: null, decided_at: now })
    .eq("status", "claimed")
    .lt("lease_expires_at", now)
    .select("id");
  releasedClaims = (stuckClaimed ?? []).length;

  // 2) expire overdue intents (pending or failed, past their validity window).
  const { data: expiredRows } = await db
    .from("automation_intents")
    .update({ status: "expired", lease_expires_at: null, decided_at: now })
    .in("status", ["pending", "failed"])
    .lt("expires_at", now)
    .select("id");
  expired = (expiredRows ?? []).length;

  // 3) enqueue eligible pending / within-budget failed intents (idempotent).
  const { data: eligible } = await db
    .from("automation_intents")
    .select("id, tenant_id, status, attempts, max_attempts")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(MAX);
  for (const row of (eligible ?? []) as Array<Record<string, unknown>>) {
    // A failed intent only re-enqueues while it still has retry budget.
    if (row.status === "failed" && (row.attempts as number) >= (row.max_attempts as number))
      continue;
    const r = await enqueueAutomationExecution(db, {
      tenantId: row.tenant_id as string,
      automationIntentId: row.id as string,
      triggeredBy: "repair",
    });
    if (r.duplicate) duplicates += 1;
    else if (r.id) queued += 1;
  }

  return json({ success: true, reclaimedExecuting, releasedClaims, expired, queued, duplicates });
});
