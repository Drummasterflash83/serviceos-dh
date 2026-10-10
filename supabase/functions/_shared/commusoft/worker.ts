import { CommusoftReadError } from "./read_page.ts";
import { readApprovedCommusoftPage } from "./bound_page.ts";
import { createCommusoftPermitPorts } from "./permit_server.ts";
import { committedCommusoftPage, persistCommusoftPage } from "./page_store.ts";
import type { RpcContext, CommusoftPageReceipt } from "./page_store.ts";

export type CommusoftWorkerResult =
  | { success: true; receipt: CommusoftPageReceipt }
  | { success: false; error: { code: string; retryable: boolean; retryAfterSeconds: number } };
export interface CommusoftPageWorkerPorts {
  recover: typeof committedCommusoftPage;
  read: (ctx: RpcContext) => ReturnType<typeof readApprovedCommusoftPage>;
  persist: typeof persistCommusoftPage;
  clock: () => number;
}
export function createCommusoftPageHandler(ports: CommusoftPageWorkerPorts) {
  return async (ctx: RpcContext): Promise<CommusoftWorkerResult> => {
    try {
      const retained = await ports.recover(ctx);
      if (retained) return { success: true, receipt: retained };
      const read = await ports.read(ctx);
      const receipt = await ports.persist(ctx, read);
      return { success: true, receipt };
    } catch (error) {
      if (error instanceof CommusoftReadError) {
        return {
          success: false,
          error: {
            code: `commusoft_${error.code}`,
            retryable: ["rate_limited", "transport_unavailable", "provider_unavailable"].includes(
              error.code,
            ),
            retryAfterSeconds:
              error.retryAt === null
                ? 0
                : Math.min(
                    31536000,
                    Math.max(0, Math.ceil((error.retryAt - ports.clock()) / 1000)),
                  ),
          },
        };
      }
      // An uncertain publication is recoverable. Never copy thrown content.
      return {
        success: false,
        error: { code: "commusoft_worker_failed", retryable: true, retryAfterSeconds: 0 },
      };
    }
  };
}
export const handleCommusoftSourcePage = createCommusoftPageHandler({
  recover: committedCommusoftPage,
  read: (ctx) => readApprovedCommusoftPage(ctx, createCommusoftPermitPorts(ctx)),
  persist: persistCommusoftPage,
  clock: Date.now,
});

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
/** Dedicated worker, not the generic best-effort queue dispatcher. SQL derives
 * completion and the successor atomically from the committed page and current
 * stored approval. A lost settlement response is left for fenced recovery.
 */
export async function runCommusoftWorker(
  db: RpcContext["supabaseAdmin"],
  workerId: string,
  handler: (ctx: RpcContext) => Promise<CommusoftWorkerResult> = handleCommusoftSourcePage,
  signal?: AbortSignal,
) {
  if (!uuid(workerId) || signal?.aborted) throw Error("commusoft_worker_unavailable");
  const claimed = await db.rpc("learn_commusoft_claim_jobs", { p_worker: workerId });
  if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length > 1)
    throw Error("commusoft_worker_claim_failed");
  const outcomes = [];
  for (const raw of claimed.data) {
    const job = raw as Record<string, any>;
    if (
      !job ||
      !uuid(job.id) ||
      !uuid(job.tenant_id) ||
      job.job_type !== "commusoft.source_sync" ||
      job.status !== "running" ||
      job.claimed_by !== `learn-commusoft:${workerId}` ||
      !Number.isSafeInteger(job.attempt_count) ||
      job.attempt_count < 1
    )
      throw Error("commusoft_worker_claim_invalid");
    const args = {
      p_tenant_id: job.tenant_id,
      p_job_id: job.id,
      p_claimed_by: job.claimed_by,
      p_attempt_count: job.attempt_count,
    };
    let result: CommusoftWorkerResult;
    try {
      result = await handler({
        supabaseAdmin: db,
        tenantId: job.tenant_id,
        jobId: job.id,
        jobType: job.job_type,
        claim: { claimedBy: job.claimed_by, attemptCount: job.attempt_count },
        signal,
      });
    } catch {
      result = {
        success: false,
        error: { code: "commusoft_worker_failed", retryable: true, retryAfterSeconds: 0 },
      };
    }
    // Publication may have committed even if its response was lost. Probe that
    // state first, regardless of the handler result; never overwrite it as failed.
    let settled = await db.rpc("learn_commusoft_finish_job", {
      ...args,
      p_outcome: { success: true },
    });
    const failure = settled.error as { code?: string; message?: string } | null;
    if (failure) {
      if (
        result.success ||
        failure.code !== "PT409" ||
        failure.message !== "commusoft_queue_page_missing"
      ) {
        throw Error("commusoft_worker_settlement_failed");
      }
      const error = result.error;
      settled = await db.rpc("learn_commusoft_finish_job", {
        ...args,
        p_outcome: {
          success: false,
          code: /^commusoft_[a-z_]{1,80}$/.test(error.code)
            ? error.code
            : "commusoft_worker_failed",
          retryable: error.retryable === true,
          retry_after_seconds:
            Number.isSafeInteger(error.retryAfterSeconds) &&
            error.retryAfterSeconds >= 0 &&
            error.retryAfterSeconds <= 31536000
              ? error.retryAfterSeconds
              : 0,
        },
      });
    }
    const answer = settled.data as Record<string, unknown> | null;
    if (
      settled.error ||
      !answer ||
      answer.job_id !== job.id ||
      !["succeeded", "retrying", "dead_letter"].includes(String(answer.status)) ||
      (answer.successor_id !== null && !uuid(answer.successor_id))
    )
      throw Error("commusoft_worker_settlement_failed");
    outcomes.push({ job_id: job.id, status: answer.status, successor_id: answer.successor_id });
  }
  return { claimed: claimed.data.length, outcomes };
}
