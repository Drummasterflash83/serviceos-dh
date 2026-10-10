import { captureAdmission } from "../_shared/learn_capture_control.ts";
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
// next run retries from that saved point. First-ever run
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
import { includeLocalCalls } from "../_shared/phone-sync-completeness.ts";
import { createPlatformJob } from "../_shared/platform_jobs.ts";
import {
  ownPhoneSchedule,
  phoneChildResult,
  phoneRunId,
  settlePhoneSchedule,
} from "../_shared/phone-schedule-settlement.ts";

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

interface AccountRow {
  id: string;
  tenant_id: string;
  updated_at: string;
  account_key: string;
  settings: Record<string, unknown> | null;
  sync_cursor: Record<string, unknown> | null;
  last_successful_sync_at: string | null;
}

/** Resolve the provider customer id for an account: settings override, else key. */
function customerIdOf(row: AccountRow): string {
  const fromSettings = row.settings?.provider_customer_id;
  return typeof fromSettings === "string" && fromSettings.trim() !== ""
    ? fromSettings.trim()
    : row.account_key;
}

/** Compute the [from, to] sync window from the account's durable cursor. */
function windowFor(row: AccountRow, nowMs: number): { from: string; to: string } | null {
  if (
    row.sync_cursor != null &&
    (typeof row.sync_cursor !== "object" || Array.isArray(row.sync_cursor))
  )
    return null;
  const cursorRaw = row.sync_cursor?.last_synced_until;
  const cursor = typeof cursorRaw === "string" ? cursorRaw : (row.last_successful_sync_at ?? null);
  const cursorMs = cursor ? Date.parse(cursor) : NaN;
  if (
    (cursorRaw !== undefined && cursorRaw !== null && typeof cursorRaw !== "string") ||
    (cursor !== null &&
      (typeof cursor !== "string" || !Number.isFinite(cursorMs) || cursorMs > nowMs))
  )
    return null;
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
      .select(
        "id, tenant_id, updated_at, account_key, settings, sync_cursor, last_successful_sync_at",
      )
      .eq("tenant_connector_id", connector.id)
      .eq("tenant_id", connector.tenant_id)
      .eq("status", "active");
    if (acctErr) {
      results.push({ tenant_connector_id: connector.id, ok: false, error: "accounts_read_failed" });
      continue; // never abort the whole run on one connector
    }

    for (const account of (accounts ?? []) as AccountRow[]) {
      const tenantId = account.tenant_id;
      const admission = await captureAdmission(supabase, tenantId, "phone");
      if (!admission.allowed) {
        results.push({ tenant_id: tenantId, ok: false, waiting: admission.reason });
        continue;
      }

      const customerId = customerIdOf(account);
      const window = windowFor(account, nowMs);
      if (
        !window ||
        account.tenant_id !== connector.tenant_id ||
        !Number.isFinite(Date.parse(account.updated_at))
      ) {
        results.push({ tenant_id: tenantId, ok: false, error: "phone_schedule_scope_invalid" });
        continue;
      }
      const { from, to } = window;
      const created = await createPlatformJob(supabase, {
        tenantId,
        connectorId: "simwood",
        moduleId: "communications.phone",
        jobType: "phone.scheduled_sync",
        jobKey: `phone.scheduled_sync:${account.id}:${to.slice(0, 16)}`,
        payload: { provider_customer_id: customerId, from, to },
      });
      if (created.duplicate || !phoneRunId(created.id)) {
        results.push({
          tenant_id: tenantId,
          ok: false,
          ...(created.duplicate
            ? { waiting: "active_run" }
            : { error: "phone_schedule_job_unconfirmed" }),
        });
        continue;
      }
      const job = { tenantId, jobId: created.id, owner: `phone-schedule:${crypto.randomUUID()}` };
      if (!(await ownPhoneSchedule(supabase, job, true))) {
        results.push({ tenant_id: tenantId, ok: false, error: "phone_schedule_job_unconfirmed" });
        continue;
      }
      const includeLocal = includeLocalCalls(account.settings);
      const baseMetadata = {
        connector_account_id: account.id,
        tenant_connector_id: connector.id,
        provider_customer_id: customerId,
        account_updated_at: account.updated_at,
        include_local: includeLocal,
        from,
        to,
        overlap_minutes: OVERLAP_MINUTES,
        job_id: job.jobId,
        job_owner: job.owner,
      };
      let syncRunId: string | null = null;
      try {
        const { data, error } = await supabase
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
        if (!error && phoneRunId(data?.id)) syncRunId = data.id;
      } catch {
        /* Unknown creation must not start untracked provider requests. */
      }
      if (!syncRunId) {
        results.push({
          tenant_id: tenantId,
          ok: false,
          error: "phone_schedule_run_unconfirmed",
          job_id: job.jobId,
        });
        continue;
      }
      const childBody = { tenant_id: tenantId, provider_customer_id: customerId, from, to };
      if (!(await ownPhoneSchedule(supabase, job))) {
        results.push({
          tenant_id: tenantId,
          ok: false,
          error: "phone_schedule_job_unconfirmed",
          sync_run_id: syncRunId,
        });
        continue;
      }
      const callsRes = await invokeFunction(
        "simwood-sync-calls",
        { ...childBody, include_local: includeLocal },
        serviceKey,
      );
      if (!(await ownPhoneSchedule(supabase, job))) {
        results.push({
          tenant_id: tenantId,
          ok: false,
          error: "phone_schedule_job_unconfirmed",
          sync_run_id: syncRunId,
        });
        continue;
      }
      const recRes = await invokeFunction("simwood-sync-recordings", childBody, serviceKey);
      const calls = phoneChildResult(callsRes, { from, to, customerId });
      const recordings = phoneChildResult(recRes, { from, to, customerId });
      const errors: Record<string, string> = {};
      if (!calls.success) errors.calls = calls.code;
      if (!recordings.success) errors.recordings = recordings.code;
      const outcome =
        Object.keys(errors).length === 0
          ? "success"
          : Object.values(errors).every((code) =>
                ["learn_capture_paused", "learn_capture_unavailable"].includes(code),
              )
            ? "paused"
            : "failed";
      const settled = await settlePhoneSchedule(supabase, {
        ...job,
        runId: syncRunId,
        accountId: account.id,
        connectorId: connector.id,
        customerId,
        from,
        to,
        callsRunId: calls.runId,
        recordingsRunId: recordings.runId,
        outcome,
        errors,
      });
      results.push({
        tenant_id: tenantId,
        provider_customer_id: customerId,
        sync_run_id: syncRunId,
        from,
        to,
        ok: settled.ok && outcome === "success",
        ...(settled.ok
          ? {
              calls_processed: settled.callsProcessed,
              recordings_processed: settled.recordingsProcessed,
              ...(outcome === "paused" ? { waiting: "capture_control" } : {}),
            }
          : { error: settled.code }),
        ...(Object.keys(errors).length ? { errors } : {}),
      });
    }
  }

  const overall = results.every((r) => r.ok === true || !!r.waiting);
  return json({ success: overall, accounts: results.length, results });
});
