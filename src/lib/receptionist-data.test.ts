import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCall, scopedCalls, callerGroups, secureUrl } from "./receptionist-data.ts";
test("provider success does not fabricate caller happiness", () => {
  const c = normalizeCall({
    id: "one",
    analysis: { successEvaluation: "true" },
    endedReason: "assistant-forwarded-call",
  });
  assert.equal(c.success, "true");
  assert.equal(c.sentiment, null);
  assert.equal(c.duration, null);
});
test("structured outputs and legacy analysis remain readable", () => {
  const c = normalizeCall({
    id: "one",
    analysis: { summary: "Legacy summary", successEvaluation: false },
    artifact: {
      transcript: "Evidence",
      structuredOutputs: { a: { name: "Experience", result: { callerSentiment: "frustrated" } } },
    },
    startedAt: "2026-09-22T10:00:00Z",
    endedAt: "2026-09-22T10:02:10Z",
  });
  assert.equal(c.summary, "Legacy summary");
  assert.equal(c.sentiment, "frustrated");
  assert.equal(c.needsReview, true);
  assert.equal(c.duration, 130);
  assert.equal(c.transcript, "Evidence");
});
test("call endpoint fails closed on mixed or missing assistant scope", () => {
  assert.throws(() =>
    scopedCalls(
      [
        { id: "one", assistantId: "a" },
        { id: "two", assistantId: "b" },
      ],
      "a",
    ),
  );
  assert.throws(() => scopedCalls([{ id: "one" }], "a"));
  assert.equal(scopedCalls([{ id: "one", assistantId: "a" }], "a").length, 1);
});
test("unknown callers remain separate; identical numbers share history", () => {
  const calls = [
    normalizeCall({ id: "a" }),
    normalizeCall({ id: "b" }),
    normalizeCall({ id: "c", customer: { number: "+44 7700 900123" } }),
    normalizeCall({ id: "d", customer: { number: "+447700900123" } }),
  ];
  assert.deepEqual(
    callerGroups(calls).map((g) => g.calls.length),
    [1, 1, 2],
  );
});
test("recording links reject script, insecure and credential-bearing URLs", () => {
  for (const u of [
    "javascript:alert(1)",
    "http://example.com/a",
    "https://user:secret@example.com/a",
  ])
    assert.equal(secureUrl(u), null);
  assert.equal(secureUrl("https://example.com/a"), "https://example.com/a");
});
