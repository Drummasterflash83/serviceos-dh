// ServiceOS — Edge Function: phone-processing-scheduled-sync
//
// Drains the phone-processing backlog on a cron, with NO user session. For every
// enabled Simwood tenant it invokes `phone-process-pending` server-to-server (the
// internal service path), which runs the idempotent download → transcribe →
// analyse pipeline for a safe batch. Missed ticks simply resume next run; one
// failing tenant never aborts the others.
//
// Auth: NOT a user session. A shared secret header `x-schedule-secret` must match
// PHONE_PROCESSING_SECRET, else 403 (same model as phone-scheduled-sync). No
// secrets are logged.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { invokeFunction } from "../_shared/phone_pipeline.ts";

const CONNECTOR_ID = "simwood";

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

  const expected = Deno.env.get("PHONE_PROCESSING_SECRET");
  if (!expected) return fail("config_error", "PHONE_PROCESSING_SECRET is not configured", 500);
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
    .eq("connector_id", CONNECTOR_ID)
    .eq("enabled", true);
  if (connErr) return fail("db_error", "Could not read tenant_connectors", 500);

  const tenantIds = Array.from(
    new Set(((connectors ?? []) as { tenant_id: string }[]).map((c) => c.tenant_id)),
  );
  if (tenantIds.length === 0) return json({ success: true, tenants: 0, results: [] });

  const results: Array<Record<string, unknown>> = [];
  for (const tenantId of tenantIds) {
    const res = await invokeFunction("phone-process-pending", { tenant_id: tenantId }, serviceKey);
    const j = res.json;
    results.push({
      tenant_id: tenantId,
      ok: Boolean(j?.success),
      processed: typeof j?.processed === "number" ? j.processed : 0,
      downloaded: typeof j?.downloaded === "number" ? j.downloaded : 0,
      transcribed: typeof j?.transcribed === "number" ? j.transcribed : 0,
      analysed: typeof j?.analysed === "number" ? j.analysed : 0,
      failed: typeof j?.failed === "number" ? j.failed : 0,
      skipped: typeof j?.skipped === "number" ? j.skipped : 0,
    });
  }

  return json({ success: results.every((r) => r.ok === true), tenants: results.length, results });
});
