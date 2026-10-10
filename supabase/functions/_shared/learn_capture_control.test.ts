import { test } from "node:test";
import assert from "node:assert/strict";
import { captureAdmission, deferCaptureJob } from "./learn_capture_control.ts";
import { enqueueJob } from "./platform_queue.ts";
const tenant = "00000000-0000-4000-8000-000000000001",
  now = Date.now();
const admission = () => ({
  version: "learn-capture-admission/1",
  tenant_id: tenant,
  source: "email",
  allowed: true,
  checked_at: new Date(now).toISOString(),
});
test("only fresh matching server admission permits a capture batch; failures are private", async () => {
  assert.deepEqual(
    await captureAdmission(
      { rpc: async () => ({ data: admission(), error: null }) },
      tenant,
      "email",
      () => now,
    ),
    { allowed: true },
  );
  for (const data of [
    null,
    { ...admission(), tenant_id: "foreign" },
    { ...admission(), source: "phone" },
    { ...admission(), allowed: "true" },
    { ...admission(), checked_at: new Date(now - 31000).toISOString() },
    { ...admission(), checked_at: new Date(now + 6000).toISOString() },
  ]) {
    const r = await captureAdmission(
      { rpc: async () => ({ data, error: null }) },
      tenant,
      "email",
      () => now,
    );
    assert.equal(r.allowed, false);
    assert.ok(!r.allowed && r.reason === "unavailable");
  }
  const r = await captureAdmission(
    {
      rpc: async () => {
        throw Error("PRIVATE_PROVIDER_DETAILS");
      },
    },
    tenant,
    "email",
    () => now,
  );
  assert.equal(r.allowed, false);
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
});
test("paused email enqueue leaves no work or phantom success, unrelated jobs still enqueue", async () => {
  let writes = 0,
    reads = 0;
  const db = {
    rpc: async () => {
      reads++;
      return { data: { ...admission(), allowed: false }, error: null };
    },
    from: () => ({
      insert: () => {
        writes++;
        return { select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) };
      },
    }),
  } as any;
  const paused = await enqueueJob(db, {
    tenantId: tenant,
    jobType: "email.gmail_sync",
    jobKey: "email",
  });
  assert.deepEqual(paused, { id: null, duplicate: false, captureWaiting: "paused" });
  assert.equal(writes, 0);
  const other = await enqueueJob(db, {
    tenantId: tenant,
    jobType: "identity.resolve",
    jobKey: "identity",
  });
  assert.equal(other.id, "new");
  assert.equal(reads, 1);
  assert.equal(writes, 1);
});
test("unconfirmed lease deferral cannot be reported as completed or retried by this helper", async () => {
  const job = { tenantId: tenant, jobId: "job", claimedBy: "worker", attempt: 2 };
  let calls = 0;
  await assert.rejects(
    deferCaptureJob(
      {
        rpc: async () => {
          calls++;
          return {
            data: { job_id: "foreign", state: "waiting", reason: "paused", attempt_count: 1 },
            error: null,
          };
        },
      },
      job,
      "paused",
    ),
    /unconfirmed/,
  );
  assert.equal(calls, 1);
});
