import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCall } from "./receptionist-data.ts";
import { emmaHealthCards, healthCardCalls, mainNumberStatus } from "./emma-health.ts";

test("main-number status follows reviewed activation stage without claiming live line health", () => {
  assert.equal(mainNumberStatus("Testing"), "Main number not activated");
  assert.equal(mainNumberStatus("Ready"), "Main number not activated");
  assert.equal(mainNumberStatus("Live"), "Main number marked active");
  assert.equal(mainNumberStatus("Paused"), "Main number paused");
  assert.equal(mainNumberStatus(), "Main number status to confirm");
});

const connected = { connected: true, loading: false, error: false, launchStage: "Ready" };
const assessed = (id: string, structuredData: Record<string, unknown>) =>
  normalizeCall({ id, createdAt: `2026-09-25T0${id.length}:00:00Z`, analysis: { structuredData } });

test("quiet connected data shows a positive readiness state, not a fake score", () => {
  const cards = emmaHealthCards([], connected);
  assert.deepEqual(
    cards.map((card) => card.id),
    ["service", "experience", "help", "handover"],
  );
  assert.equal(cards[0]!.headline, "Call view is ready");
  assert.equal(cards[0]!.tone, "waiting");
  assert.match(cards[0]!.explanation, /Main-number activation is a separate step/);
  assert.equal(cards[1]!.headline, "Learning from conversations");
});

test("observed calls without handling errors show Emma taking calls, not full phone verification", () => {
  const call = normalizeCall({ id: "a", endedReason: "customer-ended-call" });
  const service = emmaHealthCards([call], connected)[0]!;
  assert.equal(service.headline, "Emma is taking calls");
  assert.equal(service.tone, "good");
  assert.match(service.explanation, /does not.*verify the main number/);
});

test("a retrieval failure stays visible instead of being recast as awaiting data", () => {
  const cards = emmaHealthCards([assessed("old", { sentiment: "frustrated" })], {
    connected: false,
    loading: false,
    error: true,
  });
  const service = cards[0]!;
  assert.equal(service.tone, "watch");
  assert.equal(service.headline, "Call data needs a check");
  assert.equal(cards[1]!.tone, "waiting");
  assert.deepEqual(cards[1]!.flaggedIds, []);
});

test("missing assessments create no client-facing unknown-call task", () => {
  const call = normalizeCall({ id: "unknown", status: "ended" });
  const cards = emmaHealthCards([call], connected);
  assert.equal(cards[1]!.headline, "Learning from conversations");
  assert.equal(cards[2]!.headline, "Watching for follow-ups");
  assert.equal(cards[1]!.flaggedIds.length, 0);
  assert.equal(cards[2]!.flaggedIds.length, 0);
});

test("ordinary human request is not an experience or follow-up problem", () => {
  const call = assessed("normal", {
    humanRequested: true,
    callerConfused: false,
    repeatedQuestions: false,
    humanRequestedAfterDifficulty: false,
    unresolved: false,
    requiresFollowUp: false,
    callbackRequested: false,
    sentiment: "neutral",
  });
  const cards = emmaHealthCards(
    [call, { ...call, id: "normal-2" }, { ...call, id: "normal-3" }],
    connected,
  );
  assert.equal(cards[1]!.tone, "good");
  assert.equal(cards[2]!.tone, "good");
  assert.equal(cards[1]!.flaggedIds.length, 0);
  assert.equal(cards[2]!.flaggedIds.length, 0);
});

test("one assessed call among many does not become a green experience rating", () => {
  const neutral = assessed("neutral", { sentiment: "neutral" });
  const unknown = Array.from({ length: 9 }, (_, index) =>
    normalizeCall({ id: `unknown-${index}` }),
  );
  const experience = emmaHealthCards([neutral, ...unknown], connected)[1]!;
  assert.equal(experience.tone, "waiting");
  assert.equal(experience.headline, "Learning from conversations");
});

test("confusion, repetition and frustration focus only relevant conversations", () => {
  const affected = assessed("affected", {
    callerConfused: true,
    repeatedQuestions: true,
    humanRequestedAfterDifficulty: true,
    sentiment: "frustrated",
  });
  const routine = assessed("routine", { sentiment: "neutral" });
  const cards = emmaHealthCards([routine, affected], connected);
  assert.equal(cards[1]!.tone, "watch");
  assert.equal(cards[2]!.tone, "watch");
  assert.deepEqual(
    healthCardCalls(cards[1]!, [routine, affected]).map((call) => call.id),
    ["affected"],
  );
});

test("a transfer attempt is not a confirmed answer, while failure is actionable", () => {
  const transferred = normalizeCall({ id: "transferred", endedReason: "assistant-forwarded-call" });
  const failed = normalizeCall({ id: "failed", endedReason: "transfer-error" });
  const good = emmaHealthCards([transferred], connected)[3]!;
  assert.equal(good.headline, "Emma is routing calls");
  assert.match(good.explanation, /Whether the recipient answered/);
  const watch = emmaHealthCards([transferred, failed], connected)[3]!;
  assert.equal(watch.tone, "watch");
  assert.deepEqual(
    healthCardCalls(watch, [transferred, failed]).map((call) => call.id),
    ["failed"],
  );
});

test("recorded handling failure is a service concern and possible human follow-up", () => {
  const failed = normalizeCall({ id: "failed", endedReason: "silence-timed-out" });
  const cards = emmaHealthCards([failed], connected);
  assert.equal(cards[0]!.tone, "watch");
  assert.equal(cards[2]!.tone, "watch");
});
