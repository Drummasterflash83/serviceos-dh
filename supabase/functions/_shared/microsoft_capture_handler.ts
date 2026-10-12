import { createMicrosoftCapturePorts } from "./microsoft_capture_ports.ts";
import { runMicrosoftCaptureJob } from "./microsoft_capture_job.ts";
import { MicrosoftMailError, uuid } from "./microsoft_graph_transport.ts";
import { MicrosoftCredentialError } from "./microsoft_oauth.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./worker_contract.ts";

/** Prepared, not registered: lease-fenced failure/pause settlement is still needed.
 * The engine settles completion and successor creation atomically. Unknown
 * commit/settlement acknowledgements must never be overwritten by the worker. */
export async function handleMicrosoftCapture(
  ctx: WorkerHandlerContext,
  deps = { run: runMicrosoftCaptureJob, ports: createMicrosoftCapturePorts },
): Promise<WorkerHandlerResult> {
  if (
    !uuid(ctx.jobId) ||
    !uuid(ctx.tenantId) ||
    !ctx.claim?.claimedBy ||
    !Number.isSafeInteger(ctx.claim.attemptCount) ||
    ctx.claim.attemptCount < 1 ||
    !["email.microsoft_discovery", "email.microsoft_sync"].includes(ctx.jobType ?? "") ||
    ctx.signal?.aborted
  )
    return {
      success: false,
      error: {
        code: "microsoft_claim_required",
        message: "Microsoft mail capture requires an owned queue job.",
        retryable: false,
      },
    };
  try {
    const outcome = await deps.run(
      ctx.supabaseAdmin,
      {
        tenantId: ctx.tenantId,
        jobId: ctx.jobId,
        ...ctx.claim,
      },
      deps.ports(ctx.supabaseAdmin),
    );
    if (
      outcome.tenantId !== ctx.tenantId ||
      outcome.jobId !== ctx.jobId ||
      outcome.state !== "completed" ||
      outcome.mailboxCoverage !== "unverified" ||
      !Number.isSafeInteger(outcome.observationsStored) ||
      outcome.observationsStored < 0 ||
      outcome.observationsStored > 1000
    )
      throw Error();
    return {
      success: true,
      recordsProcessed: outcome.observationsStored,
      queueOutcome: { state: "completed", jobId: ctx.jobId },
      result: {
        source_receipt_id: outcome.sourceReceiptId,
        observations_stored: outcome.observationsStored,
        coverage_complete: false,
        successor_id: outcome.successorId,
      },
    };
  } catch (error) {
    if (error instanceof MicrosoftMailError)
      return {
        success: false,
        error: {
          code: `microsoft_${error.code}`,
          message: error.message,
          retryable: ["fetch_failed", "throttled", "provider_unavailable"].includes(error.code),
          ...(error.retryAfterSeconds !== null
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        },
      };
    if (error instanceof MicrosoftCredentialError && error.code !== "credential_save_unconfirmed")
      return {
        success: false,
        error: {
          code: `microsoft_${error.code}`,
          message: error.message,
          retryable: error.code === "refresh_failed",
        },
      };
    return {
      success: false,
      queueOutcome: { state: "unconfirmed", jobId: ctx.jobId },
      error: {
        code: "microsoft_capture_unconfirmed",
        message: "Microsoft mail capture is awaiting confirmation of its saved outcome.",
        retryable: true,
      },
    };
  }
}
