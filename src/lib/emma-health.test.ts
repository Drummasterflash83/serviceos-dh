import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCall } from "./receptionist-data.ts";
import { emmaHealthDials, healthDialCalls } from "./emma-health.ts";

const assessed = (id: string, structuredData: Record<string, unknown>) =>
  normalizeCall({ id, createdAt: `2026-09-25T0${id.length}:00:00Z`, analysis: { structuredData } });

test("five dials keep missing assessments unknown rather than successful", () => {
  const calls = [
    normalizeCall({ id: "a" }),
    assessed("b", { callerConfused: false, repeatedQuestions: false }),
  ];
  const dials = emmaHealthDials(calls, true);
  assert.deepEqual(
    dials.map((dial) => dial.id),
    ["service", "help", "understanding", "experience", "evidence"],
  );
  const understanding = dials[2]!;
  assert.equal(understanding.affected, 0);
  assert.equal(understanding.assessed, 1);
  assert.equal(understanding.unknown, 1);
  assert.equal(understanding.coverage, 0.5);
  assert.equal(dials[1]!.value, "Not assessed");
  assert.equal(dials[3]!.value, "Not assessed");
});

test("normal request for a person is not a failure or unresolved follow-up", () => {
  const call = assessed("person", { humanRequested: true });
  const dials = emmaHealthDials([call], true);
  assert.equal(dials[1]!.affected, 0);
  assert.equal(dials[3]!.affected, 0);
});

test("difficulty, confusion, repetition and negative tone open exact call evidence", () => {
  const difficult = assessed("difficulty", {
    humanRequestedAfterDifficulty: true,
    callerConfused: true,
    repeatedQuestions: true,
    sentiment: "frustrated",
  });
  const routine = assessed("routine", {
    humanRequestedAfterDifficulty: false,
    callerConfused: false,
    repeatedQuestions: false,
    unresolved: false,
    requiresFollowUp: false,
    callbackRequested: false,
    sentiment: "neutral",
  });
  const dials = emmaHealthDials([routine, difficult], true);
  for (const index of [1, 2, 3]) {
    assert.equal(dials[index]!.affected, 1);
    assert.deepEqual(
      healthDialCalls(dials[index]!, [routine, difficult]).map((call) => call.id),
      ["difficulty"],
    );
  }
});

test("a failed call is reviewed, but a transfer is not counted as confirmed help", () => {
  const failed = normalizeCall({ id: "failed", endedReason: "transfer-error" });
  const transferred = normalizeCall({ id: "transferred", endedReason: "assistant-forwarded-call" });
  const dials = emmaHealthDials([failed, transferred], true);
  assert.equal(dials[0]!.affected, 1);
  assert.equal(dials[1]!.affected, 1);
  assert.equal(dials[1]!.unknown, 1);
  assert.deepEqual(
    healthDialCalls(dials[1]!, [transferred, failed]).map((call) => call.id),
    ["failed", "transferred"],
  );
});

test("reviewability requires a transcript or provider summary, not duration", () => {
  const short = normalizeCall({
    id: "short",
    startedAt: "2026-09-25T10:00:00Z",
    endedAt: "2026-09-25T10:00:12Z",
  });
  const summary = normalizeCall({ id: "summary", analysis: { summary: "Asked about a booking" } });
  const dial = emmaHealthDials([short, summary], true)[4]!;
  assert.equal(dial.value, "1/2");
  assert.equal(dial.unknown, 1);
  assert.deepEqual(
    healthDialCalls(dial, [short, summary]).map((call) => call.id),
    ["short"],
  );
});

test("service data access is not a global live-phone score", () => {
  const call = normalizeCall({ id: "a" });
  const online = emmaHealthDials([call], true)[0]!;
  const offline = emmaHealthDials([call], false)[0]!;
  assert.equal(online.value, "Connected");
  assert.equal(offline.value, "Unavailable");
  assert.equal(online.coverage, null);
  assert.equal(offline.coverage, null);
  assert.match(online.explanation, /do not verify.*main phone line/);
});
