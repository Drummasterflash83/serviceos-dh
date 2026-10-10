import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEmailCapture } from "./email_capture_handler.ts";
const tenant = "00000000-0000-4000-8000-000000000001",
  job = "00000000-0000-4000-8000-000000000002",
  attempt = "00000000-0000-4000-8000-000000000003";
function setup(outcome: any) {
  const calls: any[] = [];
  const ctx: any = {
    tenantId: tenant,
    jobId: job,
    jobType: "email.workspace_sync",
    claim: { claimedBy: "synthetic-worker", attemptCount: 2 },
    payload: { email_account_id: "untrusted-payload-not-forwarded" },
    supabaseAdmin: {
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        return {
          data: {
            version: "learn-email-job-failure/1",
            disposition: "applied",
            job_id: job,
            attempt_id: attempt,
            code: "fetch_failed",
          },
          error: null,
        };
      },
    },
  };
  const deps: any = {
    ports: () => ({ synthetic: true }),
    run: async (_db: any, claim: any) => {
      calls.push({ engine: true, claim });
      if (outcome instanceof Error) throw outcome;
      return { jobId: job, attemptId: attempt, ...outcome };
    },
  };
  return { ctx, deps, calls };
}
test("email handlers require a queue claim and use its durable identity rather than a supplied payload", async () => {
  const f = setup({
    state: "completed",
    recordsProcessed: 2,
    coverageComplete: false,
    historicalReceipt: false,
  });
  assert.equal(
    (await handleEmailCapture({ ...f.ctx, claim: undefined }, f.deps)).error?.code,
    "email_claim_required",
  );
  assert.equal(f.calls.length, 0);
  const r = await handleEmailCapture(f.ctx, f.deps);
  assert.equal(r.queueOutcome?.state, "completed");
  assert.equal(r.recordsProcessed, 2);
  assert.equal(r.queueOutcome?.historicalReceipt, false);
  assert.deepEqual(f.calls[0].claim, {
    tenantId: tenant,
    jobId: job,
    claimedBy: "synthetic-worker",
    attemptCount: 2,
  });
  assert.equal(f.calls.length, 1);
});
test("a recovered success remains historical and a paused engine requests deferral", async () => {
  const old = setup({
    state: "completed",
    recordsProcessed: 0,
    coverageComplete: null,
    historicalReceipt: true,
  });
  assert.equal((await handleEmailCapture(old.ctx, old.deps)).queueOutcome?.historicalReceipt, true);
  const paused = setup({ state: "deferred", reason: "paused" }),
    r = await handleEmailCapture(paused.ctx, paused.deps);
  assert.equal(r.queueOutcome, undefined);
  assert.equal(r.error?.code, "learn_capture_paused");
  assert.equal(paused.calls.length, 1);
});
test("a protocol-failed attempt uses the lease-bound failure API before returning a settled result", async () => {
  const f = setup({ state: "failed", code: "fetch_failed" }),
    r = await handleEmailCapture(f.ctx, f.deps);
  assert.equal(r.queueOutcome?.state, "failed");
  assert.equal(r.success, false);
  assert.deepEqual(f.calls[1], {
    name: "learn_email_job_fail",
    args: {
      p_tenant: tenant,
      p_job: job,
      p_attempt: attempt,
      p_claimed_by: "synthetic-worker",
      p_claim: 2,
    },
  });
});
test("unknown engine or failure replies stay unconfirmed and omit private diagnostics", async () => {
  const f = setup(Error("PRIVATE_PROVIDER_TOKEN"));
  let r = await handleEmailCapture(f.ctx, f.deps);
  assert.equal(r.queueOutcome?.state, "unconfirmed");
  assert.equal(JSON.stringify(r).includes("PRIVATE"), false);
  const bad = setup({ state: "failed" });
  bad.ctx.supabaseAdmin.rpc = async () => ({ data: { job_id: "foreign" }, error: null });
  r = await handleEmailCapture(bad.ctx, bad.deps);
  assert.equal(r.queueOutcome?.state, "unconfirmed");
  const foreign = setup({ state: "completed", jobId: tenant });
  r = await handleEmailCapture(foreign.ctx, foreign.deps);
  assert.equal(r.queueOutcome?.state, "unconfirmed");
  assert.equal(foreign.calls.length, 1);
});
