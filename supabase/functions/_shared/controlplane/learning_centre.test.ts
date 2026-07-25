// Run: node --test supabase/functions/_shared/controlplane/learning_centre.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLearningOverview, freshness, type LearningCentreInput } from "./learning_centre.ts";

const NOW = "2026-07-25T09:00:00Z";

function input(over: Partial<LearningCentreInput> = {}): LearningCentreInput {
  return {
    tenantId: "t1",
    now: NOW,
    telephony: {
      connection: { provider: "sipcentric", status: "manual", revoked_at: null },
      latestCallAt: "2026-07-24T16:17:00Z",
      received: 850,
      processed: 575,
      failedOrPending: 2,
      recordings: 575,
      transcripts: 575,
      aiInsights: 575,
      confirmedIdentities: 0,
      unresolvedIdentities: 8,
    },
    email: {
      mailboxesActive: 30,
      mailboxesPending: 10,
      latestMessageAt: "2026-07-25T07:08:00Z",
      received: 3812,
      processed: 3800,
      failedOrPending: 0,
      attachments: 0,
      aiInsights: 0,
      confirmedIdentities: 1,
      unresolvedIdentities: 39,
    },
    commusoft: { imports: 0, profilesSeeded: 3, canonicalRows: 0 },
    slack: { connected: false, endpoints: 0 },
    pipeline: {
      interactions: 4674,
      interactionsProcessed: 4600,
      interactionsPending: 74,
      intelligenceObjects: 3156,
      observations: 1800,
      actions: 1356,
      actionsWithDeadline: 1300,
      actionsOverdue: 210,
      recommendations: 4106,
      recommendationsAwaitingReview: 300,
      intelligenceWithoutOwner: 400,
      intelligenceLinkedToCustomer: 2200,
      intelligenceLowConfidence: 120,
      waitingDerivedCount: 0,
      handoffs: 0,
      commsNoIntelligence: 12,
      repeatedThemes: [{ subject: "Customer requested an engineer visit", count: 42 }],
    },
    health: { findings: 0 },
    ...over,
  };
}

test("tenant scoping is carried through (provider-neutral read model)", () => {
  const o = buildLearningOverview(input({ tenantId: "tenant-XYZ" }));
  assert.equal(o.tenantId, "tenant-XYZ");
});

test("live+fresh source vs stale vs disconnected", () => {
  assert.equal(freshness("2026-07-25T07:00:00Z", NOW), "fresh");
  assert.equal(freshness("2026-07-20T07:00:00Z", NOW), "recent");
  assert.equal(freshness("2026-06-01T07:00:00Z", NOW), "stale");
  assert.equal(freshness(null, NOW), "none");

  const o = buildLearningOverview(input());
  const email = o.sourceTruth.sources.find((s) => s.key === "email")!;
  assert.equal(email.connectionState, "live");
  assert.equal(email.freshness, "fresh");
  const slack = o.sourceTruth.sources.find((s) => s.key === "slack")!;
  assert.equal(slack.connectionState, "not_connected");
});

test("schedule state inferred active from fresh, dormant from stale", () => {
  const active = buildLearningOverview(input()).sourceTruth.sources.find((s) => s.key === "email")!;
  assert.equal(active.scheduleState, "active");
  const stale = buildLearningOverview(
    input({ email: { ...input().email, latestMessageAt: "2026-05-01T00:00:00Z" } }),
  ).sourceTruth.sources.find((s) => s.key === "email")!;
  assert.equal(stale.scheduleState, "dormant");
});

test("partial processing + failed records surface honestly", () => {
  const o = buildLearningOverview(input());
  const tel = o.sourceTruth.sources.find((s) => s.key === "telephony")!;
  assert.equal(tel.received, 850);
  assert.equal(tel.processed, 575);
  assert.equal(tel.failedOrPending, 2);
  assert.equal(o.sourceTruth.summary.processingHealth, "attention");
});

test("unresolved identities counted; low coverage flagged as a blind spot", () => {
  const o = buildLearningOverview(input());
  assert.equal(o.sourceTruth.summary.identityCoverage.confirmed, 1); // tel 0 + email 1 + slack 0
  assert.ok(o.sourceTruth.summary.majorBlindSpots.includes("identity mapping coverage very low"));
});

test("Commusoft is analysed-not-ingested — never presents canonical queues or fabricated data", () => {
  const o = buildLearningOverview(input());
  const c = o.sourceTruth.sources.find((s) => s.key === "commusoft")!;
  assert.equal(c.connectionState, "planned");
  assert.ok(c.gaps.some((g) => /not ingested/i.test(g)));
  assert.ok(o.sourceTruth.summary.majorBlindSpots.includes("Commusoft not ingested"));
  // no queue references Commusoft jobs/parts/quotes/invoices
  const queueText = JSON.stringify(o.existingIntelligence.queues).toLowerCase();
  assert.ok(!/parts|quote|invoice|job waiting/.test(queueText));
});

test("waiting relationships are NOT fabricated when waiting_on_ref is absent", () => {
  const o = buildLearningOverview(input());
  assert.equal(o.existingIntelligence.waiting.derived, false);
  assert.match(o.existingIntelligence.waiting.note, /not yet derived/i);
  // and when present, it reports derived
  const withWaiting = buildLearningOverview(
    input({ pipeline: { ...input().pipeline, waitingDerivedCount: 5 } }),
  );
  assert.equal(withWaiting.existingIntelligence.waiting.derived, true);
});

test("existing intelligence exposes real totals + traceable (drillable) queues", () => {
  const o = buildLearningOverview(input());
  assert.equal(o.existingIntelligence.totals.intelligenceObjects, 3156);
  assert.equal(o.existingIntelligence.totals.recommendations, 4106);
  const overdue = o.existingIntelligence.queues.find((q) => q.key === "overdue_actions")!;
  assert.equal(overdue.count, 210);
  assert.ok(overdue.drill.table && overdue.drill.filter); // every queue is traceable
  assert.ok(o.existingIntelligence.repeatedThemes.length > 0);
});

test("empty intelligence results render as zeros, not errors", () => {
  const empty = buildLearningOverview(
    input({
      pipeline: {
        interactions: 0,
        interactionsProcessed: 0,
        interactionsPending: 0,
        intelligenceObjects: 0,
        observations: 0,
        actions: 0,
        actionsWithDeadline: 0,
        actionsOverdue: 0,
        recommendations: 0,
        recommendationsAwaitingReview: 0,
        intelligenceWithoutOwner: 0,
        intelligenceLinkedToCustomer: 0,
        intelligenceLowConfidence: 0,
        waitingDerivedCount: 0,
        handoffs: 0,
        commsNoIntelligence: 0,
        repeatedThemes: [],
      },
    }),
  );
  assert.equal(empty.existingIntelligence.totals.intelligenceObjects, 0);
  assert.equal(
    empty.existingIntelligence.queues.every((q) => q.count === 0),
    true,
  );
});

test("Health absence is a named blind spot (no speculative Health scores)", () => {
  const o = buildLearningOverview(input());
  assert.ok(o.sourceTruth.summary.majorBlindSpots.includes("Health inactive"));
});
