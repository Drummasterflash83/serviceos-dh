/**
 * Platform Jobs — tenant-scoped, read-only client access (RLS browser client).
 *
 * Reads the durable `platform_jobs` execution records for the signed-in user's
 * tenant. NO service role, NO tenant_id passed by the client — the SELECT policy
 * scopes every query. Writes (retry/cancel) are NOT permitted from the browser in
 * v1 (no write policy); those helpers are honest contract placeholders until a
 * server-side executor exists. Mirrors `./phone-feed` / `./email-feed`.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type PlatformJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "retrying"
  | "dead_letter"
  | "skipped";

export interface PlatformJob {
  id: string;
  tenant_id: string;
  connector_id: string | null;
  module_id: string | null;
  job_type: string;
  job_key: string | null;
  status: PlatformJobStatus | string;
  priority: number;
  progress_current: number;
  progress_total: number | null;
  records_processed: number;
  error_count: number;
  attempt_count: number;
  max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  // Queue fields (Async Worker Queue v1).
  available_at: string | null;
  claimed_by: string | null;
  lease_expires_at: string | null;
  dead_lettered_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformJobFilter {
  status?: PlatformJobStatus | PlatformJobStatus[];
  connectorId?: string;
  jobType?: string;
  limit?: number;
}

export interface PlatformJobSummary {
  running: number;
  queued: number;
  succeeded_today: number;
  failed_today: number;
  retrying: number;
  cancelled_today: number;
  /** Jobs that exhausted retries (need operator attention; never auto-deleted). */
  dead_letter: number;
  /** Running jobs whose lease has expired (a worker died) — reclaimed next tick. */
  expired_leases: number;
  /** Oldest still-waiting (queued/retrying) job's timestamp, for "oldest queued age". */
  oldest_queued_at: string | null;
  /** Mean succeeded-job duration today, in seconds (null if none). */
  avg_duration_seconds: number | null;
  latest_failed: PlatformJob | null;
  latest_running: PlatformJob | null;
  last_completed: PlatformJob | null;
}

const JOB_COLUMNS =
  "id, tenant_id, connector_id, module_id, job_type, job_key, status, priority, progress_current, progress_total, records_processed, error_count, attempt_count, max_attempts, started_at, completed_at, failed_at, cancelled_at, next_run_at, last_error, available_at, claimed_by, lease_expires_at, dead_lettered_at, error_code, created_at, updated_at";

function clampLimit(v: number | undefined, fallback = 50): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
  return Math.max(1, Math.min(200, n));
}

/** List recent platform jobs for the tenant (RLS-scoped), newest first. */
export async function listPlatformJobs(
  filter: PlatformJobFilter = {},
): Promise<ApiResult<PlatformJob[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  let query = supabase
    .from("platform_jobs")
    .select(JOB_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(clampLimit(filter.limit));
  if (filter.connectorId) query = query.eq("connector_id", filter.connectorId);
  if (filter.jobType) query = query.eq("job_type", filter.jobType);
  if (filter.status) {
    query = Array.isArray(filter.status)
      ? query.in("status", filter.status)
      : query.eq("status", filter.status);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data ?? []) as PlatformJob[] };
}

/**
 * Operational jobs summary. Returns ok:false ("jobs_unavailable") when the table
 * cannot be read — the caller shows "Jobs unavailable" rather than a fake zero.
 * An empty (but readable) table returns all-zero counts with ok:true.
 */
export async function getPlatformJobSummary(): Promise<ApiResult<PlatformJobSummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const head = { count: "exact" as const, head: true as const };

  const count = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  // Probe first: if the table can't be read at all, report unavailable.
  const probe = await supabase.from("platform_jobs").select("*", head).eq("status", "running");
  if (probe.error) {
    return { ok: false, error: { code: "jobs_unavailable", message: probe.error.message } };
  }

  const nowIso = new Date().toISOString();
  const [
    queued,
    retrying,
    succeededToday,
    failedToday,
    cancelledToday,
    deadLetter,
    expiredLeases,
    oldestQueued,
    latestFailed,
    latestRunning,
    lastCompleted,
    durationRows,
  ] = await Promise.all([
    count(() => supabase.from("platform_jobs").select("*", head).eq("status", "queued")),
    count(() => supabase.from("platform_jobs").select("*", head).eq("status", "retrying")),
    count(() =>
      supabase
        .from("platform_jobs")
        .select("*", head)
        .eq("status", "succeeded")
        .gte("completed_at", startToday),
    ),
    count(() =>
      supabase
        .from("platform_jobs")
        .select("*", head)
        .eq("status", "failed")
        .gte("failed_at", startToday),
    ),
    count(() =>
      supabase
        .from("platform_jobs")
        .select("*", head)
        .eq("status", "cancelled")
        .gte("cancelled_at", startToday),
    ),
    count(() => supabase.from("platform_jobs").select("*", head).eq("status", "dead_letter")),
    count(() =>
      supabase
        .from("platform_jobs")
        .select("*", head)
        .eq("status", "running")
        .not("lease_expires_at", "is", null)
        .lt("lease_expires_at", nowIso),
    ),
    supabase
      .from("platform_jobs")
      .select("created_at")
      .in("status", ["queued", "retrying"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("platform_jobs")
      .select(JOB_COLUMNS)
      .eq("status", "failed")
      .order("failed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("platform_jobs")
      .select(JOB_COLUMNS)
      .eq("status", "running")
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("platform_jobs")
      .select(JOB_COLUMNS)
      .eq("status", "succeeded")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    // Recent succeeded runs (with both timestamps) for a mean duration.
    supabase
      .from("platform_jobs")
      .select("started_at, completed_at")
      .eq("status", "succeeded")
      .gte("completed_at", startToday)
      .not("started_at", "is", null)
      .limit(50),
  ]);

  const durations = ((durationRows.data ?? []) as { started_at: string; completed_at: string }[])
    .map((r) => (Date.parse(r.completed_at) - Date.parse(r.started_at)) / 1000)
    .filter((d) => Number.isFinite(d) && d >= 0);
  const avgDuration =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  return {
    ok: true,
    data: {
      running: probe.count ?? 0,
      queued: queued ?? 0,
      succeeded_today: succeededToday ?? 0,
      failed_today: failedToday ?? 0,
      retrying: retrying ?? 0,
      cancelled_today: cancelledToday ?? 0,
      dead_letter: deadLetter ?? 0,
      expired_leases: expiredLeases ?? 0,
      oldest_queued_at: (oldestQueued.data as { created_at: string } | null)?.created_at ?? null,
      avg_duration_seconds: avgDuration,
      latest_failed: (latestFailed.data as PlatformJob | null) ?? null,
      latest_running: (latestRunning.data as PlatformJob | null) ?? null,
      last_completed: (lastCompleted.data as PlatformJob | null) ?? null,
    },
  };
}

/**
 * v1 CONTRACT PLACEHOLDER — retry is owned by a future server-side executor.
 * The browser has no write access to platform_jobs (RLS SELECT-only), so this
 * intentionally does not pretend to work.
 */
export async function retryPlatformJob(_jobId: string): Promise<ApiResult<never>> {
  return {
    ok: false,
    error: { code: "not_implemented", message: "Retry is coming soon (no executor yet)." },
  };
}

/**
 * v1 CONTRACT PLACEHOLDER — cancel is owned by a future server-side executor.
 * (A queued-job cancel will land with the executor + a service-role endpoint.)
 */
export async function cancelPlatformJob(_jobId: string): Promise<ApiResult<never>> {
  return {
    ok: false,
    error: { code: "not_implemented", message: "Cancel is coming soon (no executor yet)." },
  };
}
