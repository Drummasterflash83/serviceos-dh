// ServiceOS — Edge Function: email-workspace-scheduled-sync (Workspace DWD, queue-driven)
//
// ENQUEUES one `email.workspace_sync` job per enabled DWD mailbox plus a
// throttled `email.mailbox_discovery` job per tenant, then returns fast. The
// platform-worker runs them asynchronously, so a slow/failing mailbox never
// blocks the scheduler or the tenant. Runs every 5 minutes. Multi-tenant.
//
// Auth: `x-schedule-secret` must match EMAIL_WORKSPACE_SCHEDULE_SECRET, else 403.
// Deploy with verify_jwt=false (cron has no JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/platform_queue.ts";

const PROVIDER = "gmail";
const DWD_STATUSES = ["pending_tokenless_dwd", "active_dwd"];
const MAX_RESULTS = 25;
// Re-discover at most this often (avoids a Directory list every single tick).
const DISCOVERY_MIN_INTERVAL_MS = 15 * 60 * 1000;

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

  const expected = Deno.env.get("EMAIL_WORKSPACE_SCHEDULE_SECRET");
  if (!expected) {
    return fail("config_error", "EMAIL_WORKSPACE_SCHEDULE_SECRET is not configured", 500);
  }
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) return fail("forbidden", "Invalid or missing secret", 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // 1) Enqueue a discovery job per configured Workspace tenant (throttled) so
  //    mailboxes stay current WITHOUT anyone clicking "Discover".
  const { data: conns } = await supabase
    .from("google_workspace_connections")
    .select("tenant_id")
    .neq("status", "disabled");
  const tenantIds = Array.from(
    new Set(((conns ?? []) as { tenant_id: string }[]).map((c) => c.tenant_id)),
  );
  let discoveryQueued = 0;
  const nowMs = Date.now();
  for (const tenantId of tenantIds) {
    // Throttle: skip if a discovery succeeded within the interval.
    const { data: lastDisc } = await supabase
      .from("email_sync_runs")
      .select("completed_at")
      .eq("tenant_id", tenantId)
      .eq("sync_type", "workspace_discover")
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastMs = lastDisc?.completed_at ? Date.parse(lastDisc.completed_at as string) : 0;
    if (lastMs && nowMs - lastMs < DISCOVERY_MIN_INTERVAL_MS) continue;
    const r = await enqueueJob(supabase, {
      tenantId,
      jobType: "email.mailbox_discovery",
      jobKey: `email.mailbox_discovery:${tenantId}`,
      connectorId: "google-workspace",
      moduleId: "communications.email",
    });
    if (r.id && !r.duplicate) discoveryQueued += 1;
  }

  // 2) Enqueue one live-sync job per enabled DWD mailbox across all tenants.
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("id, tenant_id")
    .eq("provider", PROVIDER)
    .in("status", DWD_STATUSES);
  if (error) return fail("db_error", "Could not list DWD mailboxes", 500);

  let queued = 0;
  let duplicates = 0;
  for (const acc of accounts ?? []) {
    const r = await enqueueJob(supabase, {
      tenantId: acc.tenant_id as string,
      jobType: "email.workspace_sync",
      jobKey: `email.workspace_sync:${acc.id}`,
      connectorId: "google-workspace",
      moduleId: "communications.email",
      payload: { email_account_id: acc.id, max_results: MAX_RESULTS },
    });
    if (r.duplicate) duplicates += 1;
    else if (r.id) queued += 1;
  }

  return json({
    success: true,
    mailboxes: (accounts ?? []).length,
    queued,
    duplicates,
    discovery_queued: discoveryQueued,
  });
});
