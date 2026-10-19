import test from "node:test";
import assert from "node:assert/strict";
import {
  inputAccountStatus,
  readOperatorInputs,
  readOperatorInputWriteAccess,
  resolveOperatorInput,
  validateInputRequest,
  type InputAccount,
  type OperatorInputRequest,
} from "./learn-operator-inputs.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const enabled = { "learn.enabled": true, "learn.inputs.commusoft.enabled": true };
const request: OperatorInputRequest = {
  tenantId: id(1),
  actorId: id(2),
  requestId: id(3),
  definition: {
    kind: "set_modules",
    reason: "Enable reviewed input",
    expected: { "learn.enabled": null, "learn.inputs.commusoft.enabled": null },
    values: enabled,
  },
};
test("write access requires a verified admin result; unavailable access remains unknown", async () => {
  for (const [data, error, expected] of [
    [true, null, true],
    [false, null, false],
    ["true", null, null],
    [null, null, null],
    [true, { code: "denied" }, null],
  ] as const) {
    assert.equal(
      await readOperatorInputWriteAccess({
        rpc: async (name, args) => {
          assert.equal(name, "current_user_is_openfolk_operator");
          assert.deepEqual(args, { required_permission: "platform.controlplane.admin" });
          return { data, error };
        },
      }),
      expected,
    );
  }
  assert.equal(
    await readOperatorInputWriteAccess({
      rpc: async () => {
        throw Error("offline");
      },
    }),
    null,
  );
});
test("operator receipts bind actor/company/request and compare values independent of key order", async () => {
  let calls = 0;
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls++;
      assert.equal(name, "learn_operator_input_request");
      assert.equal(args.p_actor, id(2));
      assert.equal(args.p_tenant, id(1));
      assert.equal(args.p_mode, "apply");
      return {
        error: null,
        data: {
          tenant_id: id(1),
          request_id: id(3),
          state: "recorded",
          kind: "set_modules",
          flags: { "learn.inputs.commusoft.enabled": true, "learn.enabled": true },
        },
      };
    },
  };
  assert.equal((await resolveOperatorInput(db, request, "apply")).state, "recorded");
  assert.equal(calls, 1);
  for (const body of [
    { tenant_id: id(9), request_id: id(3), state: "cancelled" },
    { tenant_id: id(1), request_id: id(8), state: "recorded" },
    { tenant_id: id(1), request_id: id(3), state: "pending" },
    {
      tenant_id: id(1),
      request_id: id(3),
      state: "recorded",
      kind: "set_modules",
      flags: { ...enabled, "learn.enabled": false },
    },
  ]) {
    await assert.rejects(
      resolveOperatorInput({ rpc: async () => ({ data: body, error: null }) }, request, "apply"),
    );
  }
});
test("lost responses never cause automatic resubmission; pending checks and cancellation are explicit", async () => {
  let calls = 0;
  await assert.rejects(
    resolveOperatorInput(
      {
        rpc: async () => {
          calls++;
          throw Error("Private transport details must not appear in the operator notice");
        },
      },
      request,
      "apply",
    ),
    /^Error: The request was not confirmed\. Keep it saved and check its receipt before making another change\.$/,
  );
  assert.equal(calls, 1);
  for (const state of ["pending", "cancelled"]) {
    const r = await resolveOperatorInput(
      { rpc: async () => ({ error: null, data: { tenant_id: id(1), request_id: id(3), state } }) },
      request,
      "check",
    );
    assert.equal(r.state, state);
  }
});
test("import definitions require bounded collection scope but expired saved requests remain recoverable", () => {
  const r: OperatorInputRequest = {
    ...request,
    definition: {
      kind: "start_commusoft",
      reason: "Reviewed",
      connection_id: id(4),
      revision: "2026-01-01Z",
      resource: "properties",
      max_pages: 2,
      page_size: 50,
      expires_at: "2026-01-02Z",
    },
  };
  assert.doesNotThrow(() => validateInputRequest(r));
  for (const change of [
    { max_pages: 0 },
    { max_pages: 10001 },
    { page_size: 101 },
    { resource: "propertyContacts" },
    { contact_type: "customer" },
    { secret: "must-not-accept" },
  ])
    assert.throws(() => validateInputRequest({ ...r, definition: { ...r.definition, ...change } }));
  assert.doesNotThrow(() =>
    validateInputRequest({
      ...r,
      definition: { ...r.definition, resource: "propertyContacts", contact_type: "customer" },
    }),
  );
  assert.doesNotThrow(() =>
    validateInputRequest({
      ...r,
      definition: { ...r.definition, resource: "users", max_pages: 1, page_size: 10 },
    }),
  );
  for (const change of [{ max_pages: 2 }, { page_size: 11 }])
    assert.throws(() =>
      validateInputRequest({
        ...r,
        definition: { ...r.definition, resource: "users", max_pages: 1, page_size: 10, ...change },
      }),
    );
});
test("overview rejects foreign company, malformed flags and unbounded metadata", async () => {
  const base = {
    tenant_id: id(1),
    checked_at: "2026-10-10T10:00:00Z",
    flags: enabled,
    connections: [],
    accounts: [],
  };
  assert.deepEqual(
    await readOperatorInputs({ rpc: async () => ({ data: base, error: null }) }, id(1)),
    base,
  );
  for (const change of [
    { tenant_id: id(8) },
    { flags: { ...enabled, "learn.enabled": "true" } },
    { accounts: [{}] },
    { connections: [{}] },
    { checked_at: null },
  ])
    await assert.rejects(
      readOperatorInputs(
        { rpc: async () => ({ data: { ...base, ...change }, error: null }) },
        id(1),
      ),
    );
});

