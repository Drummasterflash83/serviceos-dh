import test from "node:test";
import assert from "node:assert/strict";
import {
  createContactFixturePlan,
  contactFixtureIdentities,
  assertUncreatedContactRetry,
} from "./learn-commusoft-contact-fixture-plan.mjs";
import { acceptCommusoftIngestion } from "./learn-test-commusoft-ingestion-acceptance.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
test("hosted contact acceptance preserves the exact reviewed recipient identities", () => {
  const p = createContactFixturePlan();
  const ids = contactFixtureIdentities(p);
  assert.equal(ids.email, p.email);
  assert.equal(ids.actor, p.actor);
  assert.equal(ids.tenant, p.tenant);
  assert.equal(p.scope.operatorGrantMinutes, 30);
  assert.equal(p.scope.providerNetworkRequests, 0);
  assert.equal(p.scope.productionChanges, false);
});
test("retry requires proven absence and retains exact approved identities", () => {
  const plan = createContactFixturePlan();
  const previous = {
    ...contactFixtureIdentities(plan),
    projectRef: TEST_PROJECT,
    includeContacts: true,
    created: false,
    secret: null,
    sourceBefore: null,
    stage: "setup",
    providerReads: 0,
    requests: [],
    failure: "Synthetic ingestion SQL failed (HTTP 400)",
  };
  const absence = { auth: 0, tenant: 0, profile: 0, grants: 0, connections: 0, bindings: 0 };
  assert.doesNotThrow(() => assertUncreatedContactRetry(plan, previous, absence));
  for (const key of Object.keys(absence))
    assert.throws(() => assertUncreatedContactRetry(plan, previous, { ...absence, [key]: 1 }));
  for (const change of [
    { created: true },
    { sourceBefore: [] },
    { secret: "issued" },
    { providerReads: 1 },
    { requests: [{}] },
    { stage: "running" },
    { priorAttempts: [] },
    { actor: createContactFixturePlan().actor },
  ])
    assert.throws(() => assertUncreatedContactRetry(plan, { ...previous, ...change }, absence));
  assert.throws(() => assertUncreatedContactRetry(plan, previous, {}));
});
test("missing or expanded scope and changed recipients are rejected before network access", async () => {
  const cases = [
    null,
    { ...createContactFixturePlan(), email: "real@example.com" },
    ...[
      "projectRef",
      "accounts",
      "operatorPermission",
      "operatorGrantMinutes",
      "productionChanges",
    ].map((k) => {
      const p = createContactFixturePlan();
      p.scope[k] = "changed";
      return p;
    }),
    (() => {
      const p = createContactFixturePlan();
      p.actor = p.tenant;
      return p;
    })(),
  ];
  for (const plan of cases) {
    let calls = 0;
    await assert.rejects(
      acceptCommusoftIngestion({
        allowProjectRef: TEST_PROJECT,
        token: "synthetic",
        includeContacts: true,
        contactFixturePlan: plan,
        fetcher: () => {
          calls++;
          throw Error("Unexpected request");
        },
      }),
      /reviewed TEST contact fixture/,
    );
    assert.equal(calls, 0);
  }
});
