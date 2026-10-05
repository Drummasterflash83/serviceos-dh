import test from "node:test";
import assert from "node:assert/strict";
import { captureTestHarness, compareTestHarness, inspectTestPersonality } from "./receptionist-test-harness.ts";
import { readFileSync } from "node:fs";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const data: Record<string, any> = {
    [`eval/simulation/suite/${uuid(1)}`]: { id: uuid(1), name: "Suite", simulationIds: [uuid(2)] },
    [`eval/simulation/${uuid(2)}`]: { id: uuid(2), name: "Simulation", scenarioId: uuid(3), personalityId: uuid(4) },
    [`eval/simulation/scenario/${uuid(3)}`]: { id: uuid(3), name: "Scenario", instructions: "PRIVATE SCENARIO", targetOverrides: { firstMessage: "Clock" } },
    [`eval/simulation/personality/${uuid(4)}`]: { id: uuid(4), name: "Sceptical tester", assistant: { model: { messages: [{ role: "system", content: "PRIVATE PERSONALITY" }], temperature: .4 }, server: { token: "SECRET" } } },
  };
  return { data, api: async (path: string) => structuredClone(data[path]) };
}
test("fingerprints include the full setup but save only ids, names and hashes", async () => {
  const { api, data } = fixture();
  const saved = await captureTestHarness(api, uuid(1));
  assert.equal(saved.version, 1);
  assert.match(saved.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE|SECRET|messages|targetOverrides/);
  assert.equal((await captureTestHarness(api, uuid(1))).fingerprint, saved.fingerprint);
  for (const path of Object.keys(data)) {
    const before = structuredClone(data[path]);
    data[path].updatedAt = "changed";
    assert.notEqual((await captureTestHarness(api, uuid(1))).fingerprint, saved.fingerprint, path);
    data[path] = before;
  }
});
test("wrong, missing or duplicate provider identities prevent a capture", async () => {
  const { api, data } = fixture();
  await assert.rejects(captureTestHarness(api, "unapproved"));
  data[`eval/simulation/suite/${uuid(1)}`].simulationIds = [uuid(2), uuid(2)];
  await assert.rejects(captureTestHarness(api, uuid(1)));
  data[`eval/simulation/suite/${uuid(1)}`].simulationIds = [uuid(2)];
  data[`eval/simulation/personality/${uuid(4)}`].id = uuid(5);
  await assert.rejects(captureTestHarness(api, uuid(1)));
});
test("missing historical evidence stays missing and detected drift cannot turn green again", async () => {
  const { api } = fixture();
  const saved = await captureTestHarness(api, uuid(1));
  assert.equal(compareTestHarness(null, saved).state, "not_captured");
  assert.equal(compareTestHarness(saved, null).state, "unavailable");
  assert.equal(compareTestHarness(saved, saved).state, "unchanged");
  assert.equal(compareTestHarness(saved, { ...saved, fingerprint: "0".repeat(64) }).state, "changed");
  assert.equal(compareTestHarness(saved, saved, { state: "changed" }).state, "changed");
});
test("persona inspection uses nested assistant settings and excludes credentials and tools", () => {
  const result = inspectTestPersonality({ id: uuid(4), name: "Tester", model: { provider: "wrong-level" }, assistant: {
    model: { provider: "openai", model: "approved", messages: [{ role: "system", content: "Be sceptical" }], tools: [{ token: "SECRET" }] },
    voice: { provider: "11labs", voiceId: "reviewed", credentialId: "SECRET" }, server: { token: "SECRET" },
    startSpeakingPlan: { waitSeconds: .5, secret: "SECRET" },
  } });
  assert.equal(result.model.provider, "openai");
  assert.equal(result.model.messages[0].content, "Be sceptical");
  assert.equal(result.timing.startSpeakingPlan?.waitSeconds, .5);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|wrong-level/);
});
test("endpoint saves fingerprint before provider submission and checks saved suite without backfill", () => {
  const source = readFileSync(new URL("../receptionist-testing/index.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("report: { harness, checks }") < source.indexOf('const run = await api("eval/simulation/run", "POST"'));
  assert.match(source, /captureTestHarness\(api, row.data.suite_id\)/);
  assert.match(source, /harness: row.data.report\?\.harness \?\? null/);
  assert.match(source, /compareTestHarness\(row.data.report\?\.harness, currentHarness, row.data.report\?\.harnessCheck\)/);
});
