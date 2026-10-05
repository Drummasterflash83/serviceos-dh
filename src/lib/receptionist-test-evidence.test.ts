import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testEvidence, testNextAction } from "./receptionist-test-evidence.ts";

const sample = {
  status: "failed",
  passed: false,
  recordingUrl: "https://storage.vapi.ai/example.wav",
  evaluations: [
    { name: "openfolk_route_mary", passed: true, extractedValue: true },
    { name: "openfolk_conversation_quality_mary", passed: false, extractedValue: false },
  ],
};
test("routing and wording remain separate; audio availability never proves clarity or handover", () => {
  const checks = testEvidence(sample);
  assert.equal(checks[0].state, "passed");
  assert.equal(checks[1].state, "failed");
  assert.equal(checks[2].state, "not_tested");
  assert.equal(checks[2].label, "Recording ready to review");
  assert.equal(checks[3].state, "not_tested");
  assert.match(testNextAction(sample), /without changing the approved route/);
});
test("provider rubric and aggregate pass cannot replace missing named verdicts", () => {
  const item = {
    status: "passed",
    passed: true,
    evaluations: [{ description: "routing passed", value: true, schema: { description: "Pass" } }],
  };
  assert.equal(testEvidence(item)[0].state, "not_tested");
  assert.equal(testEvidence(item)[1].state, "not_tested");
  assert.match(testNextAction(item), /missing or incomplete/);
});
test("independent failed checks override the corresponding provider pass only", () => {
  const item = {
    ...sample,
    evaluations: sample.evaluations.map((e) => ({ ...e, passed: true, extractedValue: true })),
  };
  assert.equal(testEvidence({ ...item, outcome: "repeated_transfer" })[0].state, "failed");
  assert.equal(testEvidence({ ...item, outcome: "repeated_transfer" })[1].state, "passed");
  assert.equal(testEvidence({ ...item, outcome: "repeated_announcement" })[0].state, "passed");
  assert.equal(testEvidence({ ...item, outcome: "repeated_announcement" })[1].state, "failed");
});
test("funding blocks and unfinished results are unverified, never conversation passes", () => {
  for (const item of [
    { ...sample, outcome: "blocked_funding" },
    { ...sample, status: "running" },
  ]) {
    assert.equal(testEvidence(item)[0].state, "not_tested");
    assert.equal(testEvidence(item)[1].state, "not_tested");
  }
  assert.match(testNextAction({ ...sample, outcome: "blocked_funding" }), /provider balance/);
});
test("new shorter provider names retain named quality verdicts alongside historical names", () => {
  const item = {
    ...sample,
    evaluations: [
      { name: "openfolk_quality_emergency_commercial", passed: true, extractedValue: true },
    ],
  };
  assert.equal(testEvidence(item)[1].state, "passed");
  assert.equal(testEvidence(sample)[1].state, "failed");
});
test("declining a handover is a valid routing verdict; conflicting evidence fails closed", () => {
  const item = { ...sample, evaluations: [{ name: "openfolk_closed_refusal", passed: true }] };
  assert.equal(testEvidence(item)[0].state, "passed");
  assert.equal(
    testEvidence({
      ...item,
      evaluations: [...item.evaluations, { name: "openfolk_closed_refusal", passed: false }],
    })[0].state,
    "failed",
  );
  assert.equal(
    testEvidence({
      ...item,
      evaluations: [{ name: "openfolk_closed_refusal", passed: true, extractedValue: false }],
    })[0].state,
    "failed",
  );
});
test("testing page keeps diagnostics optional and playback explicit", () => {
  const source = readFileSync(
    new URL("../components/app/ReceptionistTesting.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Read the transcript/);
  assert.match(
    source,
    /<details className="of-test-diagnostics">[\s\S]*Technical assessment details/,
  );
  assert.match(source, /AI-generated caller with a different voice/);
  assert.match(source, /preload="none"/);
  assert.doesNotMatch(source, /autoPlay|\.play\(/);
  assert.match(source, /Accepted by Slack/);
});
