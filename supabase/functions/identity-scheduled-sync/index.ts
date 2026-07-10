// ServiceOS — Edge Function: identity-scheduled-sync
//
// Runs the Identity Resolution Engine automatically. On a cron (NO user session)
// it invokes `identity-resolve` server-to-server for every operational tenant,
// enriching pending interactions into identity/cards/recommendations. Idempotent,
// failure-isolated per tenant. Manual "Resolve now" is a recovery override.
//
// Auth: a shared secret header `x-schedule-secret` must match IDENTITY_SYNC_SECRET,
// else 403 (same model as the other scheduled functions). No secrets logged.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { enqueueJob } from "../_shared/platform_queue.ts";

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

  const expected = Deno.env.get("IDENTITY_SYNC_SECRET");
  if (!expected) return fail("config_error", "IDENTITY_SYNC_SECRET is not configured", 500);
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createSupabaseAdmin();
  if (!serviceKey || !supabase) {
    return fail("config_error", "Supabase admin client is not configured", 500);
  }

  const { data: connectors, error: connErr } = await supabase
    .from("tenant_connectors")
    .select("tenant_id")
    .eq("enabled", true);
  if (connErr) return fail("db_error", "Could not read tenant_connectors", 500);

  const tenantIds = Array.from(
    new Set(((connectors ?? []) as { tenant_id: string }[]).map((c) => c.tenant_id)),
  );
  if (tenantIds.length === 0) return json({ success: true, tenants: 0, results: [] });

  // ENQUEUE + return fast — the platform-worker claims and runs identity-resolve
  // asynchronously (job_key matches identity-resolve's own, so the worker's run
  // owns the single job row). No heavy work in this request.
  let queued = 0;
  let duplicates = 0;
  for (const tenantId of tenantIds) {
    const r = await enqueueJob(supabase, {
      tenantId,
      jobType: "identity.resolve",
      jobKey: `identity.resolve:${tenantId}`,
      connectorId: "openfolk-core",
      moduleId: "core.identity",
    });
    if (r.duplicate) duplicates += 1;
    else if (r.id) queued += 1;
  }

  return json({ success: true, tenants: tenantIds.length, queued, duplicates });
});
