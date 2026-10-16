import { test } from "node:test";
import assert from "node:assert/strict";
import { runSlackWorker } from "./slack_worker.ts";
const worker = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const job = {
    id: "job",
    tenant_id: "00000000-0000-4000-8000-000000000002",
    job_type: "slack.history_sync",
    claimed_by: `learn-slack:${worker}`,
    attempt_count: 2,
    payload: { connector_account_id: "account" } as Record<string, string>,
    metadata: {} as Record<string, unknown>,
  };
  const calls: { name: string; args: any }[] = [];
  const state = {
    published: false,
    claimError: false,
    settleError: false,
    allowed: true,
    admissions: 0,
  };
  const db = {
    rpc: async (name: string, args: any) => {
      if (name === "learn_capture_admission") {
        state.admissions++;
        return {
          data: {
            version: "learn-capture-admission/1",
            tenant_id: job.tenant_id,
            source: "slack",
            allowed: state.allowed,
            checked_at: new Date().toISOString(),
          },
          error: null,
        };
      }
      calls.push({ name, args });
      if (name === "learn_capture_defer_job")
        return {
          data: {
            job_id: job.id,
            state: "waiting",
            reason: args.p_reason,
            attempt_count: job.attempt_count - 1,
          },
          error: null,
        };
      if (name === "learn_slack_claim_jobs")
        return state.claimError
          ? { data: null, error: { message: "private" } }
          : { data: [job], error: null };
      assert.equal(
        name,
        job.job_type === "slack.event_sync"
          ? "learn_slack_finish_event_job"
          : job.job_type === "slack.thread_sync"
          ? "learn_slack_finish_thread_job"
          : "learn_slack_finish_job",
      );
      if (state.settleError)
        return { data: null, error: { code: "XX000", message: "private database failure" } };
      if (args.p_outcome.success && !state.published && !job.metadata.slack_page_v1 &&
          !job.metadata.slack_event_v1)
        return { data: null, error: { code: "PT409", message: job.job_type === "slack.event_sync"
          ? "slack_event_source_receipt_missing" : "slack_queue_page_missing" } };
      return {
        data: {
          job_id: job.id,
          status: args.p_outcome.success ? "succeeded" : "retrying",
          successor_id: null,
        },
        error: null,
      };
    },
  };
  return { job, calls, state, db };
}
test("one scoped claim passes the ownership fence and settles the server-derived continuation", async () => {
  const f = fixture();
  const r = await runSlackWorker(f.db, worker, async (ctx) => {
    assert.deepEqual(ctx.claim, { claimedBy: `learn-slack:${worker}`, attemptCount: 2 });
    assert.equal(ctx.tenantId, f.job.tenant_id);
    f.state.published = true;
    return { success: true, continuation: { jobType: "malicious", jobKey: "untrusted" } };
  });
  assert.equal(r.claimed, 1);
  assert.deepEqual(f.calls[0].args, { p_worker: worker, p_batch: 1 });
  assert.deepEqual(f.calls[1].args.p_outcome, { success: true });
  assert.equal(JSON.stringify(f.calls).includes("malicious"), false);
});
test("thread jobs carry their trusted type and recover through the thread completion transaction", async () => {
  const f = fixture();
  f.job.job_type = "slack.thread_sync";
  await runSlackWorker(f.db, worker, async (ctx) => {
    assert.equal(ctx.jobType, "slack.thread_sync");
    f.state.published = true;
    return {
      success: false,
      error: { code: "slack_history_failed", message: "lost response", retryable: false },
    };
  });
  assert.equal(f.calls[1].name, "learn_slack_finish_thread_job");
  assert.deepEqual(f.calls[1].args.p_outcome, { success: true });
  const recovered = fixture();
  recovered.job.job_type = "slack.thread_sync";
  recovered.job.metadata.slack_page_v1 = { kind: "thread" };
  await runSlackWorker(recovered.db, worker, async () => {
    throw Error("Unexpected provider request");
  });
  assert.equal(recovered.calls[1].name, "learn_slack_finish_thread_job");
});
test("event jobs use their own settlement and retry without exposing provider prose", async () => {
  const f = fixture();
  f.job.job_type = "slack.event_sync";
  f.job.payload = { event_id: "EvSYNTH1234" };
  await runSlackWorker(f.db, worker, async (ctx) => {
    assert.equal(ctx.jobType, "slack.event_sync");
    assert.deepEqual(ctx.payload, { event_id: "EvSYNTH1234" });
    return { success: false, error: { code: "slack_event_rate_limited",
      message: "private provider prose", retryable: true, retryAfterSeconds: 90 } };
  });
  assert.equal(f.calls[1].name, "learn_slack_finish_event_job");
  assert.deepEqual(f.calls[2].args.p_outcome, { success: false,
    code: "slack_event_rate_limited", retryable: true, retry_after_seconds: 90 });
  assert.equal(JSON.stringify(f.calls).includes("private provider prose"), false);

  const recovered = fixture();
  recovered.job.job_type = "slack.event_sync";
  recovered.job.metadata.slack_event_v1 = { outcome: "stored_source" };
  await runSlackWorker(recovered.db, worker, async () => {
    throw Error("Committed event fetched again");
  });
  assert.equal(recovered.state.admissions, 0);
  assert.equal(recovered.calls[1].name, "learn_slack_finish_event_job");
});
test("a recovered committed page skips the provider entirely", async () => {
  const f = fixture();
  f.job.metadata.slack_page_v1 = { next: { pages: 1 } };
  await runSlackWorker(f.db, worker, async () => {
    throw Error("Provider must not be called");
  });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].args.p_outcome.success, true);
});
test("lost publication response is resolved from durable state before recording failure", async () => {
  const f = fixture();
  await runSlackWorker(f.db, worker, async () => {
    f.state.published = true;
    return {
      success: false,
      error: { code: "slack_history_failed", message: "uncertain response", retryable: false },
    };
  });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].args.p_outcome, { success: true });
});
test("unpublished rate limit preserves its minimum delay; provider prose is never persisted", async () => {
  const f = fixture();
  await runSlackWorker(f.db, worker, async () => ({
    success: false,
    error: {
      code: "slack_history_rate_limited",
      message: "private provider prose",
      retryable: true,
      retryAfterSeconds: 120,
    },
  }));
  assert.deepEqual(f.calls[2].args.p_outcome, {
    success: false,
    code: "slack_history_rate_limited",
    retryable: true,
    retry_after_seconds: 120,
  });
  assert.equal(JSON.stringify(f.calls).includes("private"), false);
});
test("database failure is visible and never becomes an empty successful claim or a guessed terminal write", async () => {
  const f = fixture();
  f.state.claimError = true;
  await assert.rejects(
    runSlackWorker(f.db, worker, async () => ({ success: true })),
    /slack_worker_claim_failed/,
  );
  assert.equal(f.calls.length, 1);
  const g = fixture();
  g.state.settleError = true;
  await assert.rejects(
    runSlackWorker(g.db, worker, async () => ({ success: false })),
    /slack_worker_settlement_failed/,
  );
  assert.equal(g.calls.length, 2);
});
test("foreign job types and replaced ownership are refused before handler execution", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => (f.job.job_type = "email.gmail_sync"),
    (f: ReturnType<typeof fixture>) => (f.job.claimed_by = "other-worker"),
  ]) {
    const f = fixture();
    mutate(f);
    let called = false;
    await assert.rejects(
      runSlackWorker(f.db, worker, async () => {
        called = true;
        return { success: true };
      }),
      /slack_worker_claim_invalid/,
    );
    assert.equal(called, false);
    assert.equal(f.calls.length, 1);
  }
});

test("pause after claim waits without calling a provider or marking capture successful", async () => {
  const f = fixture();
  f.state.allowed = false;
  const r = await runSlackWorker(f.db, worker, async () => {
    throw Error("Provider accessed while paused");
  });
  assert.equal(f.state.admissions, 1);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["learn_slack_claim_jobs", "learn_capture_defer_job"],
  );
  assert.deepEqual(r.outcomes, [
    { job_id: f.job.id, state: "waiting", reason: "paused", attempt_count: 1 },
  ]);
  const saved = fixture();
  saved.state.allowed = false;
  saved.job.metadata.slack_page_v1 = { saved: true };
  await runSlackWorker(saved.db, worker, async () => {
    throw Error("Saved page fetched again");
  });
  assert.equal(saved.state.admissions, 0);
  assert.equal(saved.calls[1].name, "learn_slack_finish_job");
});
