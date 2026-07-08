// ServiceOS — Edge Function: phone-scheduled-sync (Scheduled Phone Sync)
//
// Keeps the live Calls & Comms feed current WITHOUT a human clicking the Admin
// sync buttons. Intended to run on a cron (every 5 minutes). It does NOT talk to
// Simwood directly or duplicate any business logic — it INVOKES the existing,
// already-idempotent functions server-to-server:
//   * simwood-sync-calls        → recent call history
//   * simwood-sync-recordings   → recent recording metadata (which itself
//                                 auto-triggers the Phase-5A enrichment pipeline
//                                 for genuinely-new recordings only).
//
// Auth: NOT a user session. A shared secret header `x-schedule-secret` must match
// the PHONE_SCHEDULE_SECRET env var, else 403. Sibling functions are invoked with
// the service-role key as bearer (see the internal path in _shared/authz.ts).
//
// Cost safety: syncs a short rolling window only; never forces re-download,
// re-transcription or re-analysis. Overlap between runs is safe because every
// upsert is idempotent.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false (cron
// has no JWT; the schedule secret is the gate) — see supabase/config.toml.

import { createSupabaseAdmin, PROVIDER } from "../_shared/simwood.ts";
import { invokeFunction } from "../_shared/phone_pipeline.ts";

// TODO(integration): move tenant + provider_customer_id to per-tenant
// integration config once provider connections are stored per tenant.
const SCHEDULED_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const PROVIDER_CUSTOMER_ID = "3950";

// Rolling window: 10 minutes with a 5-minute cron → ~5 minutes of overlap.
// Overlap is safe because all upserts are idempotent.
const WINDOW_MINUTES = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-schedule-secret",
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

/** Pull a numeric records_processed out of a child function's JSON response. */
function recordsOf(jsonBody: Record<string, unknown> | null): number {
  const v = jsonBody?.records_processed;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function syncRunIdOf(jsonBody: Record<string, unknown> | null): string | null {
  const v = jsonBody?.sync_run_id;
  return typeof v === "string" ? v : null;
}

function errorCodeOf(jsonBody: Record<string, unknown> | null, status: number): string {
  const err = (jsonBody?.error ?? {}) as { code?: unknown };
  return typeof err.code === "string" ? err.code : `http_${status || "network"}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  // --- shared-secret gate (NOT callable by ordinary users) -----------------
  const expected = Deno.env.get("PHONE_SCHEDULE_SECRET");
  if (!expected) return fail("config_error", "PHONE_SCHEDULE_SECRET is not configured", 500);
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createSupabaseAdmin();
  if (!serviceKey || !supabase) {
    return fail("config_error", "Supabase admin client is not configured", 500);
  }

  const tenantId = SCHEDULED_TENANT_ID;
  const nowIso = new Date().toISOString();
  const from = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const to = nowIso;

  const baseMetadata: Record<string, unknown> = {
    window_minutes: WINDOW_MINUTES,
    from,
    to,
    provider_customer_id: PROVIDER_CUSTOMER_ID,
  };

  // Open a scheduled_sync run so every tick is auditable even on mid-run failure.
  const { data: runRow, error: runErr } = await supabase
    .from("phone_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "scheduled_sync",
      status: "running",
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (runErr || !runRow) {
    return fail("db_error", "Could not open a scheduled sync run", 500);
  }
  const syncRunId = runRow.id as string;

  const childBody = {
    tenant_id: tenantId,
    provider_customer_id: PROVIDER_CUSTOMER_ID,
    from,
    to,
  };

  // 1) Calls — invoke the existing idempotent function (service-role internal).
  const callsRes = await invokeFunction("simwood-sync-calls", childBody, serviceKey);
  const callsOk = Boolean(callsRes.json?.success);
  const callsProcessed = recordsOf(callsRes.json);

  // 2) Recordings — this also auto-triggers Phase-5A enrichment for NEW
  //    recordings (never forces re-download / re-transcribe / re-analyse).
  const recRes = await invokeFunction("simwood-sync-recordings", childBody, serviceKey);
  const recOk = Boolean(recRes.json?.success);
  const recProcessed = recordsOf(recRes.json);

  const errors: Record<string, string> = {};
  if (!callsOk) errors.calls = errorCodeOf(callsRes.json, callsRes.status);
  if (!recOk) errors.recordings = errorCodeOf(recRes.json, recRes.status);
  const overallOk = callsOk && recOk;

  const metadata = {
    ...baseMetadata,
    calls_sync_run_id: syncRunIdOf(callsRes.json),
    recordings_sync_run_id: syncRunIdOf(recRes.json),
    calls_processed: callsProcessed,
    recordings_processed: recProcessed,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };

  await supabase
    .from("phone_sync_runs")
    .update({
      status: overallOk ? "success" : "failed",
      completed_at: new Date().toISOString(),
      records_processed: callsProcessed + recProcessed,
      error_message: overallOk ? null : JSON.stringify(errors),
      metadata,
    })
    .eq("id", syncRunId);

  return json({
    success: overallOk,
    calls_processed: callsProcessed,
    recordings_processed: recProcessed,
    sync_run_id: syncRunId,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  });
});
