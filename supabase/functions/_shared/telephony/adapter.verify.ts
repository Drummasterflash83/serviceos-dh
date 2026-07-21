// Reference proof of the provider adapter contract (mock adapter, DB-free). Run:
//   node supabase/functions/_shared/telephony/adapter.verify.ts

import assert from "node:assert/strict";
import { getAdapter, availableProviders, getConnectionSpec } from "./registry.ts";
import { validateConnectionInput, partitionValues, secretFieldNames } from "./connection_spec.ts";

let passed = 0;
const ok = (name: string, fn: () => Promise<void> | void) =>
  Promise.resolve(fn()).then(() => {
    passed++;
    console.log(`PASS  ${name}`);
  });

// mock adapter has no DB dependency; a stub context is fine.
const ctx = { db: null as never, tenantId: "t-mock" };

await ok("registry resolves adapters; unknown → null", () => {
  assert.ok(getAdapter("sipcentric"));
  assert.ok(getAdapter("mock"));
  assert.equal(getAdapter("nope"), null);
});

await ok("supported operation returns objects", async () => {
  const r = await getAdapter("mock")!.discover("endpoint", ctx);
  assert.equal(r.supported, true);
  if (r.supported) {
    assert.ok(r.ok);
    assert.equal(r.objects.length, 2);
    assert.equal(r.objects[0].canonicalType, "endpoint");
  }
});

await ok("unsupported operation returns structured result (never throws)", async () => {
  const r = await getAdapter("mock")!.discover("queue", ctx);
  assert.equal(r.supported, false);
  if (!r.supported) assert.match(r.reason, /queue/);
});

await ok("capabilities differ per provider", () => {
  const sip = getAdapter("sipcentric")!.getCapabilityStatus();
  const mock = getAdapter("mock")!.getCapabilityStatus();
  assert.equal(sip.capabilities.extension_discovery, "manual");
  assert.equal(mock.capabilities.extension_discovery, "supported"); // genuinely different
  assert.equal(sip.capabilities.pickup_metadata, "unavailable");
});

await ok("testConnection is honest: not-configured fails, configured passes", async () => {
  // Unconfigured (stub ctx has no connection) → structured checks, overall not ok.
  const unconfigured = await getAdapter("mock")!.testConnection(ctx);
  assert.equal(unconfigured.ok, false);
  assert.ok(
    unconfigured.checks.length >= 1 && unconfigured.checks.every((c) => typeof c.ok === "boolean"),
  );
  assert.ok(unconfigured.checks.some((c) => c.name === "credentials_present" && c.ok === false));

  // Configured: connection snapshot + a resolver that returns a secret → overall ok.
  const configuredCtx = {
    db: null as never,
    tenantId: "t-mock",
    connection: {
      status: "configured",
      accountRef: "…acct",
      authMode: "api_key",
      config: { account_id: "acct_1" },
      configuredFields: ["api_key"],
    },
    resolveSecret: (field: string) => Promise.resolve(field === "api_key" ? "RESOLVED-KEY" : null),
  };
  const configured = await getAdapter("mock")!.testConnection(configuredCtx);
  assert.equal(configured.ok, true);
  assert.ok(configured.checks.some((c) => c.name === "authentication_accepted" && c.ok === true));
});

await ok("availableProviders hides dev adapters by default, shows real providers", () => {
  const list = availableProviders();
  assert.ok(list.some((p) => p.provider === "sipcentric"));
  assert.ok(!list.some((p) => p.provider === "mock"));
  assert.ok(!list.some((p) => p.provider === "oauth_demo"));
  const dev = availableProviders(true);
  assert.ok(dev.some((p) => p.provider === "mock" && p.devOnly === true));
});

await ok("every adapter declares a connection spec; sipcentric is provider-assisted", () => {
  for (const p of availableProviders(true)) {
    const spec = getConnectionSpec(p.provider)!;
    assert.ok(spec, `${p.provider} has a spec`);
    assert.equal(spec.provider, p.provider);
    assert.ok(Array.isArray(spec.fields));
  }
  const sip = getConnectionSpec("sipcentric")!;
  assert.equal(sip.manual, true); // provider-assisted, honest
  assert.equal(sip.oauth?.supported, false);
});

await ok("connection schema genuinely differs per adapter (form is adapter-driven)", () => {
  const mock = getConnectionSpec("mock")!;
  const oauth = getConnectionSpec("oauth_demo")!;
  // mock requires a secret api_key; oauth_demo has NO user-entered secret and supports OAuth
  assert.ok(secretFieldNames(mock).includes("api_key"));
  assert.equal(secretFieldNames(oauth).length, 0);
  assert.equal(oauth.oauth?.supported, true);
  assert.equal(oauth.oauth?.pkce, true);
  // different field sets → different rendered forms
  const mockNames = mock.fields
    .map((f) => f.name)
    .sort()
    .join(",");
  const oauthNames = oauth.fields
    .map((f) => f.name)
    .sort()
    .join(",");
  assert.notEqual(mockNames, oauthNames);
});

await ok(
  "validateConnectionInput enforces required + pattern; keeps existing secret on edit",
  () => {
    const mock = getConnectionSpec("mock")!;
    // missing everything → errors for the required fields
    const e1 = validateConnectionInput(mock, {});
    assert.ok(e1.some((e) => e.field === "account_id"));
    assert.ok(e1.some((e) => e.field === "api_key"));
    // bad pattern
    const e2 = validateConnectionInput(mock, {
      account_id: "!!",
      api_key: "longenough",
      region: "eu",
    });
    assert.ok(e2.some((e) => e.field === "account_id"));
    // valid
    const e3 = validateConnectionInput(mock, {
      account_id: "acct_1",
      api_key: "longenough",
      region: "eu",
    });
    assert.equal(e3.length, 0);
    // editing: api_key omitted but already stored → OK
    const e4 = validateConnectionInput(mock, { account_id: "acct_1", region: "eu" }, ["api_key"]);
    assert.equal(e4.length, 0);
    // invalid region option rejected
    const e5 = validateConnectionInput(mock, {
      account_id: "acct_1",
      api_key: "longenough",
      region: "moon",
    });
    assert.ok(e5.some((e) => e.field === "region"));
  },
);

await ok("partitionValues routes secrets vs non-secret per the spec", () => {
  const mock = getConnectionSpec("mock")!;
  const { secrets, nonSecret } = partitionValues(mock, {
    account_id: "acct_1",
    api_key: "SECRET-XYZ",
    region: "eu",
    webhook_secret: "WH-1",
  });
  assert.deepEqual(Object.keys(secrets).sort(), ["api_key", "webhook_secret"]);
  assert.deepEqual(Object.keys(nonSecret).sort(), ["account_id", "region"]);
  assert.equal(secrets.api_key, "SECRET-XYZ");
});

console.log(`\n${passed} adapter-contract assertions passed ✓`);