test("operator refresh definitions keep exact UTC bounds through saved-request recovery", () => {
  const r: OperatorInputRequest = {
    ...request,
    definition: {
      kind: "start_commusoft",
      reason: "Reviewed refresh",
      connection_id: id(4),
      revision: "2026-10-10T00:00:00Z",
      resource: "properties",
      max_pages: 20,
      page_size: 100,
      expires_at: "2026-10-11T00:00:00Z",
      updatedFrom: "2026-10-09T00:00:00.000Z",
      updatedBefore: "2026-10-10T00:00:00.000Z",
    },
  };
  assert.doesNotThrow(() => validateInputRequest(JSON.parse(JSON.stringify(r))));
  for (const change of [
    { updatedFrom: undefined },
    { updatedBefore: undefined },
    { updatedFrom: "2026-10-10T00:00:00.000Z" },
    { updatedFrom: "2026-02-30T00:00:00.000Z" },
    { updatedBefore: null },
    { updatedFrom: "2026-10-09T00:00:00Z" },
  ])
    assert.throws(() =>
      validateInputRequest({
        ...r,
        definition: { ...r.definition, ...change },
      } as OperatorInputRequest),
    );
});
test("operator status distinguishes retained pages, finished traversals, expiration and interrupted claims", () => {
  const a: InputAccount = {
    id: id(4),
    status: "active",
    connector_enabled: true,
    connection_id: id(5),
    resource: "properties",
    approval_id: id(3),
    expires_at: "2026-10-11Z",
    max_pages: 10,
    checkpoint: { approvalId: id(3), pages: 1, after: null, complete: true },
    latest_job: {
      id: id(6),
      status: "succeeded",
      error_code: null,
      attempt_count: 1,
      available_at: null,
      lease_expires_at: null,
      completed_at: "2026-10-10Z",
      stop_reason: "page_budget_exhausted",
    },
  };
  assert.match(inputAccountStatus(a, enabled), /more work or review/);
  assert.match(
    inputAccountStatus(
      { ...a, latest_job: { ...a.latest_job!, stop_reason: "collection_exhausted" } },
      enabled,
    ),
    /review coverage/,
  );
  assert.match(inputAccountStatus(a, { ...enabled, "learn.enabled": false }), /Paused/);
  assert.match(
    inputAccountStatus(
      {
        ...a,
        updated_window: {
          updatedFrom: "2026-10-09T00:00:00.000Z",
          updatedBefore: "2026-10-10T00:00:00.000Z",
        },
        latest_job: { ...a.latest_job!, stop_reason: "collection_exhausted" },
      },
      enabled,
    ),
    /Selected update period finished/,
  );
  assert.match(
    inputAccountStatus(
      { ...a, latest_job: { ...a.latest_job!, status: "running" } },
      enabled,
      Date.parse("2026-10-10Z"),
    ),
    /recovery needed/,
  );
  assert.match(
    inputAccountStatus(
      { ...a, latest_job: { ...a.latest_job!, status: "queued" } },
      enabled,
      Date.parse("2026-10-12Z"),
    ),
    /expired/,
  );
});
