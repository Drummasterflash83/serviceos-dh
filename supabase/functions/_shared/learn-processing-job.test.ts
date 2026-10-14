import test from "node:test";
import assert from "node:assert/strict";
import { runLearnProcessingJob } from "./learn-processing-job.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(options: any = {}) {
  const calls: any[] = [];
  let saved: any = null;
  let handlerCalls = 0;
  const db: any = {
    rpc: async (name: string, a: any) => {
      calls.push({ name, a });
      if (name === "learn_processing_publish")
        return { data: { state: "committed", request: a.p_request }, error: null };
      if (name === "learn_identity_pending") return { data: [], error: null };
      assert.equal(name, "learn_processing_settle");
      if (a.p_phase === "settle") {
        saved = {
          version: "learn-processing-settlement/1",
          tenant_id: id(1),
          job_id: id(2),
          attempt: 1,
          worker: "synthetic-worker",
          request_id: a.p_request,
          job_type: "identity.resolve",
          state: options.failed ? "retrying" : "succeeded",
          continuation_job_id: options.continue ? id(4) : null,
          records_processed: 0,
          publications_committed: 0,
          settled_at: new Date().toISOString(),
        };
        if (options.lost) throw Error("PRIVATE lost reply");
      }
      return options.unconfirmed
        ? { data: null, error: { message: "PRIVATE" } }
        : { data: { ...saved, ...options.patch }, error: null };
    },
  };
  const ctx: any = {
    supabaseAdmin: db,
    tenantId: id(1),
    jobId: id(2),
    jobType: "identity.resolve",
    payload: { limit: 20 },
    claim: { claimedBy: "synthetic-worker", attemptCount: 1 },
  };
  const handler: any = async (c: any) => {
    handlerCalls++;
    if (options.publish)
      await c.supabaseAdmin.rpc("learn_identity_deliver", {
        p_tenant: id(1),
        p_request: id(3),
        p_interaction: id(5),
        p_revision: "a".repeat(64),
        p_phase: "publish",
      });
    if (options.throw) throw Error("PRIVATE raw exception");
    return (
      options.result ??
      (options.failed
        ? {
            success: false,
            result: { failed: 1 },
            error: {
              code: "identity_delivery_unconfirmed",
              message: "Retained input needs retry",
              retryable: true,
            },
          }
        : { success: true, result: { resolved: 0 } })
    );
  };
  return {
    ctx,
    calls,
    run: () => runLearnProcessingJob(ctx, handler),
    handlerCalls: () => handlerCalls,
  };
}
test("worker publications carry exact job ownership; completion uses only the atomic RPC", async () => {
  const f = fixture({ publish: true });
  const r = await f.run();
  assert.equal(r.state, "succeeded");
  assert.equal(f.calls[0].name, "learn_processing_publish");
  assert.deepEqual(f.calls[0].a, {
    p_tenant: id(1),
    p_job: id(2),
    p_worker: "synthetic-worker",
    p_attempt: 1,
    p_request: id(3),
    p_source: "identity",
    p_source_id: id(5),
    p_revision: "a".repeat(64),
    p_phase: "publish",
  });
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["learn_processing_publish", "learn_processing_settle"],
  );
});
test("lost settlement reply inspects the original request once, without another mutation", async () => {
  const f = fixture({ lost: true });
  const r = await f.run();
  assert.equal(r.state, "succeeded");
  assert.equal(r.historicalReceipt, true);
  assert.deepEqual(
    f.calls.map((c) => c.a.p_phase),
    ["settle", "inspect"],
  );
  assert.equal(f.calls[0].a.p_request, f.calls[1].a.p_request);
});
test("unconfirmed, foreign and malformed receipts never declare completion", async () => {
  for (const options of [
    { unconfirmed: true },
    { patch: { tenant_id: id(8) } },
    { patch: { worker: "other" } },
    { patch: { attempt: 2 } },
    { patch: { continuation_job_id: id(9) } },
    { patch: { records_processed: 99 } },
    { patch: { state: "retrying" } },
    { patch: { request_id: id(9) } },
  ])
    assert.equal((await fixture(options).run()).state, "unconfirmed");
});
test("missing claim or foreign continuation prevents a false tracked completion", async () => {
  const f = fixture();
  delete f.ctx.claim;
  assert.equal((await f.run()).state, "unconfirmed");
  assert.equal(f.handlerCalls(), 0);
  assert.equal(f.calls.length, 0);
  const g = fixture({
    result: { success: true, continuation: { jobType: "marketing.dispatch", jobKey: "other" } },
  });
  assert.equal((await g.run()).state, "unconfirmed");
  assert.equal(g.calls.length, 0);
});
test("handler failure is bounded and settles retry state without raw exception data", async () => {
  const f = fixture({ throw: true, failed: true }),
    r = await f.run();
  assert.equal(r.state, "retrying");
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  assert.equal(f.calls[0].a.p_definition.error_code, "processing_handler_failed");
});
test("partial failure is not counted as a successful job", async () => {
  const f = fixture({ failed: true });
  assert.equal((await f.run()).state, "retrying");
  assert.equal(f.calls[0].a.p_definition.success, false);
});

const reviewContinuationResult = () => ({ success: false, recordsProcessed: 0,
  result: { resolved: 0, failed: 0, review_required: 20, reviews_recorded: 20, continued: true },
  error: { code: "identity_review_required", message: "Review remains required", retryable: false },
  continuation: { jobType: "identity.resolve", jobKey: `identity.resolve:${id(1)}`,
    connectorId: "openfolk-core", moduleId: "core.identity", payload: { limit: 20 } } });
test("review continuation settles atomically as dead-letter with one child, including lost reply", async () => {
  for (const lost of [false, true]) {
    const f = fixture({ result: reviewContinuationResult(), continue: true, lost,
      patch: { state: "dead_letter" } });
    const r = await f.run();
    assert.equal(r.state, "dead_letter");
    assert.equal(r.continuationJobId, id(4));
    assert.equal(r.result.success, false);
    assert.equal(r.historicalReceipt, lost);
    assert.equal(f.calls[0].a.p_definition.success, false);
    assert.equal(f.calls[0].a.p_definition.continue, true);
    assert.equal(f.calls[0].a.p_definition.retryable, false);
    if (lost) assert.equal(f.calls[0].a.p_request, f.calls[1].a.p_request);
  }
});
test("only the explicit non-retryable identity review can continue a non-successful batch", async () => {
  for (const change of [
    (r: any) => { r.error.code = "identity_delivery_unconfirmed"; },
    (r: any) => { r.error.retryable = true; },
    (r: any) => { r.result.failed = 1; },
    (r: any) => { r.result.review_required = 0; },
    (r: any) => { delete r.result.reviews_recorded; },
    (r: any) => { r.result.continued = false; },
    (r: any) => { r.continuation.jobKey = `identity.resolve:${id(9)}`; },
  ]) {
    const result = reviewContinuationResult(); change(result);
    const f = fixture({ result });
    assert.equal((await f.run()).state, "unconfirmed");
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({ result: reviewContinuationResult() });
  f.ctx.jobType = "interactions.sync";
  assert.equal((await f.run()).state, "unconfirmed");
  assert.equal(f.calls.length, 0);
});
