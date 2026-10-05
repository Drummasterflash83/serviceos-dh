// ServiceOS — Edge Function: phone-pipeline-status (Reliability v2)
//
// THE single source of truth for phone-pipeline health. Both surfaces read this
// one endpoint — the Operations Centre renders the business-health SUMMARY, the
// Admin › Phone Operations page renders the full DIAGNOSTICS — so there is no
// duplicated health logic. Read-only, service-role (reads the RLS-protected
// phone_* tables). Runtime: Deno.
//
// All metrics are computed DATABASE-SIDE by phone_pipeline_health() over the FULL
// table (migration 20260711120000) — no bounded scan window, and "failed" means
// CURRENTLY blocked (unresolved), never all-time history. Scheduler, worker and
// useful-processing freshness are measured SEPARATELY.
//
// Request body: { tenant_id: uuid, detail?: boolean }
//   detail=true also returns `diagnostics` (per unresolved-item rows).

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import { CADENCE_SEC, staleAfterSec } from "../_shared/health_model.ts";

// Backlog-age SLAs (how long WORK may wait) — a product SLA, distinct from
// scheduler/worker freshness. Aligned with docs/PHONE_RELIABILITY_ACCEPTANCE.md.
const CRITICAL_AGE_SEC = 1800; // >30m oldest eligible ⇒ the drainer isn't keeping up
const WARNING_AGE_SEC = 900; // >15m oldest eligible ⇒ building
const WARNING_BACKLOG = 10; // >10 items needing work ⇒ building
// Scheduler/worker freshness comes from the ONE authoritative health model. Phone
// processing is enqueued every 2 min → stale after HEALTH_STALE_MULTIPLIER ticks
// (8 min), so this agrees with the scheduler panel instead of a hard-coded 10m.
const STALE_AFTER_SEC = staleAfterSec(CADENCE_SEC.phoneProcessing);

