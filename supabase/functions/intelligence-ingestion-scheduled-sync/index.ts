// ServiceOS — Edge Function: intelligence-ingestion-scheduled-sync
//
// The activation of the intelligence loop. On a cron it finds ENRICHED interactions that
// have not yet been through the intelligence bridge (via intelligence_select_uningested)
// and enqueues one idempotent `intelligence.ingest_interaction` job per interaction. The
// worker runs the existing bridge: eligibility decision → ledger claim → intelligence.observe
// → intelligence_objects. This is what makes calls & emails become intelligence automatically.
//
// It NEVER evaluates decisions or creates intents itself — it only ENQUEUES; the bridge +
// observe engine + approval + automation layers are unchanged. Exactly-once is guaranteed by
// the ledger claim + the deterministic observe job key, so re-enqueuing is always safe.
//
// Auth: NOT a user session. `x-schedule-secret` must match INTELLIGENCE_INGEST_SECRET.
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { enqueueJob } from "../_shared/platform_queue.ts";
import { MAPPER_VERSION } from "../_shared/observation_ingest.ts";

const PER_TENANT_LIMIT = 25; // bounded per tick — self-heals over successive runs.

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

  const expected = Deno.env.get("INTELLIGENCE_INGEST_SECRET");
  if (!expected) return fail("config_error", "INTELLIGENCE_INGEST_SECRET is not configured", 500);
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createSupabaseAdmin();
  if (!serviceKey || !supabase) {
    return fail("config_error", "Supabase admin client is not configured", 500);
  }

  // Operational tenants = those with any enabled connector (same scope as the other scans).
  const { data: connectors, error: connErr } = await supabase
    .from("tenant_connectors")
    .select("tenant_id")
    .eq("enabled", true);
  if (connErr) return fail("db_error", "Could not read tenant_connectors", 500);
  const tenantIds = Array.from(
    new Set(((connectors ?? []) as { tenant_id: string }[]).map((c) => c.tenant_id)),
  );
  if (tenantIds.length === 0) return json({ success: true, tenants: 0, queued: 0, duplicates: 0 });

  let queued = 0;
  let duplicates = 0;
  let candidates = 0;
  for (const tenantId of tenantIds) {
    const { data: ids, error } = await supabase.rpc("intelligence_select_uningested", {
      p_tenant: tenantId,
      p_mapper_version: MAPPER_VERSION,
      p_limit: PER_TENANT_LIMIT,
    });
    if (error) continue; // one failing tenant never aborts the others
    for (const row of (ids ?? []) as { interaction_id: string }[]) {
      candidates += 1;
      // One idempotent job per interaction: the ledger + observe key guarantee exactly-once,
      // so a stable per-interaction key never drops or collides across ticks.
      const r = await enqueueJob(supabase, {
        tenantId,
        jobType: "intelligence.ingest_interaction",
        jobKey: `intelligence.ingest_interaction:${tenantId}:${row.interaction_id}`,
        connectorId: "openfolk-core",
        moduleId: "core.intelligence",
        payload: { interaction_id: row.interaction_id },
      });
      if (r.duplicate) duplicates += 1;
      else if (r.id) queued += 1;
    }
  }

  return json({ success: true, tenants: tenantIds.length, candidates, queued, duplicates });
});
