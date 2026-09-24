import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCall } from "./receptionist-data.ts";
import { reviewCall, rankCalls, callOutcome, sameNumberHistory } from "./receptionist-review.ts";

test("angry and upset assessments have attributed evidence", () => {
  for (const sentiment of ["angry", "upset", "Frustrated"]) {
    const call = normalizeCall({ id: "a", analysis: { structuredData: { sentiment } } });
    assert.equal(reviewCall(call).priority, 2);
    assert.equal(reviewCall(call).signals[0].source, "Provider AI sentiment");
  }
});
test("passing assessment never becomes customer satisfaction or resolution", () => {
  const c = normalizeCall({ id: "a", analysis: { successEvaluation: true } });
  assert.equal(reviewCall(c).signals.length, 0);
  assert.equal(callOutcome(c), "Provider assessment passed");
});
test("missing evidence is unassessed, not good", () => {
  const c = normalizeCall({ id: "a", status: "ended" });
  assert.equal(reviewCall(c).assessmentAvailable, false);
  assert.equal(callOutcome(c), "Call ended · outcome unassessed");
});
test("negative keywords in prose are not sufficient evidence", () => {
  const c = normalizeCall({ id: "a", analysis: { summary: "Caller is not angry or chasing." } });
  assert.equal(reviewCall(c).priority, 0);
});
test("structured boolean signals refuse false and string lookalikes", () => {
  for (const value of [false, "true", "false", null]) {
    const c = normalizeCall({
      id: "a",
      artifact: { structuredOutputs: { x: { name: "Review", result: { repeatChaser: value } } } },
    });
    assert.equal(reviewCall(c).priority, 0);
  }
  const c = normalizeCall({
    id: "a",
    artifact: {
      structuredOutputs: {
        x: { name: "Review", result: { repeatChaser: true, callerConfused: true } },
      },
    },
  });
  assert.equal(reviewCall(c).signals.length, 2);
});
test("repeated calls do not imply repeat chasing or customer identity", () => {
  const a = normalizeCall({ id: "a", customer: { number: "+44 7700 900123" } });
  const b = normalizeCall({ id: "b", customer: { number: "+447700900123" } });
  assert.equal(sameNumberHistory(a, [a, b]).length, 2);
  assert.equal(reviewCall(a).priority, 0);
  const unknown = normalizeCall({ id: "unknown" });
  assert.equal(sameNumberHistory(unknown, [unknown, normalizeCall({ id: "other" })]).length, 1);
});
test("handling failures precede sentiment; newest breaks ties; source is unchanged", () => {
  const a = normalizeCall({
    id: "a",
    createdAt: "2026-09-24",
    analysis: { structuredData: { sentiment: "upset" } },
  });
  const b = normalizeCall({ id: "b", createdAt: "2026-09-23", endedReason: "transfer-error" });
  const c = normalizeCall({
    id: "c",
    createdAt: "2026-09-25",
    analysis: { structuredData: { sentiment: "upset" } },
  });
  const calls = [a, b, c];
  assert.deepEqual(
    rankCalls(calls).map((c) => c.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    calls.map((c) => c.id),
    ["a", "b", "c"],
  );
});
test("transfer is not a claim that the enquiry was resolved", () => {
  assert.equal(
    callOutcome(normalizeCall({ id: "a", endedReason: "assistant-forwarded-call" })),
    "Transferred · result not confirmed",
  );
});
