import test from "node:test";
import assert from "node:assert/strict";
import {
  createContactFixturePlan,
  contactFixtureIdentities,
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
