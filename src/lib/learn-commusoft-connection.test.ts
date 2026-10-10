import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCommusoftSetup,
  validateCommusoftSetup,
  type CommusoftSetupRequest,
} from "./learn-commusoft-connection.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request: CommusoftSetupRequest = {
  tenantId: id(1),
  actorId: id(2),
  requestId: id(3),
  definition: {
    kind: "configure_commusoft",
    reason: "Reviewed same account",
    region: "uk",
    account_key: "synthetic-account",
    expected_revision: null,
    credential_mode: "replace",
    same_account_confirmed: true,
  },
};
const receipt = {
  tenant_id: id(1),
  request_id: id(3),
  state: "recorded",
  connection_id: id(4),
  revision: "2026-10-10T10:00:00Z",
  credential_bound: true,
  verification: "required",
};
test("saved configuration rejects credential-bearing metadata and unknown identity", () => {
  assert.doesNotThrow(() => validateCommusoftSetup(request));
  for (const r of [
    { ...request, apiKey: "SYNTHETIC_SECRET" },
    { ...request, definition: { ...request.definition, api_key: "SYNTHETIC_SECRET" } },
    { ...request, definition: { ...request.definition, same_account_confirmed: false } },
    { ...request, definition: { ...request.definition, expected_revision: "yesterday" } },
    { ...request, definition: { ...request.definition, region: "custom-url" } },
  ])
    assert.throws(() => validateCommusoftSetup(r));
});
test("credential is transient and output excludes extra fields and never claims verification", async () => {
  const snapshot = JSON.stringify(request);
  const result = await resolveCommusoftSetup(
    {
      rpc: async (name, args) => {
        assert.equal(name, "learn_commusoft_configure");
        assert.equal(args.p_api_key, "SYNTHETIC_SECRET");
        assert.deepEqual(args.p_definition, request.definition);
        assert.equal(args.p_actor, request.actorId);
        return { error: null, data: { ...receipt, unexpected: "SYNTHETIC_SECRET" } };
      },
    },
    request,
    "apply",
    "SYNTHETIC_SECRET",
  );
  assert.deepEqual(result, receipt);
  assert.equal(JSON.stringify(request), snapshot);
  assert.ok(!JSON.stringify(result).includes("SYNTHETIC_SECRET"));
  for (const change of [
    { tenant_id: id(9) },
    { request_id: id(9) },
    { verification: "verified" },
    { credential_bound: false },
    { revision: null },
  ])
    await assert.rejects(
      resolveCommusoftSetup(
        { rpc: async () => ({ error: null, data: { ...receipt, ...change } }) },
        request,
        "check",
      ),
    );
});
test("lost secret-bearing replies are sanitized and never retried; receipt checks need no credential", async () => {
  let calls = 0;
  await assert.rejects(
    resolveCommusoftSetup(
      {
        rpc: async () => {
          calls++;
          throw Error("SYNTHETIC_SECRET");
        },
      },
      request,
      "apply",
      "SYNTHETIC_SECRET",
    ),
    (e) => e instanceof Error && !e.message.includes("SYNTHETIC_SECRET"),
  );
  assert.equal(calls, 1);
  const checked = await resolveCommusoftSetup(
    {
      rpc: async (_name, args) => {
        assert.equal(args.p_api_key, null);
        return { error: null, data: receipt };
      },
    },
    request,
    "check",
  );
  assert.equal(checked.state, "recorded");
  await assert.rejects(
    resolveCommusoftSetup(
      {
        rpc: async () => {
          throw Error("must not send");
        },
      },
      request,
      "check",
      "SYNTHETIC_SECRET",
    ),
  );
});
test("reusing stored keys sends no secret and cancellation remains explicit", async () => {
  const reuse = {
    ...request,
    definition: { ...request.definition, credential_mode: "reuse" as const },
  };
  assert.equal(
    (
      await resolveCommusoftSetup(
        {
          rpc: async (_name, args) => {
            assert.equal(args.p_api_key, null);
            return { error: null, data: receipt };
          },
        },
        reuse,
        "apply",
      )
    ).state,
    "recorded",
  );
  assert.equal(
    (
      await resolveCommusoftSetup(
        {
          rpc: async () => ({
            error: null,
            data: { tenant_id: id(1), request_id: id(3), state: "cancelled" },
          }),
        },
        request,
        "cancel",
      )
    ).state,
    "cancelled",
  );
});
test("known setup conflicts give safe recovery directions; arbitrary error prose stays private", async () => {
  await assert.rejects(
    resolveCommusoftSetup(
      {
        rpc: async () => ({
          data: null,
          error: {
            code: "55000",
            message: "learn_connection_credential_missing",
            details: "SYNTHETIC_SECRET",
          },
        }),
      },
      request,
      "check",
    ),
    (e) =>
      e instanceof Error &&
      e.message.includes("No stored Commusoft credential") &&
      !e.message.includes("SYNTHETIC_SECRET"),
  );
  await assert.rejects(
    resolveCommusoftSetup(
      {
        rpc: async () => ({
          data: null,
          error: { code: "PT409", message: "learn_connection_revision_changed" },
        }),
      },
      request,
      "check",
    ),
    /Cancel this saved request/,
  );
  await assert.rejects(
    resolveCommusoftSetup(
      { rpc: async () => ({ data: null, error: { code: "55000", message: "SYNTHETIC_SECRET" } }) },
      request,
      "check",
    ),
    (e) =>
      e instanceof Error &&
      !e.message.includes("SYNTHETIC_SECRET") &&
      e.message.includes("not confirmed"),
  );
});
