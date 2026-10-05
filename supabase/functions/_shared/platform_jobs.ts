// ServiceOS — shared Platform Jobs helper (Deno, service-role).
//
// The one place Edge Functions create/update durable `platform_jobs` rows. It is
// deliberately BEST-EFFORT and failure-isolated: job tracking must never break or
// block the underlying sync. Every function swallows its own errors and returns a
// safe value, so a jobs-table hiccup degrades to "no job row", never a 500.
//
// Security: always requires an explicit tenant_id; never logs secrets; callers
// must keep credentials out of payload/result/metadata. Uses the caller's
// service-role Supabase client (writes bypass RLS).
//
// No new dependencies — the SupabaseClient type comes from the same supabase-js
// module already used across these functions.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// A 'retrying' job is ACTIVE — the worker claims status IN ('queued','retrying'),
// so it WILL run. It is covered by platform_jobs_active_job_key_uk (see migration
// 20260804120000). Keep this list aligned with that index's predicate so the
// duplicate-recovery lookup below resolves the existing active row.
const ACTIVE_STATUSES = ["queued", "running", "retrying"];

export interface CreatePlatformJobInput {
  tenantId: string;
  connectorId?: string | null;
  moduleId?: string | null;
  jobType: string;
  /** Idempotency key: prevents a duplicate ACTIVE job for the same tenant+key. */
  jobKey?: string | null;
  priority?: number;
  progressTotal?: number | null;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

/** Result of createPlatformJob. `duplicate` = an active job with this key exists. */
export interface PlatformJobHandle {
  id: string | null;
  duplicate: boolean;
}

export interface CompletePlatformJobInput {
  recordsProcessed?: number;
  progressCurrent?: number;
  result?: Record<string, unknown>;
}

/**
 * Create a queued job. On a duplicate ACTIVE job_key (unique-index violation),
 * returns the existing job's id with `duplicate: true` instead of erroring — the
 * caller decides whether to skip. Returns { id: null } if creation truly failed
 * (never throws).
 */
export async function createPlatformJob(
  client: SupabaseClient,
  input: CreatePlatformJobInput,
): Promise<PlatformJobHandle> {
  if (!input.tenantId || !input.jobType) return { id: null, duplicate: false };
  try {
    const row = {
      tenant_id: input.tenantId,
      connector_id: input.connectorId ?? null,
      module_id: input.moduleId ?? null,
      job_type: input.jobType,
      job_key: input.jobKey ?? null,
      status: "queued",
      priority: input.priority ?? 100,
      progress_total: input.progressTotal ?? null,
      max_attempts: input.maxAttempts ?? 3,
      payload: input.payload ?? {},
      metadata: input.metadata ?? {},
      created_by: input.createdBy ?? null,
    };
    const { data, error } = await client.from("platform_jobs").insert(row).select("id").single();
    if (!error && data) return { id: data.id as string, duplicate: false };

    // Unique violation on the active job_key index → an active job already exists.
    if (error && (error as { code?: string }).code === "23505" && input.jobKey) {
      const { data: existing } = await client
        .from("platform_jobs")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("job_key", input.jobKey)
        .in("status", ACTIVE_STATUSES)
        .limit(1)
        .maybeSingle();
      return { id: (existing?.id as string | undefined) ?? null, duplicate: true };
    }
    return { id: null, duplicate: false };
  } catch {
    return { id: null, duplicate: false };
  }
}

/** Mark a job running. Best-effort. */
export async function startPlatformJob(client: SupabaseClient, jobId: string): Promise<void> {
  if (!jobId) return;
  try {
    await client
      .from("platform_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch {
    // swallow — job tracking must never break the sync
  }
}

/** Mark a job succeeded with optional records/progress/result. Best-effort. */
export async function completePlatformJob(
  client: SupabaseClient,
  jobId: string,
  result: CompletePlatformJobInput = {},
): Promise<void> {
  if (!jobId) return;
  try {
    const patch: Record<string, unknown> = {
      status: "succeeded",
      completed_at: new Date().toISOString(),
      result: result.result ?? {},
    };
    if (typeof result.recordsProcessed === "number") {
      patch.records_processed = result.recordsProcessed;
    }
    if (typeof result.progressCurrent === "number") {
      patch.progress_current = result.progressCurrent;
    }
    await client.from("platform_jobs").update(patch).eq("id", jobId);
  } catch {
    // swallow
  }
}

/** Mark a job failed with an error message (never a secret) and optional result. */
export async function failPlatformJob(
  client: SupabaseClient,
  jobId: string,
  error: string,
  result?: Record<string, unknown>,
): Promise<void> {
  if (!jobId) return;
  try {
    await client
      .from("platform_jobs")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        error_count: 1,
        last_error: typeof error === "string" ? error.slice(0, 2000) : "unknown_error",
        ...(result ? { result } : {}),
      })
      .eq("id", jobId);
  } catch {
    // swallow
  }
}

/** Mark a job cancelled. Best-effort (server-side helper). */
export async function cancelPlatformJob(client: SupabaseClient, jobId: string): Promise<void> {
  if (!jobId) return;
  try {
    await client
      .from("platform_jobs")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch {
    // swallow
  }
}

/**
 * Advance a running job's progress by `progress` (added to progress_current). A
 * read-modify-write; safe here because a single function owns a job at a time.
 * Best-effort.
 */
export async function incrementPlatformJobProgress(
  client: SupabaseClient,
  jobId: string,
  progress: number,
): Promise<void> {
  if (!jobId || !Number.isFinite(progress) || progress === 0) return;
  try {
    const { data } = await client
      .from("platform_jobs")
      .select("progress_current")
      .eq("id", jobId)
      .maybeSingle();
    const current = (data?.progress_current as number | undefined) ?? 0;
    await client
      .from("platform_jobs")
      .update({ progress_current: current + progress })
      .eq("id", jobId);
  } catch {
    // swallow
  }
}
