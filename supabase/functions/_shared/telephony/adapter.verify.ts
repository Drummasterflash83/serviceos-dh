// Reference proof of the provider adapter contract (mock adapter, DB-free). Run:
//   node supabase/functions/_shared/telephony/adapter.verify.ts

import assert from "node:assert/strict";
import { getAdapter, availableProviders } from "./registry.ts";

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

await ok("testConnection returns structured checks", async () => {
  const r = await getAdapter("mock")!.testConnection(ctx);
  assert.equal(r.ok, true);
  assert.ok(r.checks.length >= 1 && r.checks.every((c) => typeof c.ok === "boolean"));
});

await ok("availableProviders hides mock by default, shows real providers", () => {
  const list = availableProviders();
  assert.ok(list.some((p) => p.provider === "sipcentric"));
  assert.ok(!list.some((p) => p.provider === "mock"));
});

console.log(`\n${passed} adapter-contract assertions passed ✓`);
