import test from "node:test";
import assert from "node:assert/strict";
import { handleEmergencyIntake } from "./receptionist-intake-webhook.ts";
import { emergencyIntakeIds } from "./receptionist-emergency-intake-gate.ts";
import { launchPromotionIds } from "./receptionist-launch-promotion.ts";

const token = "TEST_ONLY_" + "x".repeat(45);
const orgId = "10000000-0000-0000-0000-000000000001";
const callId = "20000000-0000-0000-0000-000000000001";
const now = new Date("2026-10-19T18:00:00Z");
const site = "12 Example Road, SO51 8AS";
const issue = "An uncontrolled water leak is flooding my kitchen.";
const messages = [
  ["user", "I am at my own home. " + issue],
  ["bot", "Please stay clear of the water and electrical hazards."],
  ["bot", "What is your name?"],
  ["user", "My name is Test Caller."],
  ["bot", "What number should the engineer call back?"],
  ["user", "My callback number is 01632 960001."],
  ["bot", "Your callback number is 01632 960001. Is that correct?"],
  ["user", "Yes, that's correct."],
  ["bot", "What is the site address or postcode?"],
  ["user", "The address is " + site + "."],
];
const message = {
  type: "handoff-destination-request",
  call: { id: callId, orgId, assistantId: emergencyIntakeIds.candidate },
  assistant: { id: emergencyIntakeIds.candidate },
  parameters: {
    destination: "dynamic", kind: "domestic", callerName: "Test Caller",
    callbackNumber: "01632 960001", siteAddressOrPostcode: site, incidentSummary: issue,
    evidence: {
      name: "My name is Test Caller.", callback: "My callback number is 01632 960001.",
      callbackReadBack: "Your callback number is 01632 960001. Is that correct?",
      callbackConfirmation: "Yes, that's correct.", site: "The address is " + site + ".",
      issue, classification: "I am at my own home.",
    },
  },
  artifact: { messages: messages.map(([role, text]) => ({ role, message: text })) },
};
function fixture() {
  const state: any = { reads: 0, records: [], installed: true, callId, startedAt: "2026-10-19T17:59:00Z" };
  const deps = {
    token, now: () => now,
    readCall: async (id: string) => { state.reads++; return { id: state.callId, orgId, assistantId: emergencyIntakeIds.candidate, startedAt: state.startedAt }; },
    readCandidate: async () => { state.reads++; return { id: emergencyIntakeIds.candidate, orgId }; },
    readLive: async () => { state.reads++; return { id: launchPromotionIds.live, orgId }; },
    installationVerified: async () => state.installed,
    record: async (values: any) => { state.records.push(values); return { data: values.p_response, error: null }; },
  };
  const request = (body: unknown = { message }, key = token) => new Request("https://example.invalid/intake", {
    method: "POST", headers: { "Content-Type": "application/json", "X-OpenFolk-Intake-Token": key },
    body: JSON.stringify(body),
  });
  return { state, deps, request };
}

test("authenticated current candidate call with complete address records only the fixed helper", async () => {
  const f = fixture();
  const response = await handleEmergencyIntake(f.request(), f.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    destination: { type: "assistant", assistantId: emergencyIntakeIds.helper, contextEngineeringPlan: { type: "all" } },
  });
  assert.equal(f.state.records.length, 1);
  assert.equal(f.state.records[0].p_reason, "accepted");
  assert.match(f.state.records[0].p_event_key, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(f.state.records).includes(site), false);
  assert.equal(JSON.stringify(f.state.records).includes(token), false);
});

test("authentication is checked before parsing or provider access", async () => {
  const f = fixture();
  const bad = new Request("https://example.invalid/intake", {
    method: "POST", headers: { "Content-Type": "application/json", "X-OpenFolk-Intake-Token": "wrong" },
    body: "{not json",
  });
  const response = await handleEmergencyIntake(bad, f.deps);
  assert.equal(response.status, 401);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.records.length, 0);
});

test("stale call, disabled installation and wrong provider call fail before decision", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.state.installed = false; },
    (f: ReturnType<typeof fixture>) => { f.state.startedAt = "2026-10-19T17:00:00Z"; },
    (f: ReturnType<typeof fixture>) => { f.state.callId = "30000000-0000-0000-0000-000000000001"; },
  ]) {
    const f = fixture(); change(f);
    const response = await handleEmergencyIntake(f.request(), f.deps);
    assert.equal(response.status, 503);
    assert.equal(f.state.records.length, 0);
  }
});

test("missing caller address is rejected and stored without caller data", async () => {
  const f = fixture();
  const altered = structuredClone(message);
  altered.parameters.siteAddressOrPostcode = "my home";
  altered.parameters.evidence.site = "The address is my home.";
  altered.artifact.messages[9].message = "The address is my home.";
  const response = await handleEmergencyIntake(f.request({ message: altered }), f.deps);
  assert.equal(response.status, 200);
  assert.equal(f.state.records[0].p_reason, "unusable_location");
  assert.equal("destination" in await response.json(), false);
  assert.equal(JSON.stringify(f.state.records).includes("Test Caller"), false);
});

test("database failure and forged saved destination fail closed", async () => {
  const f = fixture();
  f.deps.record = async () => ({ data: { destination: { type: "assistant", assistantId: launchPromotionIds.live } }, error: null });
  assert.equal((await handleEmergencyIntake(f.request(), f.deps)).status, 503);
});
