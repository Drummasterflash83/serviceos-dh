// Run: node --test supabase/functions/_shared/controlplane/learning_centre.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLearningOverview,
  buildExistingIntelligence,
  freshness,
  gatherQueueRecords,
  gatherLearningMetrics,
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

test("retained evidence freshness does not prove live capture", () => {
  assert.equal(freshness("2026-07-25T07:00:00Z", NOW), "fresh");
  assert.equal(freshness("2026-07-20T07:00:00Z", NOW), "recent");
  assert.equal(freshness("2026-06-01T07:00:00Z", NOW), "stale");
  assert.equal(freshness(null, NOW), "none");

  const o = buildLearningOverview(input());
  const email = o.sourceTruth.sources.find((s) => s.key === "email")!;
  assert.equal(email.connectionState, "foundation");
  assert.equal(email.freshness, "fresh");
  const slack = o.sourceTruth.sources.find((s) => s.key === "slack")!;
  assert.equal(slack.connectionState, "not_connected");
});

test("fresh or stale records never imply an active capture schedule", () => {
  const active = buildLearningOverview(input()).sourceTruth.sources.find((s) => s.key === "email")!;
  assert.equal(active.scheduleState, "not_verified");
  const stale = buildLearningOverview(
    input({ email: { ...input().email, latestMessageAt: "2026-05-01T00:00:00Z" } }),
  ).sourceTruth.sources.find((s) => s.key === "email")!;
  assert.equal(stale.scheduleState, "not_verified");
});

test("partial processing + failed records surface honestly", () => {
  const o = buildLearningOverview(input());
  const tel = o.sourceTruth.sources.find((s) => s.key === "telephony")!;
  assert.equal(tel.received, null);
  assert.equal(tel.processed, null);
  assert.equal(tel.failedOrPending, null);
  assert.deepEqual(
    tel.measures?.map((m) => m.value),
    ["850", "575"],
  );
  assert.equal(o.sourceTruth.summary.processingHealth, "attention");
});

test("unresolved identities counted; low coverage flagged as a blind spot", () => {
  const o = buildLearningOverview(input());
  assert.equal(o.sourceTruth.summary.identityCoverage.confirmed, 1); // tel 0 + email 1 + slack 0
  assert.ok(o.sourceTruth.summary.majorBlindSpots.includes("identity mapping coverage very low"));
});

