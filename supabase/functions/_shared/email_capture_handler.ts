import { DELEGATION_CAPTURE_CODES } from "./gmail_capture_page.ts";
import { createEmailCapturePorts } from "./email_capture_ports.ts";
import { runEmailCaptureJob } from "./email_capture_engine.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./worker_contract.ts";
/** Only queue-owned calls may enter. The engine owns atomic email completion;
 * failures are settled against the same job/attempt/lease, never by ID alone.
 */
export async function handleEmailCapture(
  ctx: WorkerHandlerContext,
  deps = { run: runEmailCaptureJob, ports: createEmailCapturePorts },
): Promise<WorkerHandlerResult> {
  const type = ctx.jobType;
  if (
    !ctx.jobId ||
    !ctx.claim ||
    !["email.gmail_sync", "email.workspace_sync", "email.workspace_backfill"].includes(type ?? "")
  )
    return {
      success: false,
      error: {
        code: "email_claim_required",
        message: "Email capture requires an owned queue job.",
        retryable: false,
      },
    };
  const claim = { tenantId: ctx.tenantId, jobId: ctx.jobId, ...ctx.claim };
  try {
    const outcome = await deps.run(ctx.supabaseAdmin, claim, deps.ports(ctx.supabaseAdmin));
    if (
      outcome.jobId !== ctx.jobId ||
      !["completed", "deferred", "failed"].includes(outcome.state) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(outcome.attemptId)
    )
      throw Error();
    if (outcome.state === "deferred")
      return {
        success: false,
        error: {
          code: "learn_capture_" + outcome.reason,
          message: "Email capture is waiting for verified availability.",
          retryable: false,
        },
      };
    if (outcome.state === "completed")
      return {
        success: true,
        recordsProcessed: outcome.recordsProcessed,
        result: { sync_run_id: outcome.attemptId, coverage_complete: outcome.coverageComplete },
        queueOutcome: {
          state: "completed",
          jobId: ctx.jobId,
          historicalReceipt: outcome.historicalReceipt,
        },
      };
    const { data, error } = await ctx.supabaseAdmin.rpc("learn_email_job_fail", {
      p_tenant: ctx.tenantId,
      p_job: ctx.jobId,
      p_attempt: outcome.attemptId,
      p_claimed_by: ctx.claim.claimedBy,
      p_claim: ctx.claim.attemptCount,
    });
    const codes = [
      ...DELEGATION_CAPTURE_CODES,
      "history_expired",
      "continuation_expired",
      "pagination_no_progress",
      "fetch_failed",
      "parse_failed",
      "persistence_failed",
      "checkpoint_conflict",
      "source_ineligible",
      "unexpected_failure",
      "capture_failed",
    ];
    if (
      error ||
      data?.version !== "learn-email-job-failure/1" ||
      data.job_id !== ctx.jobId ||
      data.attempt_id !== outcome.attemptId ||
      !["applied", "replayed"].includes(data.disposition) ||
      !codes.includes(data.code)
    )
      throw Error();
    return {
      success: false,
      result: { sync_run_id: outcome.attemptId },
      queueOutcome: { state: "failed", jobId: ctx.jobId },
      error: {
        code: data.code,
        message: "Email capture requires operator review (" + data.code + ").",
        retryable: false,
      },
    };
  } catch {
    // The engine may already have committed a transition or completion. Leave
    // this lease alone so its authoritative state can be recovered after expiry.
    return {
      success: false,
      queueOutcome: { state: "unconfirmed", jobId: ctx.jobId },
      error: {
        code: "email_capture_unconfirmed",
        message: "Email capture is awaiting confirmation of its saved outcome.",
        retryable: true,
      },
    };
  }
}
