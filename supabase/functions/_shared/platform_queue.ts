// ServiceOS — shared Platform Queue helper (Deno, service-role).
//
// The async worker queue lives IN platform_jobs (see migration
// 20260710120000_platform_job_queue.sql). Schedulers ENQUEUE and return fast; the
// platform-worker CLAIMS atomically, dispatches to the existing worker functions,
// and completes / retries / dead-letters. Everything here is BEST-EFFORT and
// tenant-bound; nothing logs secrets and nothing stores transcript/audio/email
// content in job metadata.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type JobRow = Record<string, unknown>;

// Retry backoff by the attempt number that just FAILED (attempt_count is already
// incremented at claim time): 1→+1m, 2→+5m, 3→+15m, 4→+60m, then dead-letter.
const BACKOFF_SECONDS: Record<number, number> = { 1: 60, 2: 300, 3: 900, 4: 3600 };

// Error codes that will NEVER succeed on retry → dead-letter immediately.
// Provider/download codes: `recording_not_ready`, `provider_rate_limited`,
// `provider_timeout`, `download_failed`, `storage_failed`, `transcription_empty`
// are DELIBERATELY absent (retryable by default). Only the terminal ones below
// dead-letter — a recording gone past provider retention, a malformed identifier,
// a cross-tenant mismatch or an unsupported format can never succeed on retry.
const NON_RETRYABLE = new Set([
  "config_error",
  "invalid_json",
  "invalid_recording_id",
  "invalid_transcript_id",
  "invalid_force",
  "invalid_input",
  "invalid_recording", // recording row has no provider_recording_id — unfetchable
  "not_found",
  "tenant_mismatch",
  "forbidden",
  "missing_auth",
  "invalid_auth",
  "internal_auth_mismatch",
  "malformed_response",
  "empty_transcript",
  "unsupported_job",
  "provider_recording_missing", // 404 past retention — the audio is gone for good
  "malformed_provider_id",
  "cross_tenant_mismatch",
  "unsupported_format",
]);

/** Classify an error as retryable (transient) vs terminal. Default: retryable. */
export function isRetryable(errorCode: string | null, httpStatus?: number): boolean {
  if (errorCode && NON_RETRYABLE.has(errorCode)) return false;
  // 4xx (except 408/429) are terminal client errors; 0/5xx/408/429 are transient.
  if (typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500) {
    return httpStatus === 408 || httpStatus === 429;
  }
  return true;
}

export interface EnqueueInput {
  tenantId: string;
  jobType: string;
  /** Idempotency key — an ACTIVE job with this key won't be enqueued twice. */
  jobKey: string;
  connectorId?: string | null;
  moduleId?: string | null;
  priority?: number;
  maxAttempts?: number;
  availableAt?: string | null;
  parentJobId?: string | null;
  payload?: Record<string, unknown>;
}

export interface EnqueueResult {
  id: string | null;
  duplicate: boolean;
}

/**
 * Idempotent enqueue. Relies on platform_jobs_active_job_key_uk: if an active
 * (queued|running) job already has this (tenant, job_key), returns that job with
 * duplicate=true instead of creating another. Never throws.
 */
export async function enqueueJob(
  client: SupabaseClient,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  if (!input.tenantId || !input.jobType || !input.jobKey) return { id: null, duplicate: false };
  try {
    const { data, error } = await client
      .from("platform_jobs")
      .insert({
        tenant_id: input.tenantId,
        connector_id: input.connectorId ?? null,
        module_id: input.moduleId ?? null,
        job_type: input.jobType,
        job_key: input.jobKey,
        status: "queued",
        priority: input.priority ?? 100,
        max_attempts: input.maxAttempts ?? 5,
        available_at: input.availableAt ?? new Date().toISOString(),
        parent_job_id: input.parentJobId ?? null,
        payload: input.payload ?? {},
      })
      .select("id")
      .single();
    if (!error && data) return { id: data.id as string, duplicate: false };
    if (error && (error as { code?: string }).code === "23505") {
      const { data: existing } = await client
        .from("platform_jobs")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("job_key", input.jobKey)
        .in("status", ["queued", "running", "retrying"])
        .limit(1)
        .maybeSingle();
      return { id: (existing?.id as string | undefined) ?? null, duplicate: true };
    }
    return { id: null, duplicate: false };
  } catch {
    return { id: null, duplicate: false };
  }
}

