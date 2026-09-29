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
  assert.equal(cards[1]!.headline, "Awaiting experience assessments");
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
  assert.equal(cards[1]!.headline, "Awaiting experience assessments");
  assert.equal(cards[2]!.headline, "Awaiting follow-up assessments");
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
    repeatChaser: false,
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
  assert.equal(experience.headline, "Awaiting experience assessments");
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
  assert.equal(good.headline, "Handovers attempted · outcomes pending");
  assert.equal(good.tone, "waiting");
  assert.equal(
    good.metrics.find((m) => m.label === "Confirmed answer rate")?.value,
    "Awaiting outcome data",
  );
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

test("each area has its own measures; unknown signals are not zero", () => {
  const cards = emmaHealthCards([normalizeCall({ id: "unknown" })], connected);
  assert.deepEqual(
    cards[1]!.metrics.find((m) => m.label === "Repeated questions"),
    { label: "Repeated questions", value: "Awaiting data", callIds: [] },
  );
  assert.equal(
    cards[2]!.metrics.find((m) => m.label === "Callback requested")?.value,
    "Awaiting data",
  );
  assert.equal(cards[3]!.metrics.find((m) => m.label === "Transfer attempts")?.value, "0");
  assert.equal(new Set(cards.map((c) => c.metrics.map((m) => m.label).join(","))).size, 4);
});
test("a neutral tone alone cannot prove callers were understood", () => {
  const cards = emmaHealthCards(
    ["a", "b", "c"].map((id) => assessed(id, { sentiment: "neutral" })),
    connected,
  );
  assert.equal(cards[1]!.assessed, 0);
  assert.equal(cards[1]!.tone, "waiting");
});
test("metric drilldowns contain only the matching calls and repeat chasing needs help", () => {
  const calls = [
    assessed("confused", { callerConfused: true }),
    assessed("callback", { callbackRequested: true }),
    assessed("chaser", { repeatChaser: true }),
  ];
  const cards = emmaHealthCards(calls, connected);
  assert.deepEqual(cards[1]!.metrics.find((m) => m.label === "Caller confused")?.callIds, [
    "confused",
  ]);
  assert.deepEqual(cards[2]!.metrics.find((m) => m.label === "Callback requested")?.callIds, [
    "callback",
  ]);
  assert.deepEqual(cards[2]!.flaggedIds, ["callback", "chaser"]);
});
test("failed data refresh clears non-service metrics as well as flags", () => {
  const cards = emmaHealthCards([assessed("old", { repeatedQuestions: true })], {
    ...connected,
    connected: false,
    error: true,
  });
  for (const card of cards.slice(1)) assert.deepEqual(card.metrics, []);
});