function ageSec(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((nowMs - t) / 1000));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return failResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  const body = (parsed ?? {}) as Record<string, unknown>;
  const wantDetail = body.detail === true;

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }

  // --- authz: bind tenant server-side (diagnostics ⇒ owner/admin/ops) ------
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  const nowMs = Date.now();

  // --- one DB call: all counts + freshness + throughput (no scan window) ---
  const { data: healthData, error: healthErr } = await supabase.rpc("phone_pipeline_health", {
    p_tenant_id: tenantId,
  });
  if (healthErr) {
    return failResponse("db_error", `Could not read pipeline health: ${healthErr.message}`, 500);
  }
  const h = (healthData ?? {}) as Record<string, number | string | null>;

  const num = (k: string): number => {
    const v = h[k];
    return typeof v === "number" ? v : 0;
  };
  const iso = (k: string): string | null => {
    const v = h[k];
    return typeof v === "string" ? v : null;
  };

  const recordingsTotal = num("recordings_total");
  const notDownloaded = num("need_download");
  const needTranscription = num("need_transcription");
  const needAnalysis = num("need_analysis");
  const eligibleBacklog = num("eligible_backlog");
  const completed = num("completed");
  const downloaded = Math.max(0, recordingsTotal - notDownloaded);
  const currentFailures = num("current_unresolved_failures");
  const historicalFailures = num("historical_failures");
  const failures24h = num("failures_24h");
  const deadLetterCount = num("dead_letter_count");
  const activeJobs = num("active_jobs");
  const missingProviderId = num("missing_provider_id");

  const oldestPendingAt = iso("oldest_eligible_at");
  const oldestPendingAgeSeconds =
    num("oldest_eligible_age_seconds") || ageSec(oldestPendingAt, nowMs);

  const lastUsefulAt = iso("last_useful_at");
  const lastIngestionAt = iso("last_ingestion_at");
  const lastWorkerSuccessAt = iso("last_worker_success_at");
  const lastSchedulerAt = iso("last_scheduler_at");

  const throughputTotalPerHour = num("throughput_total_per_hour");
  const throughputPerMin = Math.round((throughputTotalPerHour / 60) * 100) / 100;
  const estimatedDrainSeconds =
    typeof h["estimated_drain_seconds"] === "number"
      ? (h["estimated_drain_seconds"] as number)
      : null;

  // --- scheduler / worker freshness (separate signals) ---------------------
  const schedulerAge = ageSec(lastSchedulerAt, nowMs);
  const workerAge = ageSec(lastWorkerSuccessAt, nowMs);
  const schedulerHealthy = schedulerAge !== null && schedulerAge <= STALE_AFTER_SEC;
  const workerHealthy = workerAge !== null && workerAge <= STALE_AFTER_SEC;

  // --- latest failure (for the "current failure" banner) -------------------
  const { data: lastFail } = await supabase
    .from("phone_sync_runs")
    .select("started_at, error_message")
    .eq("tenant_id", tenantId)
    .eq("sync_type", "pipeline")
    .eq("status", "failed")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastFailureAt = (lastFail?.started_at as string | null) ?? null;
  const lastFailureMessage = (lastFail?.error_message as string | null) ?? null;
  // A failure is only CURRENT if a recording is still blocked by it.
  const lastFailureIsCurrent = currentFailures > 0;

  // --- derived health ------------------------------------------------------
  let health: "healthy" | "warning" | "critical" = "healthy";
  let healthReason = "Pipeline healthy";
  if (eligibleBacklog > 0 && lastWorkerSuccessAt === null) {
    health = "critical";
    healthReason = "Backlog exists but no worker run has completed yet";
  } else if (deadLetterCount > 0) {
    health = "critical";
    healthReason = `${deadLetterCount} job(s) dead-lettered — operator action needed`;
  } else if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds > CRITICAL_AGE_SEC) {
    health = "critical";
    healthReason = "Oldest waiting call is over 30 minutes old — the drainer isn't keeping up";
  } else if (eligibleBacklog > 0 && !workerHealthy) {
    health = "warning";
    healthReason = "Worker hasn't completed a run recently while work is pending";
  } else if (currentFailures > 0) {
    health = "warning";
    healthReason = `${currentFailures} recording(s) currently blocked by a failure`;
  } else if (eligibleBacklog > WARNING_BACKLOG) {
    health = "warning";
    healthReason = `${eligibleBacklog} recordings waiting to be processed`;
  } else if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds > WARNING_AGE_SEC) {
    health = "warning";
    healthReason = "Calls have been waiting more than 15 minutes";
  } else if (eligibleBacklog > 0) {
    healthReason = `${eligibleBacklog} recording(s) processing normally`;
  }

  // --- optional per-item diagnostics ---------------------------------------
  let diagnostics: unknown[] | undefined;
  if (wantDetail) {
    const { data: diag } = await supabase.rpc("phone_pipeline_diagnostics", {
      p_tenant_id: tenantId,
      p_limit: 100,
    });
    diagnostics = (diag ?? []) as unknown[];
  }

  return jsonResponse({
    success: true,
    health,
    health_reason: healthReason,
    // stage backlog
    recordings_total: recordingsTotal,
    not_downloaded: notDownloaded,
    downloaded,
    need_transcription: needTranscription,
    need_analysis: needAnalysis,
    need_work: eligibleBacklog,
    eligible_backlog: eligibleBacklog,
    missing_provider_id: missingProviderId,
    // high-level (back-compat) — `failed` REDEFINED to current unresolved
    pending: eligibleBacklog,
    processing: activeJobs,
    failed: currentFailures,
    completed,
    // failure separation (§7)
    current_unresolved_failures: currentFailures,
    historical_failures: historicalFailures,
    failures_24h: failures24h,
    dead_letter_count: deadLetterCount,
    // freshness — scheduler / worker / useful measured separately (§8)
    oldest_pending_at: oldestPendingAt,
    oldest_pending_age_seconds: oldestPendingAgeSeconds,
    oldest_pending_beyond_scan: false, // full-table now — no scan window to exceed
    last_success_at: lastUsefulAt, // back-compat alias for last useful processing
    last_useful_at: lastUsefulAt,
    last_ingestion_at: lastIngestionAt,
    last_worker_success_at: lastWorkerSuccessAt,
    last_scheduler_at: lastSchedulerAt,
    scheduler_healthy: schedulerHealthy,
    worker_healthy: workerHealthy,
    last_failure_at: lastFailureAt,
    last_failure_message: lastFailureMessage,
    last_failure_is_current: lastFailureIsCurrent,
    // flow
    throughput_per_min: throughputPerMin,
    throughput_downloads_per_hour: num("throughput_downloads_per_hour"),
    throughput_transcripts_per_hour: num("throughput_transcripts_per_hour"),
    throughput_analyses_per_hour: num("throughput_analyses_per_hour"),
    throughput_total_per_hour: throughputTotalPerHour,
    estimated_drain_seconds: estimatedDrainSeconds,
    ...(diagnostics ? { diagnostics } : {}),
  });
});
