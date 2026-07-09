// ServiceOS — Edge Function: interactions-scheduled-sync (automatic signal build)
//
// Keeps the canonical `interactions` timeline current WITHOUT a user pressing
// "Build timeline". On a cron it invokes `interactions-sync` server-to-server for
// every operational tenant, projecting recent phone_calls + email_messages into
// signals. Idempotent (upsert keyed by source row), non-destructive, and one
// failing tenant never aborts the others.
//
// This is what makes signal-building AUTOMATIC by default; the manual "Build /
// refresh" button becomes a recovery/override tool.
//
// Auth: NOT a user session. A shared secret header `x-schedule-secret` must match
// SIGNAL_SYNC_SECRET, else 403 (same model as phone-scheduled-sync). No secrets
// are logged.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { invokeFunction } from "../_shared/phone_pipeline.ts";

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

  const expected = Deno.env.get("SIGNAL_SYNC_SECRET");
  if (!expected) return fail("config_error", "SIGNAL_SYNC_SECRET is not configured", 500);
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createSupabaseAdmin();
  if (!serviceKey || !supabase) {
    return fail("config_error", "Supabase admin client is not configured", 500);
  }

  // Operational tenants = those with any enabled connector.
  const { data: connectors, error: connErr } = await supabase
    .from("tenant_connectors")
    .select("tenant_id")
    .eq("enabled", true);
  if (connErr) return fail("db_error", "Could not read tenant_connectors", 500);

  const tenantIds = Array.from(
    new Set(((connectors ?? []) as { tenant_id: string }[]).map((c) => c.tenant_id)),
  );
  if (tenantIds.length === 0) return json({ success: true, tenants: 0, results: [] });

  const results: Array<Record<string, unknown>> = [];
  for (const tenantId of tenantIds) {
    const res = await invokeFunction(
      "interactions-sync",
      { tenant_id: tenantId, source: "all" },
      serviceKey,
    );
    const j = res.json;
    results.push({
      tenant_id: tenantId,
      ok: Boolean(j?.success),
      interactions_upserted:
        typeof j?.interactions_upserted === "number" ? j.interactions_upserted : 0,
    });
  }

  return json({ success: results.every((r) => r.ok === true), tenants: results.length, results });
});
