import { createMicrosoftCapturePorts } from "./microsoft_capture_ports.ts";
import { runMicrosoftCaptureJob } from "./microsoft_capture_job.ts";
import { MicrosoftMailError, object, uuid } from "./microsoft_graph_transport.ts";
import { MicrosoftCredentialError } from "./microsoft_oauth.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./worker_contract.ts";

/** The engine settles completion and successor creation atomically. Unknown
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
    let code: string =
      error instanceof MicrosoftMailError
        ? error.code
        : error instanceof MicrosoftCredentialError && error.code !== "credential_save_unconfirmed"
          ? error.code
          : "capture_unconfirmed";
    let retryAfter = error instanceof MicrosoftMailError ? error.retryAfterSeconds : null;
    if (
      retryAfter !== null &&
      (!Number.isSafeInteger(retryAfter) || retryAfter < 0 || retryAfter > 31536000)
    ) {
      // Never shorten an unsupported provider delay or allow lease recovery to
      // issue another request early. Hold this job for an operator instead.
      code = "retry_delay_requires_review";
      retryAfter = null;
    }
    try {
      const { data, error: stopError } = await ctx.supabaseAdmin.rpc("learn_microsoft_job_stop", {
        p_tenant: ctx.tenantId,
        p_job: ctx.jobId,
        p_worker: ctx.claim.claimedBy,
        p_claim: ctx.claim.attemptCount,
        p_code: code,
        p_retry_after: retryAfter,
      });
      if (
        stopError ||
        !object(data) ||
        data.contract !== "microsoft-job-stop/1" ||
        data.tenantId !== ctx.tenantId ||
        data.jobId !== ctx.jobId ||
        !["waiting", "retrying", "failed"].includes(data.state) ||
        data.code !== (data.state === "waiting" ? "capture_paused" : code) ||
        data.attemptCount !== ctx.claim.attemptCount - (data.state === "waiting" ? 1 : 0) ||
        typeof data.historicalReceipt !== "boolean" ||
        (data.state === "failed"
          ? data.availableAt !== null
          : typeof data.availableAt !== "string" || !Number.isFinite(Date.parse(data.availableAt)))
      )
        throw Error();
      return {
        success: false,
        queueOutcome: {
          state: data.state,
          jobId: ctx.jobId,
          historicalReceipt: data.historicalReceipt,
        },
        result: { available_at: data.availableAt, coverage_complete: false },
        error: {
          code: `microsoft_${data.code}`,
          message: `Microsoft mail capture: ${data.code}.`,
          retryable: data.state === "retrying",
          ...(retryAfter !== null ? { retryAfterSeconds: retryAfter } : {}),
        },
      };
    } catch {
      /* A missing/ambiguous stop receipt leaves the lease for recovery. */
    }
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
