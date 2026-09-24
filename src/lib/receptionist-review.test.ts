import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCall } from "./receptionist-data.ts";
import {
  reviewCall,
  rankCalls,
  callOutcome,
  sameNumberHistory,
  experienceCards,
  callBrief,
} from "./receptionist-review.ts";

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
test("legacy structured flags feed scorecards without treating unknown as false", () => {
  const calls = [
    normalizeCall({
      id: "a",
      analysis: { structuredData: { callerConfused: true, humanRequested: false } },
    }),
    normalizeCall({ id: "b" }),
  ];
  const cards = experienceCards(calls);
  assert.deepEqual(cards.find((c) => c.id === "confusion")?.flagged, 1);
  assert.deepEqual(cards.find((c) => c.id === "confusion")?.unknown, 1);
  assert.equal(cards.find((c) => c.id === "human")?.assessed, 1);
  assert.equal(cards.find((c) => c.id === "repetition")?.assessed, 0);
});
test("partial negative follow-up fields do not prove all follow-up checks assessed", () => {
  const c = normalizeCall({ analysis: { structuredData: { requiresFollowUp: false } } });
  assert.equal(experienceCards([c]).find((c) => c.id === "followup")?.assessed, 0);
});
test("human requests require explicit structured evidence, not transfer or prose", () => {
  const c = normalizeCall({
    endedReason: "assistant-forwarded-call",
    analysis: { summary: "Asked for Mary" },
  });
  assert.equal(experienceCards([c]).find((c) => c.id === "human")?.assessed, 0);
});
test("ordinary requests for a person are not a negative review signal", () => {
  const c = normalizeCall({ analysis: { structuredData: { humanRequested: true } } });
  assert.equal(reviewCall(c).priority, 0);
  assert.equal(experienceCards([c]).find((c) => c.id === "human")?.flagged, 1);
  const difficult = normalizeCall({
    analysis: { structuredData: { humanRequestedAfterDifficulty: true } },
  });
  assert.equal(reviewCall(difficult).priority, 2);
});
test("caller excerpt is useful but never presented as a provider summary", () => {
  const c = normalizeCall({ transcript: "AI: Hello\nUser: I need a boiler service" });
  assert.equal(callBrief(c).text, "I need a boiler service");
  assert.match(callBrief(c).source, /not an AI summary/);
});
