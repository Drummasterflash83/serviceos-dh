import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommusoftPageHandler, runCommusoftWorker } from "./worker.ts";
import { CommusoftReadError } from "./read_page.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-10T12:00:00Z");
const receipt = {
  pageId: id(9),
  checkpoint: { approvalId: id(6), pages: 1, after: 10, complete: false },
  records: 1,
  already: true,
};
function fixture() {
  const job: any = {
    id: id(2),
    tenant_id: id(1),
    job_type: "commusoft.source_sync",
    status: "running",
    claimed_by: `learn-commusoft:${id(50)}`,
    attempt_count: 1,
    metadata: {},
  };
  const calls: { name: string; args: any }[] = [];
  const state: any = {
    jobs: [job],
    claimError: null,
    published: true,
    finishError: null,
    yieldError: null,
    yieldAnswer: { job_id: id(2), status: "queued", retry_at: Date.now() + 3000 },
    answer: { job_id: id(2), status: "succeeded", successor_id: id(12) },
  };
  const db = {
    from() {
      throw Error("Unexpected direct database operation");
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      if (name === "learn_commusoft_claim_jobs")
        return { data: state.jobs, error: state.claimError };
      if (name === "learn_commusoft_yield_job")
        return { data: state.yieldAnswer, error: state.yieldError };
      if (name !== "learn_commusoft_finish_job") throw Error("Unexpected RPC");
      if (state.finishError) return { data: null, error: state.finishError };
      if (args.p_outcome.success && !state.published)
        return { data: null, error: { code: "PT409", message: "commusoft_queue_page_missing" } };
      return { data: state.answer, error: null };
    },
  };
  return { job, calls, state, db };
}
test("page handler recovers before any provider read or write", async () => {
  const calls: string[] = [];
  const handler = createCommusoftPageHandler({
    clock: () => now,
    recover: async () => {
      calls.push("recover");
      return receipt;
    },
    read: async () => {
      throw Error("Must not refetch committed page");
    },
    persist: async () => {
      throw Error("Must not republish committed page");
    },
  });
  assert.deepEqual(await handler({} as any), { success: true, receipt });
  assert.deepEqual(calls, ["recover"]);
});
test("uncommitted page follows recover, read, atomic persist sequence", async () => {
  const calls: string[] = [];
  const handler = createCommusoftPageHandler({
    clock: () => now,
    recover: async () => {
      calls.push("recover");
      return null;
    },
    read: async () => {
      calls.push("read");
      return { fixture: true } as any;
    },
    persist: async (_, input) => {
      assert.deepEqual(input, { fixture: true });
      calls.push("persist");
      return receipt;
    },
  });
  assert.equal((await handler({} as any)).success, true);
  assert.deepEqual(calls, ["recover", "read", "persist"]);
});
test("failed recovery never becomes permission to fetch; private errors are hidden", async () => {
  const handler = createCommusoftPageHandler({
    clock: () => now,
    recover: async () => {
      throw Error("private source details");
    },
    read: async () => {
      throw Error("must not run");
    },
    persist: async () => receipt,
  });
  assert.deepEqual(await handler({} as any), {
    success: false,
    error: { code: "commusoft_worker_failed", retryable: true, retryAfterSeconds: 0 },
  });
});
test("provider throttle retains its minimum delay; invalid authority is not retried", async () => {
  for (const [error, retryable, delay] of [
    [new CommusoftReadError("rate_limited", now + 90000), true, 90],
    [new CommusoftReadError("lease_wait", now + 90000), true, 90],
    [new CommusoftReadError("authentication_required"), false, 0],
    [new CommusoftReadError("authority_unavailable"), false, 0],
    [new CommusoftReadError("request_window_expired"), true, 0],
    [new CommusoftReadError("authority_transport_unavailable"), true, 0],
  ] as const) {
    const handler = createCommusoftPageHandler({
      clock: () => now,
      recover: async () => null,
      read: async () => {
        throw error;
      },
      persist: async () => receipt,
    });
    const result = await handler({} as any);
    assert.deepEqual(result, {
      success: false,
      error: { code: `commusoft_${error.code}`, retryable, retryAfterSeconds: delay },
    });
  }
});
test("runner passes exact claim and settles database-derived successor", async () => {
  const f = fixture();
  const result = await runCommusoftWorker(f.db, id(50), async (ctx) => {
    assert.equal(ctx.tenantId, id(1));
    assert.equal(ctx.jobId, id(2));
    assert.equal(ctx.jobType, "commusoft.source_sync");
    assert.deepEqual(ctx.claim, { claimedBy: `learn-commusoft:${id(50)}`, attemptCount: 1 });
    return { success: true, receipt };
  });
  assert.deepEqual(result, { claimed: 1, outcomes: [f.state.answer] });
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["learn_commusoft_claim_jobs", "learn_commusoft_finish_job"],
  );
  assert.deepEqual(f.calls[1].args.p_outcome, { success: true });
});
test("lost publication reply still settles success if SQL finds the retained page", async () => {
  const f = fixture();
  const result = await runCommusoftWorker(f.db, id(50), async () => {
    throw Error("response lost");
  });
  assert.equal(result.outcomes[0].status, "succeeded");
  assert.equal(f.calls.length, 2);
});
test("only confirmed missing publication allows failure settlement", async () => {
  const f = fixture();
  f.state.published = false;
  f.state.answer = { job_id: id(2), status: "retrying", successor_id: null };
  const result = await runCommusoftWorker(f.db, id(50), async () => ({
    success: false,
    error: { code: "commusoft_rate_limited", retryable: true, retryAfterSeconds: 600 },
  }));
  assert.equal(result.outcomes[0].status, "retrying");
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls[2].args.p_outcome, {
    success: false,
    code: "commusoft_rate_limited",
    retryable: true,
    retry_after_seconds: 600,
  });
});
test("lease contention yields the same page without failure settlement", async () => {
  const f = fixture();
  f.state.published = false;
  const result = await runCommusoftWorker(f.db, id(50), async () => ({
    success: false,
    error: { code: "commusoft_lease_wait", retryable: true, retryAfterSeconds: 40 },
  }));
  assert.deepEqual(result, { claimed: 1,
    outcomes: [{ job_id: id(2), status: "queued", successor_id: null }] });
  assert.deepEqual(f.calls.map((call) => call.name),
    ["learn_commusoft_claim_jobs", "learn_commusoft_finish_job", "learn_commusoft_yield_job"]);
  assert.equal(f.calls[2].args.p_attempt_count, 1);
  assert.equal(f.calls[2].args.p_claimed_by, `learn-commusoft:${id(50)}`);
  const g = fixture();
  g.state.published = false;
  g.state.yieldError = { code: "PT409" };
  await assert.rejects(runCommusoftWorker(g.db, id(50), async () => ({
    success: false,
    error: { code: "commusoft_lease_wait", retryable: true, retryAfterSeconds: 40 },
  })), /yield_failed/);
});
test("claim and settlement failures stay visible instead of reporting no work or inventing completion", async () => {
  const f = fixture();
  f.state.claimError = { message: "private" };
  await assert.rejects(runCommusoftWorker(f.db, id(50)), /claim_failed/);
  const g = fixture();
  g.state.finishError = { code: "PT409", message: "some_other_error" };
  await assert.rejects(
    runCommusoftWorker(g.db, id(50), async () => ({
      success: false,
      error: { code: "commusoft_worker_failed", retryable: true, retryAfterSeconds: 0 },
    })),
    /settlement_failed/,
  );
  assert.equal(g.calls.length, 2);
});
test("invalid or overbroad claims cannot dispatch a handler", async () => {
  for (const change of [
    { claimed_by: "other" },
    { tenant_id: "invalid" },
    { attempt_count: 0 },
    { job_type: "email.gmail_sync" },
    { status: "queued" },
  ]) {
    const f = fixture();
    Object.assign(f.job, change);
    await assert.rejects(
      runCommusoftWorker(f.db, id(50), async () => {
        throw Error("must not dispatch");
      }),
      /claim_invalid/,
    );
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  f.state.jobs = [f.job, f.job];
  await assert.rejects(runCommusoftWorker(f.db, id(50)), /claim_failed/);
});
test("success without a durable page is not accepted and settlement output is bounded", async () => {
  const f = fixture();
  f.state.published = false;
  await assert.rejects(
    runCommusoftWorker(f.db, id(50), async () => ({ success: true, receipt })),
    /settlement_failed/,
  );
  assert.equal(f.calls.length, 2);
  const g = fixture();
  g.state.answer.source = "private source";
  const result = await runCommusoftWorker(g.db, id(50), async () => ({ success: true, receipt }));
  assert.equal(JSON.stringify(result).includes("private"), false);
});
