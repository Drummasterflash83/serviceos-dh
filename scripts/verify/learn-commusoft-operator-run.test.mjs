import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOPE,
  preservationQuery,
  readSupervisorMetadata,
  assertDispatch,
  acceptWorkerReply,
  unclaimedInvocationSettled,
} from "./learn-commusoft-operator-run.mjs";
const now = Date.parse("2026-10-12T11:00:00Z");
const job = "00000000-0000-4000-8000-000000000001";
test("unclaimed recovery needs exact untouched DB state beyond the endpoint lease window", () => {
  const pending = { job, startedAt: new Date(now - 181000).toISOString() };
  const state = {
    id: job,
    status: "queued",
    attempt_count: 0,
    lease_expires_at: null,
    permits: 0,
    pages: 0,
  };
  assert.equal(unclaimedInvocationSettled(pending, state, now), true);
  for (const changed of [
    { ...state, id: SCOPE.tenant },
    { ...state, attempt_count: 1 },
    { ...state, status: "running" },
    { ...state, permits: 1 },
    { ...state, pages: 1 },
    { ...state, lease_expires_at: new Date(now).toISOString() },
  ])
    assert.equal(unclaimedInvocationSettled(pending, changed, now), false);
  assert.equal(
    unclaimedInvocationSettled(
      { ...pending, startedAt: new Date(now - 1000).toISOString() },
      state,
      now,
    ),
    false,
  );
});
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

test("auth reconciliation excludes only the reviewed operator timestamp", () => {
  const plan = { tables: ["auth.users", "auth.identities"], cutoff: new Date(now).toISOString() };
  assert(!preservationQuery(plan).includes("-'updated_at'"));
  assert(
    !preservationQuery({ ...plan, authSessionReconciliation: { actor: job } }).includes(
      "-'updated_at'",
    ),
  );
  const sql = preservationQuery({ ...plan, authSessionReconciliation: { actor: SCOPE.actor } });
  assert(
    sql.includes(
      `case when s.id='${SCOPE.actor}'::uuid then to_jsonb(s)-'updated_at' else to_jsonb(s) end`,
    ),
  );
  assert(sql.includes("from auth.identities s where true"));
  assert(!sql.includes("-'last_sign_in_at'"));
});

test("transient metadata retries stay read-only and bounded; denied/malformed reads stop", async () => {
  let attempts = 0;
  const waits = [];
  const query = async (token, sql, options) => {
    assert.equal(token, "test");
    assert.equal(sql, "select 1");
    assert.deepEqual(options, { readOnly: true });
    if (++attempts < 3) throw Error("TEST communication metadata/operation failed HTTP 503");
    return [{ n: 1 }];
  };
  assert.deepEqual(
    await readSupervisorMetadata("test", "select 1", { query, wait: async (ms) => waits.push(ms) }),
    [{ n: 1 }],
  );
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1000, 4000]);
  for (const status of [400, 401, 403, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(
      readSupervisorMetadata("test", "select 1", {
        query: async () => {
          calls++;
          throw Error(`TEST communication metadata/operation failed HTTP ${status}`);
        },
        wait: async () => {},
      }),
    );
    assert.equal(calls, status === 503 ? 3 : 1);
  }
});
