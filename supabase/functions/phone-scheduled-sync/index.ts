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
// TENANT-AWARE + CURSOR-BASED (Operational Truth phase): instead of a hardcoded
// tenant + customer id + fixed 10-minute wall-clock window, it now iterates every
// ENABLED Simwood account in `connector_accounts` (joined via `tenant_connectors`)
// and syncs each from its durable cursor (`sync_cursor.last_synced_until`) with a
// safety overlap. If a cron tick is missed, the cursor simply stays put, so the
// next run backfills the gap — no calls are permanently skipped. First-ever run
// for an account (no cursor) defaults to the last 24 hours.
//
// Auth: NOT a user session. A shared secret header `x-schedule-secret` must match
// the PHONE_SCHEDULE_SECRET env var, else 403. Sibling functions are invoked with
// the service-role key as bearer (see the internal path in _shared/authz.ts).
//
// Cost safety: overlap re-fetch is safe because every upsert is idempotent; the
// child call-sync function hard-caps paging.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false (cron
// has no JWT; the schedule secret is the gate) — see supabase/config.toml.

import { createSupabaseAdmin, PROVIDER } from "../_shared/simwood.ts";
import { invokeFunction } from "../_shared/phone_pipeline.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";

const CONNECTOR_ID = "simwood";
// Safety overlap re-synced on every run so a call landing on a window boundary is
// never missed. Idempotent upserts make the overlap free of duplicates.
const OVERLAP_MINUTES = 15;
// First run for an account with no cursor: look back this far.
const DEFAULT_LOOKBACK_HOURS = 24;

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

interface AccountRow {
  id: string;
  tenant_id: string;
  account_key: string;
  settings: Record<string, unknown> | null;
  sync_cursor: Record<string, unknown> | null;
  last_successful_sync_at: string | null;
}

/** Resolve the provider customer id for an account: settings override, else key. */
function customerIdOf(row: AccountRow): string {
  const fromSettings = row.settings?.provider_customer_id;
  return typeof fromSettings === "string" && fromSettings.trim() !== ""
    ? fromSettings
    : row.account_key;
}

/** Compute the [from, to] sync window from the account's durable cursor. */
function windowFor(row: AccountRow, nowMs: number): { from: string; to: string } {
  const cursorRaw = row.sync_cursor?.last_synced_until;
  const cursor = typeof cursorRaw === "string" ? cursorRaw : (row.last_successful_sync_at ?? null);
  const cursorMs = cursor ? Date.parse(cursor) : NaN;
  const fromMs = Number.isFinite(cursorMs)
    ? cursorMs - OVERLAP_MINUTES * 60 * 1000
    : nowMs - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000;
  return { from: new Date(fromMs).toISOString(), to: new Date(nowMs).toISOString() };
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

  // 1) Find every ENABLED Simwood connector (service-role read; bypasses RLS).
  const { data: connectors, error: connErr } = await supabase
    .from("tenant_connectors")
    .select("id, tenant_id")
    .eq("connector_id", CONNECTOR_ID)
    .eq("enabled", true);
  if (connErr) return fail("db_error", "Could not read tenant_connectors", 500);

  const connectorRows = (connectors ?? []) as { id: string; tenant_id: string }[];
  if (connectorRows.length === 0) {
    // Nothing configured — a healthy no-op (do not invent work).
    return json({ success: true, accounts: 0, results: [] });
  }

  const nowMs = Date.now();
  const results: Array<Record<string, unknown>> = [];

  // 2) For each connector, sync each active account from its own cursor.
  for (const connector of connectorRows) {
    const { data: accounts, error: acctErr } = await supabase
      .from("connector_accounts")
      .select("id, tenant_id, account_key, settings, sync_cursor, last_successful_sync_at")
      .eq("tenant_connector_id", connector.id)
      .eq("status", "active");
    if (acctErr) {
      results.push({ tenant_connector_id: connector.id, ok: false, error: "accounts_read_failed" });
      continue; // never abort the whole run on one connector
    }

    for (const account of (accounts ?? []) as AccountRow[]) {
      const tenantId = account.tenant_id;
      const customerId = customerIdOf(account);
      const { from, to } = windowFor(account, nowMs);

      const baseMetadata: Record<string, unknown> = {
        connector_account_id: account.id,
        provider_customer_id: customerId,
        from,
        to,
        overlap_minutes: OVERLAP_MINUTES,
      };

      // Durable platform job (supplements phone_sync_runs). Best-effort: a
      // duplicate active job for this account this minute → don't double-track,
      // but always run the (idempotent) sync. No secrets in the payload.
      const created = await createPlatformJob(supabase, {
        tenantId,
        connectorId: "simwood",
        moduleId: "communications.phone",
        jobType: "phone.scheduled_sync",
        jobKey: `phone.scheduled_sync:${account.id}:${to.slice(0, 16)}`,
        payload: { provider_customer_id: customerId, from, to },
      });
      const jobId = created.duplicate ? null : created.id;
      if (jobId) await startPlatformJob(supabase, jobId);

      // Open a scheduled_sync run so every tick is auditable even on mid-run failure.
      const { data: runRow } = await supabase
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
      const syncRunId = (runRow?.id as string | undefined) ?? null;

      const childBody = {
        tenant_id: tenantId,
        provider_customer_id: customerId,
        from,
        to,
      };

      // Calls — invoke the existing idempotent function (service-role internal).
      const callsRes = await invokeFunction("simwood-sync-calls", childBody, serviceKey);
      const callsOk = Boolean(callsRes.json?.success);
      const callsProcessed = recordsOf(callsRes.json);

      // Recordings — also auto-triggers Phase-5A enrichment for NEW recordings.
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

      if (syncRunId) {
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
      }

      // Advance the durable cursor ONLY on full success, so a missed/failed run
      // is retried from the same point next tick (no permanently skipped calls).
      if (overallOk) {
        await supabase
          .from("connector_accounts")
          .update({
            sync_cursor: { last_synced_until: to },
            last_successful_sync_at: to,
            last_error: null,
          })
          .eq("id", account.id);
        await supabase
          .from("tenant_connectors")
          .update({
            last_successful_sync_at: to,
            health_status: "healthy",
            last_error: null,
          })
          .eq("id", connector.id);
      } else {
        const errText = JSON.stringify(errors);
        await supabase
          .from("connector_accounts")
          .update({ last_failed_sync_at: new Date().toISOString(), last_error: errText })
          .eq("id", account.id);
        await supabase
          .from("tenant_connectors")
          .update({
            last_failed_sync_at: new Date().toISOString(),
            health_status: "warning",
            last_error: errText,
          })
          .eq("id", connector.id);
      }

      if (jobId) {
        if (overallOk) {
          await completePlatformJob(supabase, jobId, {
            recordsProcessed: callsProcessed + recProcessed,
            result: { calls_processed: callsProcessed, recordings_processed: recProcessed },
          });
        } else {
          await failPlatformJob(supabase, jobId, JSON.stringify(errors), {
            calls_processed: callsProcessed,
            recordings_processed: recProcessed,
          });
        }
      }

      results.push({
        tenant_id: tenantId,
        provider_customer_id: customerId,
        ok: overallOk,
        calls_processed: callsProcessed,
        recordings_processed: recProcessed,
        sync_run_id: syncRunId,
        from,
        to,
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      });
    }
  }

  const overall = results.every((r) => r.ok === true);
  return json({ success: overall, accounts: results.length, results });
});