test("Commusoft publication gaps do not invent ingestion or analysis", () => {
  const o = buildLearningOverview(input());
  const c = o.sourceTruth.sources.find((s) => s.key === "commusoft")!;
  assert.equal(c.connectionState, "planned");
  assert.ok(c.gaps.some((g) => /different stages/i.test(g)));
  assert.ok(o.sourceTruth.summary.majorBlindSpots.includes("Commusoft jobs not published"));
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

const METRIC_TENANT = "12345678-1234-4234-8234-123456789abc";
function metricDb(overrides: Record<string, any[]> = {}, fault?: (table: string, q: any) => any) {
  return {
    async rpc(name: string, args: any) {
      assert.equal(name, "learn_learning_retained_counts");
      assert.equal(args.p_tenant, METRIC_TENANT);
      return {
        error: null,
        data: {
          version: "learn-learning-counts/1",
          tenant_id: args.p_tenant,
          commusoft_versions: 0,
          slack_messages: 0,
        },
      };
    },
    from(table: string) {
      const q: any = { filters: [], head: false, limit: Infinity };
      const b: any = {
        select: (_cols: string, opts?: any) => {
          q.head = opts?.head ?? false;
          return b;
        },
        eq: (key: string, value: any) => {
          q.filters.push((r: any) => r[key] === value);
          if (key === "tenant_id") q.tenant = value;
          return b;
        },
        in: (key: string, values: any[]) => {
          q.filters.push((r: any) => values.includes(r[key]));
          return b;
        },
        is: (key: string, value: any) => {
          q.filters.push((r: any) => r[key] === value);
          return b;
        },
        not: (key: string, op: string, value: any) => {
          q.filters.push((r: any) =>
            op === "is"
              ? r[key] !== value
              : JSON.stringify(r[key]) !== (value === "{}" ? "[]" : JSON.stringify(value)),
          );
          return b;
        },
        lt: (key: string, value: any) => {
          q.filters.push((r: any) => r[key] < value);
          return b;
        },
        gt: (key: string, value: any) => {
          q.filters.push((r: any) => r[key] > value);
          return b;
        },
        lte: () => b,
        or: (condition: string) => {
          if (condition === "source_system.eq.commusoft,source_system.like.commusoft:connection:%")
            q.filters.push(
              (r: any) =>
                r.source_system === "commusoft" ||
                String(r.source_system).startsWith("commusoft:connection:"),
            );
          return b;
        },
        order: () => b,
        limit: (n: number) => {
          q.limit = n;
          return b;
        },
        then(resolve: any, reject: any) {
          return Promise.resolve()
            .then(() => {
              assert.equal(q.tenant, METRIC_TENANT, "Every metric request must be tenant scoped");
              const failure = fault?.(table, q);
              if (failure) return failure;
              const rows = (overrides[table] ?? []).filter((r) =>
                q.filters.every((f: any) => f(r)),
              );
              return {
                data: q.head ? null : rows.slice(0, q.limit),
                count: rows.length,
                error: null,
              };
            })
            .then(resolve, reject);
        },
      };
      return b;
    },
  } as any;
}

test("metric reads fail visibly instead of replacing unavailable data with zero", async () => {
  for (const table of [
    "provider_connections",
    "member_integration_identities",
    "phone_calls",
    "health_objects",
  ]) {
    await assert.rejects(
      gatherLearningMetrics(
        metricDb({}, (t) =>
          t === table
            ? { data: null, count: null, error: { message: "PRIVATE_BACKEND_ERROR" } }
            : null,
        ),
        METRIC_TENANT,
        NOW,
      ),
      (e) => !String(e).includes("PRIVATE_BACKEND_ERROR"),
    );
  }
  await assert.rejects(
    gatherLearningMetrics(
      metricDb({}, (t, q) =>
        t === "phone_calls" && q.head ? { data: null, count: null, error: null } : null,
      ),
      METRIC_TENANT,
      NOW,
    ),
    /count unavailable/,
  );
});

test("empty retained data has no fabricated profiles, themes, active capture or healthy processing", async () => {
  const metrics = await gatherLearningMetrics(metricDb(), METRIC_TENANT, NOW);
  assert.equal(metrics.commusoft.profilesSeeded, 0);
  assert.deepEqual(metrics.pipeline.repeatedThemes, []);
  const view = buildLearningOverview(metrics);
  assert.deepEqual(view.sourceTruth.summary.sourcesLive, []);
  assert.equal(view.sourceTruth.summary.processingHealth, "unknown");
  assert.ok(view.sourceTruth.sources.every((s) => s.scheduleState !== "active"));
});

test("multiple mapper versions count one observed communication; skipped records do not count", async () => {
  const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const common = { tenant_id: METRIC_TENANT };
  const db = metricDb({
    interactions: [
      {
        ...common,
        id: id(1),
        source_type: "email",
        related_thread_id: "thread-one",
        processing_status: "enriched",
        occurred_at: NOW,
      },
      {
        ...common,
        id: id(2),
        source_type: "chat",
        related_thread_id: null,
        processing_status: "enriched",
        occurred_at: NOW,
      },
    ],
    intelligence_ingestions: [
      { ...common, id: id(10), interaction_id: id(1), status: "observed" },
      { ...common, id: id(11), interaction_id: id(1), status: "observed" },
      { ...common, id: id(12), interaction_id: id(2), status: "skipped" },
    ],
  });
  const m = await gatherLearningMetrics(db, METRIC_TENANT, NOW);
  assert.equal(m.pipeline.commsNoIntelligence, 1);
  assert.equal(m.email.threads, 1);
});

test("a truncated thread inventory fails rather than reporting a partial total", async () => {
  await assert.rejects(
    gatherLearningMetrics(
      metricDb({}, (table, q) =>
        table === "interactions" && q.head && q.filters.length === 3
          ? { data: null, count: 2, error: null }
          : null,
      ),
      METRIC_TENANT,
      NOW,
    ),
    /Complete learning distinct values/,
  );
});

test("retained count broker rejects unavailable, foreign or invalid totals", async () => {
  for (const response of [
    { error: { message: "PRIVATE" }, data: null },
    {
      error: null,
      data: {
        version: "learn-learning-counts/1",
        tenant_id: "another",
        commusoft_versions: 1,
        slack_messages: 2,
      },
    },
    {
      error: null,
      data: {
        version: "learn-learning-counts/1",
        tenant_id: METRIC_TENANT,
        commusoft_versions: -1,
        slack_messages: 2,
      },
    },
    {
      error: null,
      data: {
        version: "learn-learning-counts/1",
        tenant_id: METRIC_TENANT,
        commusoft_versions: 1,
        slack_messages: null,
      },
    },
  ]) {
    const db = metricDb();
    db.rpc = async () => response;
    await assert.rejects(
      gatherLearningMetrics(db, METRIC_TENANT, NOW),
      /^Error: Learning retained counts unavailable$/,
    );
  }
});

test("queue read failures are not presented as empty queues", async () => {
  for (const queue of ["overdue_actions", "recs_awaiting_review"]) {
    assert.ok(QUEUE_DEFS.some((d) => d.key === queue));
    const db = metricDb({}, () => ({ data: null, error: { message: "PRIVATE" } }));
    await assert.rejects(
      gatherQueueRecords(db, METRIC_TENANT, queue, NOW),
      /^Error: Learning records could not be verified$/,
    );
  }
});

test("published Commusoft job totals include account-scoped API jobs and exclude other adapters", async () => {
  const db = metricDb({
    jobs: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        tenant_id: METRIC_TENANT,
        source_system: "commusoft",
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        tenant_id: METRIC_TENANT,
        source_system: "commusoft:connection:abc",
      },
      {
        id: "10000000-0000-4000-8000-000000000003",
        tenant_id: METRIC_TENANT,
        source_system: "another",
      },
      {
        id: "10000000-0000-4000-8000-000000000004",
        tenant_id: "another-tenant",
        source_system: "commusoft",
      },
    ],
  });
  assert.equal((await gatherLearningMetrics(db, METRIC_TENANT, NOW)).commusoft.canonicalRows, 2);
});
