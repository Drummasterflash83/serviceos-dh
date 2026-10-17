import test from "node:test";
import assert from "node:assert/strict";
import { operatorBusinessReviewClient } from "./openfolk-business-review.ts";
const tenant = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222";
const action = "learn_commusoft_review_connections",
  args = { p_tenant: tenant };
const scope = { tenant, actor, reason: "Review client inputs" };
function envelope(result: unknown) {
  return {
    version: "openfolk-business-review/1",
    tenant_id: tenant,
    actor_id: actor,
    action,
    audit_id: "33333333-3333-4333-8333-333333333333",
    observed_at: new Date().toISOString(),
    result,
  };
}
test("operator facade keeps the actor and selected tenant and requires an audited receipt", async () => {
  let request: unknown;
  const client = operatorBusinessReviewClient(
    {
      rpc: async (name, input) => {
        request = { name, input };
        return { data: envelope({ connections: [] }), error: null };
      },
    },
    scope,
    () => true,
  );
  assert.deepEqual(await client.rpc(action, args), { data: { connections: [] }, error: null });
  assert.deepEqual(request, {
    name: "openfolk_business_review",
    input: { p_tenant: tenant, p_action: action, p_reason: scope.reason, p_args: args },
  });
});
test("foreign tenant, actor, unsupported action and closed review never dispatch", async () => {
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return { data: null, error: null };
    },
  };
  const client = operatorBusinessReviewClient(db, scope, () => true);
  for (const [name, input] of [
    [action, { p_tenant: actor }],
    [action, { p_tenant: tenant, p_expected_actor: tenant }],
    ["vault_secrets", args],
  ] as const)
    assert.ok((await client.rpc(name, input)).error);
  assert.ok((await operatorBusinessReviewClient(db, scope, () => false).rpc(action, args)).error);
  assert.equal(calls, 0);
});
test("late, foreign and unaudited responses are withheld", async () => {
  for (const change of [
    (r: any) => (r.actor_id = tenant),
    (r: any) => (r.tenant_id = actor),
    (r: any) => (r.action = "different"),
    (r: any) => delete r.audit_id,
    (r: any) => (r.observed_at = "2020-01-01T00:00:00Z"),
  ]) {
    const data = envelope({ private: true });
    change(data);
    assert.ok(
      (
        await operatorBusinessReviewClient(
          { rpc: async () => ({ data, error: null }) },
          scope,
          () => true,
        ).rpc(action, args)
      ).error,
    );
  }
  let active = true;
  const client = operatorBusinessReviewClient(
    {
      rpc: async () => {
        active = false;
        return { data: envelope({ private: true }), error: null };
      },
    },
    scope,
    () => active,
  );
  assert.deepEqual((await client.rpc(action, args)).data, null);
});
test("null batch receipt is preserved and writes never retry automatically", async () => {
  let calls = 0;
  const client = operatorBusinessReviewClient(
    {
      rpc: async () => {
        calls++;
        return { data: envelope(null), error: null };
      },
    },
    scope,
    () => true,
  );
  assert.deepEqual(await client.rpc(action, args), { data: null, error: null });
  assert.equal(calls, 1);
});

test("account-holder confirmation stays inside the logged selected-client facade", async () => {
  const identityAction = "learn_commusoft_confirm_customer_identity";
  const identityArgs = {
    p_tenant: tenant,
    p_version: actor,
    p_kind: "person",
    p_target: null,
    p_reason: "Reviewed source",
    p_identity: {
      display_name: "Synthetic holder",
      contact_is_customer: false,
      evidence: "Synthetic account screen",
    },
  };
  const client = operatorBusinessReviewClient(
    {
      rpc: async (name, input) => {
        assert.equal(name, "openfolk_business_review");
        assert.deepEqual(input, {
          p_tenant: tenant,
          p_action: identityAction,
          p_reason: scope.reason,
          p_args: identityArgs,
        });
        return { data: { ...envelope({ already: false }), action: identityAction }, error: null };
      },
    },
    scope,
    () => true,
  );
  assert.deepEqual(await client.rpc(identityAction, identityArgs), {
    data: { already: false },
    error: null,
  });
});

test("operator job review creation stays inside the logged selected-client facade", async () => {
  const reviewAction = "learn_commusoft_create_job_review_action";
  const reviewArgs = {
    p_tenant: tenant,
    p_connection: "44444444-4444-4444-8444-444444444444",
    p_external_id: "123",
    p_version: "55555555-5555-4555-8555-555555555555",
    p_reason: "Review retained source hold",
  };
  const client = operatorBusinessReviewClient(
    {
      rpc: async (name, input) => {
        assert.equal(name, "openfolk_business_review");
        assert.deepEqual(input, {
          p_tenant: tenant,
          p_action: reviewAction,
          p_reason: scope.reason,
          p_args: reviewArgs,
        });
        return {
          data: {
            ...envelope({ id: actor, created: true, source_version_id: reviewArgs.p_version }),
            action: reviewAction,
          },
          error: null,
        };
      },
    },
    scope,
    () => true,
  );
  assert.deepEqual(await client.rpc(reviewAction, reviewArgs), {
    data: { id: actor, created: true, source_version_id: reviewArgs.p_version },
    error: null,
  });
});