/** Atomically claim up to `batch` due jobs (FOR UPDATE SKIP LOCKED via RPC). */
export async function claimJobs(
  client: SupabaseClient,
  opts: { worker: string; batch: number; leaseSeconds: number; jobTypes?: string[] | null },
): Promise<JobRow[]> {
  try {
    const { data, error } = await client.rpc("platform_jobs_claim", {
      p_worker: opts.worker,
      p_batch: opts.batch,
      p_lease_seconds: opts.leaseSeconds,
      p_job_types: opts.jobTypes ?? null,
    });
    if (error) return [];
    return (data ?? []) as JobRow[];
  } catch {
    return [];
  }
}

/** Mark a claimed job succeeded, clearing its lease. Best-effort. */
export async function completeJob(
  client: SupabaseClient,
  jobId: string,
  result: { recordsProcessed?: number; result?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await client
      .from("platform_jobs")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        lease_expires_at: null,
        error_code: null,
        result: result.result ?? {},
        ...(typeof result.recordsProcessed === "number"
          ? { records_processed: result.recordsProcessed }
          : {}),
      })
      .eq("id", jobId);
  } catch {
    // swallow — the lease will expire and the job re-claims if this write is lost
  }
}

/**
 * Fail a claimed job: retry with exponential backoff while attempts remain and the
 * error is retryable, else dead-letter. `attempt` is the row's post-claim
 * attempt_count. `message` MUST be safe (no secrets, no transcript/audio content).
 */
export async function failJob(
  client: SupabaseClient,
  job: { id: string; attempt: number; maxAttempts: number },
  err: { errorCode: string; message: string; retryable: boolean },
): Promise<"retrying" | "dead_letter"> {
  const safe = (err.message ?? "").slice(0, 500);
  const canRetry = err.retryable && job.attempt < job.maxAttempts;
  const nowIso = new Date().toISOString();
  try {
    if (canRetry) {
      const delay = BACKOFF_SECONDS[job.attempt] ?? 3600;
      const availableAt = new Date(Date.now() + delay * 1000).toISOString();
      await client
        .from("platform_jobs")
        .update({
          status: "retrying",
          available_at: availableAt,
          next_run_at: availableAt,
          lease_expires_at: null,
          error_code: err.errorCode,
          last_error: safe,
          error_count: job.attempt,
        })
        .eq("id", job.id);
      return "retrying";
    }
    await client
      .from("platform_jobs")
      .update({
        status: "dead_letter",
        dead_lettered_at: nowIso,
        failed_at: nowIso,
        lease_expires_at: null,
        error_code: err.errorCode,
        last_error: safe,
        error_count: job.attempt,
      })
      .eq("id", job.id);
    return "dead_letter";
  } catch {
    return canRetry ? "retrying" : "dead_letter";
  }
}

/** Operator action: requeue a dead-lettered/failed job for a fresh attempt budget. */
export async function retryJob(client: SupabaseClient, jobId: string): Promise<void> {
  try {
    await client
      .from("platform_jobs")
      .update({
        status: "queued",
        available_at: new Date().toISOString(),
        attempt_count: 0,
        dead_lettered_at: null,
        failed_at: null,
        lease_expires_at: null,
        error_code: null,
      })
      .eq("id", jobId);
  } catch {
    // swallow
  }
}

/** Force a job to dead-letter (operator or terminal condition). */
export async function deadLetterJob(
  client: SupabaseClient,
  jobId: string,
  err: { errorCode: string; message: string },
): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    await client
      .from("platform_jobs")
      .update({
        status: "dead_letter",
        dead_lettered_at: nowIso,
        failed_at: nowIso,
        lease_expires_at: null,
        error_code: err.errorCode,
        last_error: (err.message ?? "").slice(0, 500),
      })
      .eq("id", jobId);
  } catch {
    // swallow
  }
}

/**
 * Reclaim jobs whose worker died mid-run (lease expired): move them back to
 * 'retrying', available now, so the next claim picks them up. Returns the count.
 */
export async function releaseExpiredLeases(client: SupabaseClient): Promise<number> {
  try {
    const { data } = await client
      .from("platform_jobs")
      .update({
        status: "retrying",
        available_at: new Date().toISOString(),
        lease_expires_at: null,
        error_code: "lease_expired",
        last_error: "Worker lease expired before completion — reclaimed.",
      })
      .eq("status", "running")
      .lt("lease_expires_at", new Date().toISOString())
      .select("id");
    return (data ?? []).length;
  } catch {
    return 0;
  }
}

/** Extend a running job's lease (worker still processing). Best-effort. */
export async function heartbeatLease(
  client: SupabaseClient,
  jobId: string,
  leaseSeconds: number,
): Promise<void> {
  try {
    await client
      .from("platform_jobs")
      .update({ lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString() })
      .eq("id", jobId)
      .eq("status", "running");
  } catch {
    // swallow
  }
}
