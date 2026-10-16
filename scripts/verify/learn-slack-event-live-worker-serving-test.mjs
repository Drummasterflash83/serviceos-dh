/** Exercise the event-only overlay on the exact downloaded LIVE worker source. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patchLiveSlackEventWorker } from "./learn-slack-event-live-worker-overlay.mjs";

const root = ".verification-results/learn-slack-event-live-worker-baseline/supabase/functions/learn-slack-worker";
const index = patchLiveSlackEventWorker("index.ts", readFileSync(join(root, "index.ts"), "utf8"));
assert.match(index, /handleSlackEventSync\(ctx\) : handleSlackHistorySync\(ctx\)/);
const source = patchLiveSlackEventWorker("functions/_shared/slack/slack_worker.ts",
  readFileSync(join(root, "functions/_shared/slack/slack_worker.ts"), "utf8"))
  .replace(/^import .*;\n/gm, "").replace(/\bexport /g, "");
const run = new Function("captureAdmission", "deferCaptureJob",
  `${source}\nreturn runSlackWorker;`)(
    async () => ({ allowed: true }), async () => { throw Error("unexpected defer"); });
const tenant = "00000000-0000-4000-8000-000000000001";
async function exercise(jobType, handlerResult, finishFirst, finishSecond = null) {
  const calls = [];
  const job = { id: crypto.randomUUID(), tenant_id: tenant, job_type: jobType,
    claimed_by: "learn-slack:worker", attempt_count: 1,
    payload: {}, metadata: {} };
  let finished = 0;
  const db = { rpc: async (name, args) => {
    calls.push({ name, outcome: args?.p_outcome ?? null });
    if (name === "learn_slack_claim_jobs") return { data: [job], error: null };
    finished++;
    const result = finished === 1 ? finishFirst : finishSecond;
    const resolved = typeof result === "function" ? result(job) : result;
    return { data: resolved?.data ?? null, error: resolved?.error ?? null };
  } };
  let handled = 0;
  const result = await run(db, "worker", async ctx => {
    handled++;
    assert.equal(ctx.jobType, jobType);
    return handlerResult;
  });
  assert.equal(result.claimed, 1);
  assert.equal(handled, 1);
  return { calls, result };
}
await assert.rejects(exercise("slack.event_sync", { success: true },
  { data: { job_id: null } }), /slack_worker_settlement_failed/);
const event = await exercise("slack.event_sync", { success: true },
  job => ({ data: { job_id: job.id } }));
assert.deepEqual(event.calls.map(call => call.name),
  ["learn_slack_claim_jobs", "learn_slack_finish_event_job"]);
const retry = await exercise("slack.event_sync", { success: false,
  error: { code: "slack_event_network_error", retryable: true,
    retryAfterSeconds: 30 } },
  { error: { code: "PT409", message: "slack_event_source_receipt_missing" } },
  job => ({ data: { job_id: job.id } }));
assert.deepEqual(retry.calls.map(call => call.name),
  ["learn_slack_claim_jobs", "learn_slack_finish_event_job", "learn_slack_finish_event_job"]);
assert.deepEqual(retry.calls[2].outcome, { success: false,
  code: "slack_event_network_error", retryable: true, retry_after_seconds: 30 });
const history = await exercise("slack.history_sync", { success: true },
  job => ({ data: { job_id: job.id } }));
assert.deepEqual(history.calls.map(call => call.name),
  ["learn_slack_claim_jobs", "learn_slack_finish_job"]);
console.log(JSON.stringify({ state: "live_serving_overlay_pass",
  eventDispatch: true, eventSettlement: true, wrongSettlementRejected: true,
  legacyHistoryPathPreserved: true, providerRequests: 0 }));
