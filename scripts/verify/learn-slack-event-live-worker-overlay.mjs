/** Add event dispatch/settlement to the exact deployed LIVE Slack worker. */
import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const before = {
  "index.ts": "e140959c50259853013f5f30d3ecb1bf0c4fd68e73324e566ce2aaf1d5f06ea1",
  "functions/_shared/slack/slack_worker.ts": "5b90a881864f2338641b0c9729369782ae833aafde6d2a3202336c7fe552d91e",
};
function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first < 0 || source.indexOf(oldText, first + oldText.length) >= 0)
    throw Error("Serving Slack worker anchor changed");
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}
export function patchLiveSlackEventWorker(path, source) {
  if (sha256(source) !== before[path]) throw Error(`Serving Slack worker source changed: ${path}`);
  if (path === "index.ts") {
    source = replaceOnce(source,
      'import { handleSlackHistorySync } from "../_shared/worker_handlers/slack_history.ts";',
      'import { handleSlackHistorySync } from "../_shared/worker_handlers/slack_history.ts";\nimport { handleSlackEventSync } from "../_shared/slack/slack_event_worker.ts";');
    return replaceOnce(source,
      "runSlackWorker(admin, crypto.randomUUID(), handleSlackHistorySync, AbortSignal.timeout(90000))",
      "runSlackWorker(admin, crypto.randomUUID(), (ctx) => ctx.jobType === \"slack.event_sync\" ? handleSlackEventSync(ctx) : handleSlackHistorySync(ctx), AbortSignal.timeout(90000))");
  }
  if (path !== "functions/_shared/slack/slack_worker.ts")
    throw Error("Unexpected Slack worker module");
  source = replaceOnce(source,
    `      "slack.history_sync",
      "slack.thread_sync"`,
    `      "slack.history_sync",
      "slack.thread_sync",
      "slack.event_sync"`);
  source = replaceOnce(source,
    "if (!job.metadata?.slack_page_v1) {",
    "if (!job.metadata?.slack_page_v1 && !job.metadata?.slack_event_v1) {");
  source = replaceOnce(source,
    'code: "slack_history_worker_failed",\n            message: "Slack worker failed."',
    'code: job.job_type === "slack.event_sync" ? "slack_event_worker_failed" : "slack_history_worker_failed",\n            message: "Slack worker failed."');
  source = replaceOnce(source,
    'const finishRpc = job.job_type === "slack.thread_sync" ? "learn_slack_finish_thread_job" : "learn_slack_finish_job";',
    'const finishRpc = job.job_type === "slack.event_sync" ? "learn_slack_finish_event_job" : job.job_type === "slack.thread_sync" ? "learn_slack_finish_thread_job" : "learn_slack_finish_job";');
  source = replaceOnce(source,
    'settled.error.message !== "slack_queue_page_missing"',
    'settled.error.message !== (job.job_type === "slack.event_sync" ? "slack_event_source_receipt_missing" : "slack_queue_page_missing")');
  return replaceOnce(source,
    'const code = error?.code && /^slack_history_[a-z_]{1,80}$/.test(error.code) ? error.code : "slack_history_worker_failed";',
    `const code = error?.code && (job.job_type === "slack.event_sync" ?
        /^slack_event_[a-z_]{1,80}$/.test(error.code) :
        /^slack_history_[a-z_]{1,80}$/.test(error.code)) ? error.code :
        job.job_type === "slack.event_sync" ? "slack_event_worker_failed" : "slack_history_worker_failed";`);
}
