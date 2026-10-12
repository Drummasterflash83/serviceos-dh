import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSlackSetup,
  validateSlackSetup,
  type SlackSetupRequest,
} from "./learn-slack-connection.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request: SlackSetupRequest = {
  tenantId: id(1),
  actorId: id(2),
  requestId: id(3),
  definition: {
    kind: "configure_slack",
    reason: "Reviewed same account",
    team_id: "TFIXTURE",
    authorized_user_id: "UFIXTURE",
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
  assert.doesNotThrow(() => validateSlackSetup(request));
  for (const r of [
    { ...request, userToken: "xoxp-synthetic-secret" },
    { ...request, definition: { ...request.definition, user_token: "xoxp-synthetic-secret" } },
    { ...request, definition: { ...request.definition, same_account_confirmed: false } },
    { ...request, definition: { ...request.definition, expected_revision: "yesterday" } },
    { ...request, definition: { ...request.definition, team_id: "custom-url" } },
  ])
    assert.throws(() => validateSlackSetup(r));
});
test("credential is transient and output excludes extra fields and never claims verification", async () => {
  const snapshot = JSON.stringify(request);
  const result = await resolveSlackSetup(
    {
      rpc: async (name, args) => {
        assert.equal(name, "learn_slack_configure");
        assert.equal(args.p_user_token, "xoxp-synthetic-secret");
        assert.deepEqual(args.p_definition, request.definition);
        assert.equal(args.p_actor, request.actorId);
        return { error: null, data: { ...receipt, unexpected: "xoxp-synthetic-secret" } };
      },
    },
    request,
    "apply",
    "xoxp-synthetic-secret",
  );
  assert.deepEqual(result, receipt);
  assert.equal(JSON.stringify(request), snapshot);
  assert.ok(!JSON.stringify(result).includes("xoxp-synthetic-secret"));
  for (const change of [
    { tenant_id: id(9) },
    { request_id: id(9) },
    { verification: "verified" },
    { credential_bound: false },
    { revision: null },
  ])
    await assert.rejects(
      resolveSlackSetup(
        { rpc: async () => ({ error: null, data: { ...receipt, ...change } }) },
        request,
        "check",
      ),
    );
});
test("lost secret-bearing replies are sanitized and never retried; receipt checks need no credential", async () => {
  let calls = 0;
  await assert.rejects(
    resolveSlackSetup(
      {
        rpc: async () => {
          calls++;
          throw Error("xoxp-synthetic-secret");
        },
      },
      request,
      "apply",
      "xoxp-synthetic-secret",
    ),
    (e) => e instanceof Error && !e.message.includes("xoxp-synthetic-secret"),
  );
  assert.equal(calls, 1);
  const checked = await resolveSlackSetup(
    {
      rpc: async (_name, args) => {
        assert.equal(args.p_user_token, null);
        return { error: null, data: receipt };
      },
    },
    request,
    "check",
  );
  assert.equal(checked.state, "recorded");
  await assert.rejects(
    resolveSlackSetup(
      {
        rpc: async () => {
          throw Error("must not send");
        },
      },
      request,
      "check",
      "xoxp-synthetic-secret",
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
      await resolveSlackSetup(
        {
          rpc: async (_name, args) => {
            assert.equal(args.p_user_token, null);
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
      await resolveSlackSetup(
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
    resolveSlackSetup(
      {
        rpc: async () => ({
          data: null,
          error: {
            code: "55000",
            message: "learn_connection_credential_missing",
            details: "xoxp-synthetic-secret",
          },
        }),
      },
      request,
      "check",
    ),
    (e) =>
      e instanceof Error &&
      e.message.includes("No stored Slack credential") &&
      !e.message.includes("xoxp-synthetic-secret"),
  );
  await assert.rejects(
    resolveSlackSetup(
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
    resolveSlackSetup(
      {
        rpc: async () => ({
          data: null,
          error: { code: "55000", message: "xoxp-synthetic-secret" },
        }),
      },
      request,
      "check",
    ),
    (e) =>
      e instanceof Error &&
      !e.message.includes("xoxp-synthetic-secret") &&
      e.message.includes("not confirmed"),
  );
});
