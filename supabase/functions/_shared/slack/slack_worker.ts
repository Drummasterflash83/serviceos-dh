import type { WorkerHandlerContext, WorkerHandlerResult } from "../worker_handlers/index.ts";

type Job = {
  id: string;
  tenant_id: string;
  job_type: string;
  claimed_by: string;
  attempt_count: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
};
type Database = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
/** Only Slack is claimed. Database failures remain visible and leave the lease
 * recoverable; this adapter never performs best-effort direct queue updates. */
export async function runSlackWorker(
  db: Database,
  workerId: string,
  handler: (ctx: WorkerHandlerContext) => Promise<WorkerHandlerResult>,
  signal?: AbortSignal,
) {
  const claimed = await db.rpc("learn_slack_claim_jobs", { p_worker: workerId, p_batch: 1 });
  if (claimed.error || !Array.isArray(claimed.data)) throw Error("slack_worker_claim_failed");
  const outcomes: unknown[] = [];
  for (const job of claimed.data as Job[]) {
    if (
      job.job_type !== "slack.history_sync" ||
      job.claimed_by !== `learn-slack:${workerId}` ||
      !Number.isSafeInteger(job.attempt_count) ||
      job.attempt_count < 1
    )
      throw Error("slack_worker_claim_invalid");
    const args = {
      p_tenant_id: job.tenant_id,
      p_job_id: job.id,
      p_claimed_by: job.claimed_by,
      p_attempt_count: job.attempt_count,
    };
    let result: WorkerHandlerResult = { success: true };
    // A committed page survives an HTTP timeout or process restart. It needs only
    // settlement, never a repeated provider request or another page in this job.
    if (!job.metadata?.slack_page_v1) {
      try {
        result = await handler({
          supabaseAdmin: db as WorkerHandlerContext["supabaseAdmin"],
          tenantId: job.tenant_id,
          jobId: job.id,
          payload: job.payload,
          claim: { claimedBy: job.claimed_by, attemptCount: job.attempt_count },
          signal,
        });
      } catch {
        result = {
          success: false,
          error: {
            code: "slack_history_worker_failed",
            message: "Slack worker failed.",
            retryable: true,
          },
        };
      }
    }
    // Probe committed state even after a handler failure: publication may have
    // succeeded while its response was lost. SQL derives the result/continuation.
    let settled = await db.rpc("learn_slack_finish_job", { ...args, p_outcome: { success: true } });
    if (settled.error) {
      if (
        result.success ||
        settled.error.code !== "PT409" ||
        settled.error.message !== "slack_queue_page_missing"
      )
        throw Error("slack_worker_settlement_failed");
      const error = result.error;
      const code =
        error?.code && /^slack_history_[a-z_]{1,80}$/.test(error.code)
          ? error.code
          : "slack_history_worker_failed";
      const delay = error?.retryAfterSeconds;
      const retryAfter =
        Number.isSafeInteger(delay) && delay! >= 0 && delay! <= 31536000 ? delay! : 0;
      settled = await db.rpc("learn_slack_finish_job", {
        ...args,
        p_outcome: {
          success: false,
          code,
          retryable: error?.retryable === true,
          retry_after_seconds: retryAfter,
        },
      });
    }
    if (settled.error || !settled.data || settled.data.job_id !== job.id)
      throw Error("slack_worker_settlement_failed");
    outcomes.push(settled.data);
  }
  return { claimed: claimed.data.length, outcomes };
}
