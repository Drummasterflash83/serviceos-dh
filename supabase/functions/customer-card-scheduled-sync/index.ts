// ServiceOS — Edge Function: customer-card-scheduled-sync
//
// Keeps Customer Card projections current automatically. On a cron (NO user
// session) it invokes `customer-card-sync` server-to-server for every operational
// tenant, re-projecting the Business Graph into customer_cards.context. Runs AFTER
// the graph — the graph never waits on cards; cards subscribe to it. Idempotent,
// failure-isolated per tenant. Manual "Build cards" is a recovery override.
//
// Auth: a shared secret header `x-schedule-secret` must match CARD_SYNC_SECRET,
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

/** Constant-time-ish string compare (avoids trivial timing leaks on the secret). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const expected = Deno.env.get("CARD_SYNC_SECRET");
  if (!expected) return fail("config_error", "CARD_SYNC_SECRET is not configured", 500);
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

  // ENQUEUE + return fast — the platform-worker claims and runs customer-card-sync
  // asynchronously (matching job_key ⇒ the worker's run owns the single job row).
  let queued = 0;
  let duplicates = 0;
  for (const tenantId of tenantIds) {
    const r = await enqueueJob(supabase, {
      tenantId,
      jobType: "customer_card.sync",
      jobKey: `customer_card.sync:${tenantId}`,
      connectorId: "openfolk-core",
      moduleId: "core.customer_card",
    });
    if (r.duplicate) duplicates += 1;
    else if (r.id) queued += 1;
  }

  return json({ success: true, tenants: tenantIds.length, queued, duplicates });
});
