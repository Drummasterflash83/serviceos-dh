/** Confirmed, ownership-scoped lifecycle for the existing Phone recovery queue.
 * Does not claim individual recordings or authorize provider work by itself.
 */
import type { WorkerHandlerContext, WorkerHandlerResult } from "./worker_contract.ts";
type Db = { from: (table: string) => any };
export type PhoneJob = {
  tenantId: string;
  jobId: string;
  claim: { claimedBy: string; attemptCount: number };
};
export const PHONE_RECOVERY_LEASE_SECONDS = 300;
export const phoneJobUnconfirmed = (): WorkerHandlerResult => ({
  success: false,
  error: {
    code: "phone_job_unconfirmed",
    message:
      "Phone processing stopped because ownership or saved progress could not be confirmed. Review the job before retrying.",
    retryable: false,
  },
});
export function phoneJobContext(ctx: WorkerHandlerContext): PhoneJob | null {
  return ctx.jobId &&
    ctx.claim?.claimedBy &&
    Number.isSafeInteger(ctx.claim.attemptCount) &&
    ctx.claim.attemptCount > 0
    ? { tenantId: ctx.tenantId, jobId: ctx.jobId, claim: ctx.claim }
    : null;
}
function owned(db: Db, job: PhoneJob, patch: Record<string, unknown>, now: string) {
  return db
    .from("platform_jobs")
    .update(patch)
    .eq("id", job.jobId)
    .eq("tenant_id", job.tenantId)
    .eq("job_type", "phone.process_pending")
    .eq("status", "running")
    .eq("claimed_by", job.claim.claimedBy)
    .eq("attempt_count", job.claim.attemptCount)
    .gt("lease_expires_at", now)
    .select("id")
    .maybeSingle();
}
export async function claimManualPhoneJob(
  db: Db,
  tenantId: string,
  jobId: string,
  claimedBy: string,
): Promise<PhoneJob | null> {
  const now = new Date().toISOString();
  try {
    const saved = await db
      .from("platform_jobs")
      .update({
        status: "running",
        started_at: now,
        claimed_at: now,
        last_attempt_at: now,
        claimed_by: claimedBy,
        attempt_count: 1,
        lease_expires_at: new Date(Date.now() + PHONE_RECOVERY_LEASE_SECONDS * 1000).toISOString(),
      })
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .eq("job_type", "phone.process_pending")
      .eq("status", "queued")
      .eq("attempt_count", 0)
      .select("id")
      .maybeSingle();
    return !saved.error && saved.data?.id === jobId
      ? { tenantId, jobId, claim: { claimedBy, attemptCount: 1 } }
      : null;
  } catch {
    return null;
  }
}
export async function heartbeatPhoneJob(
  db: Db,
  job: PhoneJob,
  processed: number,
): Promise<boolean> {
  try {
    const now = new Date();
    const saved = await owned(
      db,
      job,
      {
        progress_current: processed,
        lease_expires_at: new Date(
          now.getTime() + PHONE_RECOVERY_LEASE_SECONDS * 1000,
        ).toISOString(),
      },
      now.toISOString(),
    );
    return !saved.error && saved.data?.id === job.jobId;
  } catch {
    return false;
  }
}
export async function settlePhoneJob(
  db: Db,
  job: PhoneJob,
  result: WorkerHandlerResult,
  maxAttempts?: number,
): Promise<"succeeded" | "failed" | "retrying" | "dead_letter" | "unconfirmed"> {
  if (result.error?.code === "phone_job_unconfirmed") return "unconfirmed";
  const now = new Date();
  const retry =
    !result.success &&
    result.error?.retryable === true &&
    job.claim.attemptCount < (maxAttempts ?? 1);
  const status = result.success
    ? "succeeded"
    : retry
      ? "retrying"
      : maxAttempts !== undefined
        ? "dead_letter"
        : "failed";
  const delay = [60, 300, 900, 3600][Math.min(job.claim.attemptCount - 1, 3)];
  const patch = {
    status,
    lease_expires_at: null,
    records_processed: result.recordsProcessed ?? 0,
    result: result.result ?? {},
    error_code: result.success ? null : (result.error?.code ?? "phone_process_failed"),
    last_error: result.success
      ? null
      : (result.error?.message ?? "Phone processing did not complete."),
    ...(result.success
      ? { completed_at: now.toISOString() }
      : { error_count: job.claim.attemptCount }),
    ...(retry
      ? {
          available_at: new Date(now.getTime() + delay * 1000).toISOString(),
          next_run_at: new Date(now.getTime() + delay * 1000).toISOString(),
        }
      : !result.success
        ? {
            failed_at: now.toISOString(),
            ...(status === "dead_letter" ? { dead_lettered_at: now.toISOString() } : {}),
          }
        : {}),
  };
  try {
    const saved = await owned(db, job, patch, now.toISOString());
    return !saved.error && saved.data?.id === job.jobId ? status : "unconfirmed";
  } catch {
    return "unconfirmed";
  }
}
