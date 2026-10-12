import test from "node:test";
import assert from "node:assert/strict";
import { SCOPE, assertDispatch, acceptWorkerReply } from "./learn-commusoft-operator-run.mjs";
const now = Date.parse("2026-10-12T11:00:00Z");
const job = "00000000-0000-4000-8000-000000000001";
function fixture() {
  return [
    { scope: SCOPE, state: "prepared", invocations: 1, initialJob: job },
    {
      requests: 0,
      jobs: [
        {
          id: job,
          tenant: SCOPE.tenant,
          account: SCOPE.account,
          status: "queued",
          lease: null,
          availableAt: new Date(now - 1000).toISOString(),
        },
      ],
      flags: [{ value: true }, { value: true }],
      operatorApproval: true,
      account: {
        id: SCOPE.account,
        connectionId: SCOPE.connection,
        resource: "propertyContacts",
        expiresAt: new Date(now + 3600000).toISOString(),
      },
    },
  ];
}
test("only the exact paused expired initial job can settle without a new approval", () => {
  const [p, s] = fixture();
  p.invocations = 0;
  s.flags.forEach((f) => (f.value = false));
  s.operatorApproval = false;
  s.account.expiresAt = new Date(now - 1).toISOString();
  assert.equal(assertDispatch(p, s, now).id, job);
  p.invocations = 1;
  assert.throws(() => assertDispatch(p, s, now), /paused/);
});
test("active contacts require fresh operator approval and existing scope", () => {
  const [p, s] = fixture();
  assert.equal(assertDispatch(p, s, now).id, job);
  for (const change of [
    (v) => (v.operatorApproval = false),
    (v) => (v.account.resource = "jobs"),
    (v) => (v.account.expiresAt = new Date(now).toISOString()),
    (v) => (v.jobs[0].tenant = job),
    (v) => v.jobs.push({ ...v.jobs[0] }),
  ]) {
    const v = structuredClone(s);
    change(v);
    assert.throws(() => assertDispatch(p, v, now));
  }
});
test("uncertain attempts, running leases, unavailable jobs and exhausted budgets do not redispatch", () => {
  const [p, s] = fixture();
  for (const change of [
    (v) => (v.pending = { job }),
    (v) => (v.invocations = 4200),
    (v) => (v.invocations = -1),
  ]) {
    const v = structuredClone(p);
    change(v);
    assert.throws(() => assertDispatch(v, s, now));
  }
  for (const change of [
    (v) => (v.requests = 4000),
    (v) => (v.jobs[0].status = "running"),
    (v) => (v.jobs[0].lease = new Date(now + 60000).toISOString()),
    (v) => (v.jobs[0].availableAt = new Date(now + 1000).toISOString()),
  ]) {
    const v = structuredClone(s);
    change(v);
    assert.throws(() => assertDispatch(p, v, now));
  }
});
test("worker acknowledgement must identify exactly the dispatched job", () => {
  assert.equal(
    acceptWorkerReply(
      {
        ok: true,
        result: {
          claimed: 1,
          outcomes: [{ job_id: job, status: "succeeded", successor_id: null }],
        },
      },
      job,
    ).claimed,
    1,
  );
  for (const reply of [
    { ok: true, result: { claimed: 2, outcomes: [] } },
    {
      ok: true,
      result: {
        claimed: 1,
        outcomes: [{ job_id: SCOPE.tenant, status: "succeeded", successor_id: null }],
      },
    },
    {
      ok: true,
      result: { claimed: 1, outcomes: [{ job_id: job, status: "running", successor_id: null }] },
    },
  ])
    assert.throws(() => acceptWorkerReply(reply, job));
});
