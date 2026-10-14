/** Fenced publication and confirmed atomic completion/continuation for LEARN's
 * retained-source processors. Other worker types keep their own lifecycle. */
import type {
  WorkerHandler,
  WorkerHandlerContext,
  WorkerHandlerResult,
} from "./worker_contract.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export const isLearnProcessingJob = (type: string) =>
  ["identity.resolve", "interactions.sync"].includes(type);
export type ProcessingOutcome = {
  state: "succeeded" | "retrying" | "dead_letter" | "unconfirmed";
  result: WorkerHandlerResult;
  historicalReceipt: boolean;
  continuationJobId?: string | null;
};
export async function runLearnProcessingJob(
  ctx: WorkerHandlerContext,
  handler: WorkerHandler,
): Promise<ProcessingOutcome> {
  const unconfirmed = (result: WorkerHandlerResult): ProcessingOutcome => ({
    state: "unconfirmed",
    result,
    historicalReceipt: false,
  });
  const invalid: WorkerHandlerResult = {
    success: false,
    error: {
      code: "processing_claim_unconfirmed",
      message: "Processing ownership or saved queue progress could not be confirmed.",
      retryable: false,
    },
  };
  if (
    !ctx.jobType ||
    !isLearnProcessingJob(ctx.jobType) ||
    !uuid(ctx.tenantId) ||
    !uuid(ctx.jobId) ||
    !ctx.claim?.claimedBy ||
    ctx.claim.claimedBy.length > 200 ||
    !Number.isSafeInteger(ctx.claim.attemptCount) ||
    ctx.claim.attemptCount < 1
  )
    return unconfirmed(invalid);
  const scope = {
    p_tenant: ctx.tenantId,
    p_job: ctx.jobId,
    p_worker: ctx.claim.claimedBy,
    p_attempt: ctx.claim.attemptCount,
  };
  const original = ctx.supabaseAdmin;
  const guarded = new Proxy(original, {
    get(target, key) {
      if (key === "rpc")
        return async (name: string, args: Record<string, unknown>) => {
          if (name === "learn_identity_deliver" || name === "learn_project_interaction") {
            if (
              args.p_tenant !== ctx.tenantId ||
              (name === "learn_identity_deliver") !== (ctx.jobType === "identity.resolve")
            )
              throw Error("Processing scope changed");
            return original.rpc("learn_processing_publish", {
              ...scope,
              p_request: args.p_request,
              p_source: name === "learn_identity_deliver" ? "identity" : args.p_source,
              p_source_id:
                name === "learn_identity_deliver" ? args.p_interaction : args.p_source_id,
              p_revision: args.p_revision,
              p_phase: args.p_phase,
            });
          }
          return original.rpc(name, args);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let result: WorkerHandlerResult;
  try {
    result = await handler({ ...ctx, supabaseAdmin: guarded });
  } catch {
    result = {
      success: false,
      error: {
        code: "processing_handler_failed",
        message:
          "Retained-input processing was interrupted. Stored inputs remain available for recovery.",
        retryable: true,
      },
    };
  }
  const continued = !!result.continuation;
  if (
    result.queueOutcome ||
    typeof result.success !== "boolean" ||
    !Number.isSafeInteger(result.recordsProcessed ?? 0) ||
    (result.recordsProcessed ?? 0) < 0
  )
    return unconfirmed(result);
  if (continued) {
    const c = result.continuation!,
      source = ctx.payload.source ?? "all";
    const key =
      ctx.jobType === "identity.resolve"
        ? `identity.resolve:${ctx.tenantId}`
        : `interactions.sync:${ctx.tenantId}:${source}`;
    const reviewContinuation =
      result.success === false &&
      result.error?.code ===
        (ctx.jobType === "identity.resolve"
          ? "identity_review_required"
          : "projection_review_required") &&
      result.error?.retryable === false &&
      result.result?.failed === 0 &&
      Number.isSafeInteger(result.result?.review_required) &&
      Number(result.result?.review_required) > 0 &&
      Number.isSafeInteger(result.result?.reviews_recorded) &&
      Number(result.result?.reviews_recorded) >= 0 &&
      result.result?.continued === true;
    if (
      (!result.success && !reviewContinuation) ||
      c.jobType !== ctx.jobType ||
      c.jobKey !== key ||
      c.connectorId !== "openfolk-core" ||
      c.moduleId !== (ctx.jobType === "identity.resolve" ? "core.identity" : "core.interactions") ||
      c.availableAt !== undefined
    )
      return unconfirmed(result);
  }
  const request = crypto.randomUUID();
  const definition = {
    success: result.success,
    records_processed: result.recordsProcessed ?? 0,
    result: result.result ?? {},
    continue: continued,
    retryable: result.success ? false : result.error?.retryable === true,
    error_code: result.success ? null : (result.error?.code ?? "processing_handler_failed"),
  };
  for (const phase of ["settle", "inspect"]) {
    try {
      const { data: r, error } = await original.rpc("learn_processing_settle", {
        ...scope,
        p_request: request,
        p_definition: definition,
        p_phase: phase,
      });
      if (
        !error &&
        r?.version === "learn-processing-settlement/1" &&
        r.tenant_id === ctx.tenantId &&
        r.job_id === ctx.jobId &&
        r.job_type === ctx.jobType &&
        r.attempt === ctx.claim.attemptCount &&
        r.worker === ctx.claim.claimedBy &&
        r.request_id === request &&
        ["succeeded", "retrying", "dead_letter"].includes(r.state) &&
        (r.state === "succeeded") === result.success &&
        r.records_processed === definition.records_processed &&
        Number.isSafeInteger(r.publications_committed) &&
        r.publications_committed >= definition.records_processed &&
        typeof r.settled_at === "string" &&
        Number.isFinite(Date.parse(r.settled_at)) &&
        (continued ? uuid(r.continuation_job_id) : r.continuation_job_id === null)
      )
        return {
          state: r.state,
          result,
          historicalReceipt: phase === "inspect",
          continuationJobId: r.continuation_job_id,
        };
    } catch {
      /* Inspect this exact request once. Never repeat an uncertain mutation. */
    }
  }
  return unconfirmed(result);
}
