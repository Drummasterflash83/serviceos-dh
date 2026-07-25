// Run: node --test supabase/functions/_shared/controlplane/learning_centre.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLearningOverview,
  buildExistingIntelligence,
  freshness,
  gatherQueueRecords,
  QUEUE_DEFS,
  type LearningCentreInput,
} from "./learning_centre.ts";

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
      rawMessages: 3812,
      canonicalInteractions: 3824,
      threads: 900,
      processingFailures: 0,
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

// ── Drill-down (read-only record lists) ──────────────────────────────────────
// A minimal chainable Supabase mock: records every tenant_id filter (for isolation
// assertions) and returns canned rows per table. Every builder method is chainable and
// awaitable, mirroring the subset of postgrest-js used by gatherQueueRecords.
function mockDb(tables: Record<string, unknown[]>, seenTenants: string[]) {
  const make = (table: string) => {
    const b: Record<string, unknown> = { _table: table };
    const result = { data: tables[table] ?? [], error: null };
    b.select = () => b;
    b.eq = (col: string, val: string) => {
      if (col === "tenant_id") seenTenants.push(val);
      return b;
    };
    b.not = () => b;
    b.is = () => b;
    b.lt = () => b;
    b.in = () => b;
    b.order = () => b;
    b.limit = () => Promise.resolve(result);
    b.then = (resolve: (r: typeof result) => void) => resolve(result);
    return b;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => make(t) } as any;
}

const TENANT = "tenant-1";
const OVERDUE_ROW = {
  id: "io-1",
  object_type: "Action",
  subject: "Follow up on the boiler quote",
  status: "ready",
  deadline: "2026-07-20T09:00:00Z", // before NOW → overdue
  confidence: 0.95,
  created_at: "2026-07-19T09:00:00Z",
  accountable_ref: null, // no confirmed owner
  source_entities: ["ent-company", "ent-person"],
  source_interactions: ["int-1"],
  evidence: [], // empty → excerpt falls back to the interaction summary
};
const RESOLVERS = {
  graph_nodes: [
    { id: "ent-company", node_type: "company", label: "Acme Boilers Ltd" },
    { id: "ent-person", node_type: "person", label: "Jane" },
  ],
  interactions: [
    {
      id: "int-1",
      source_type: "email",
      interaction_type: "email_message",
      occurred_at: "2026-07-18T09:00:00Z",
      summary: "Customer asked about a replacement quote",
      body_preview: "Hi, could you…",
      source_table: "email_messages",
      source_external_id: "MSG-1",
      direction: "inbound",
    },
  ],
  team_members: [], // owner cannot be resolved → unresolved state
};

test("drill: overdue_actions returns real records with owner/customer/source/evidence + why", async () => {
  const seen: string[] = [];
  const db = mockDb({ intelligence_objects: [OVERDUE_ROW], ...RESOLVERS }, seen);
  const r = await gatherQueueRecords(db, TENANT, "overdue_actions", NOW);
  assert.equal(r.drillable, true);
  assert.equal(r.records.length, 1);
  const rec = r.records[0];
  assert.equal(rec.objectType, "Action");
  assert.equal(rec.isOverdue, true);
  assert.ok((rec.overdueMs ?? 0) > 0);
  assert.equal(rec.owner.state, "unresolved"); // accountable_ref null
  assert.equal(rec.customer, "Acme Boilers Ltd"); // resolved from graph company node
  assert.equal(rec.source?.type, "email");
  assert.equal(rec.evidenceExcerpt, "Customer asked about a replacement quote"); // interaction fallback
  assert.match(rec.whyQualified, /deadline/i);
  assert.equal(r.trace.table, "intelligence_objects"); // provenance retained
});

test("drill: every query is tenant-scoped (isolation — no cross-tenant read)", async () => {
  const seen: string[] = [];
  const db = mockDb({ intelligence_objects: [OVERDUE_ROW], ...RESOLVERS }, seen);
  await gatherQueueRecords(db, TENANT, "overdue_actions", NOW);
  assert.ok(seen.length >= 3); // objects + graph_nodes + interactions (owner lookup skipped: no refs)
  assert.ok(
    seen.every((t) => t === TENANT),
    `every query filtered tenant_id=${TENANT}, saw ${JSON.stringify(seen)}`,
  );
});

test("drill: recommendations queue shapes open recs (status=open, not 'pending')", async () => {
  const seen: string[] = [];
  const rec = {
    id: "rc-1",
    type: "respond_to_customer",
    title: "Reply to Bob about the invoice",
    detail: "Bob asked when the engineer is booked",
    severity: "medium",
    status: "open",
    confidence: 0.7,
    created_at: "2026-07-24T09:00:00Z",
    interaction_id: "int-2",
  };
  const db = mockDb({ recommendations: [rec] }, seen);
  const r = await gatherQueueRecords(db, TENANT, "recs_awaiting_review", NOW);
  assert.equal(r.trace.filter, "status = open");
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].subject, "Reply to Bob about the invoice");
  assert.equal(r.records[0].evidenceExcerpt, "Bob asked when the engineer is booked");
  assert.equal(r.records[0].source?.interactionId, "int-2");
});

test("drill: derived comms_no_intel is honest — no fabricated record list", async () => {
  const seen: string[] = [];
  const db = mockDb({}, seen);
  const r = await gatherQueueRecords(db, TENANT, "comms_no_intel", NOW);
  assert.equal(r.drillable, false);
  assert.equal(r.records.length, 0);
  assert.ok(r.note && /not available/i.test(r.note));
  assert.equal(r.trace.table, "interactions"); // provenance still shown
});

test("drill: unknown queue is rejected (no silent empty)", async () => {
  const db = mockDb({}, []);
  await assert.rejects(
    () => gatherQueueRecords(db, TENANT, "does_not_exist", NOW),
    /unknown queue/,
  );
});

test("queue counts and drill filters come from one shared definition", () => {
  const ei = buildExistingIntelligence(input());
  // Every rendered queue maps to a QUEUE_DEF (single source of truth)
  for (const q of ei.queues) {
    const def = QUEUE_DEFS.find((d) => d.key === q.key);
    assert.ok(def, `queue ${q.key} has a definition`);
    assert.equal(q.count, def!.count(input().pipeline));
    assert.equal(q.drill.filter, def!.filterLabel);
  }
  // comms_no_intel is flagged non-drillable with an honest note
  const comms = ei.queues.find((q) => q.key === "comms_no_intel")!;
  assert.ok(comms.note && /not available/i.test(comms.note));
});
