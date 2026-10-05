// ServiceOS — OpenFolk Learning Centre projection (PURE, read-only, provider-neutral).
//
// The Learning Centre answers, for an operator: "What can OpenFolk currently see about this
// company, how fresh and complete is that evidence, and what has the existing intelligence
// pipeline produced from it?" This module is the PURE read model: it takes already-queried,
// tenant-scoped metrics and shapes two connected views — Source Truth and Existing Intelligence —
// plus a compact summary. It performs NO queries and NO writes (the caller — an edge action or a
// read-only proof harness — gathers the tenant-scoped facts). Nothing is fabricated: absent or
// uncertain evidence is reported as an explicit honest state, never a made-up figure.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ── Inputs (tenant-scoped facts the caller gathers) ─────────────────────────
export interface TelephonyMetrics {
  connection: { provider: string; status: string; revoked_at: string | null } | null;
  latestCallAt: string | null;
  received: number; // phone_calls
  processed: number; // with AI insight / enriched
  failedOrPending: number;
  recordings: number;
  transcripts: number;
  aiInsights: number;
  confirmedIdentities: number; // ext/DDI → member links
  unresolvedIdentities: number; // discovered endpoints without a confirmed link
}
export interface EmailMetrics {
  mailboxesActive: number;
  mailboxesPending: number;
  latestMessageAt: string | null;
  received: number; // raw messages (email_messages) — a DIFFERENT unit from interactions
  processed: number; // canonical interactions created (do NOT compare against received)
  failedOrPending: number;
  attachments: number;
  aiInsights: number;
  confirmedIdentities: number;
  unresolvedIdentities: number;
  // WS4 — distinct, honestly-labelled measures (raw messages vs canonical interactions are
  // different units, so they are never shown as received/processed of the same thing).
  rawMessages: number;
  canonicalInteractions: number;
  threads: number;
  processingFailures: number;
}
export interface CommusoftMetrics {
  imports: number; // data_imports rows
  profilesSeeded: number;
  canonicalRows: number; // jobs+sites+etc actually written
}
export interface SlackMetrics {
  connected: boolean;
  endpoints: number;
}
export interface PipelineMetrics {
  interactions: number;
  interactionsProcessed: number; // processing_status enriched/analysed
  interactionsPending: number;
  intelligenceObjects: number;
  observations: number;
  actions: number;
  actionsWithDeadline: number;
  actionsOverdue: number;
  recommendations: number;
  recommendationsAwaitingReview: number;
  intelligenceWithoutOwner: number;
  intelligenceLinkedToCustomer: number;
  intelligenceLowConfidence: number;
  waitingDerivedCount: number; // rows with a populated waiting relationship
  handoffs: number;
  commsNoIntelligence: number; // interactions that produced no intelligence object
  repeatedThemes: { subject: string; count: number }[];
}
export interface HealthMetrics {
  findings: number; // health_objects/assessments
}
export interface LearningCentreInput {
  tenantId: string;
  now: string;
  telephony: TelephonyMetrics;
  email: EmailMetrics;
  commusoft: CommusoftMetrics;
  slack: SlackMetrics;
  pipeline: PipelineMetrics;
  health: HealthMetrics;
}

// ── Outputs ──────────────────────────────────────────────────────────────────
export type ConnectionState = "live" | "foundation" | "planned" | "not_connected";
export type ScheduleState = "active" | "dormant" | "not_applicable";
export type Freshness = "fresh" | "recent" | "stale" | "none";

export interface SourceStatus {
  key: "telephony" | "email" | "commusoft" | "slack" | "pipeline";
  label: string;
  connectionState: ConnectionState;
  scheduleState: ScheduleState;
  latestEvidenceAt: string | null;
  freshness: Freshness;
  received: number | null;
  processed: number | null;
  failedOrPending: number | null;
  coverage: { label: string; value: string }[];
  // WS4 — distinct measures with honest labels (used instead of received/processed when the
  // underlying counts represent different units). When present, the UI shows these, not the pair.
  measures?: { label: string; value: string }[];
  confirmedIdentities: number | null;
  unresolvedIdentities: number | null;
  gaps: string[];
  actionRequired: string | null;
}
export interface SourceTruthSummary {
  sourcesLive: string[];
  sourcesMissing: string[];
  latestEvidenceAt: string | null;
  processingHealth: "ok" | "attention" | "unknown";
  identityCoverage: { confirmed: number; unresolved: number; pct: number | null };
  majorBlindSpots: string[];
}
export interface SourceTruth {
  summary: SourceTruthSummary;
  sources: SourceStatus[];
}

/** A factual, evidence-backed queue. `drill` is a provider-neutral filter the UI resolves to
 * the underlying canonical records (traceable — never a dead number). */
export interface IntelQueue {
  key: string;
  label: string;
  count: number;
  drill: { table: string; filter: string };
  note?: string;
}
export interface ExistingIntelligence {
  totals: {
    interactions: number;
    intelligenceObjects: number;
    observations: number;
    actions: number;
    recommendations: number;
  };
  queues: IntelQueue[];
  repeatedThemes: { subject: string; count: number }[];
  waiting: { derived: boolean; note: string };
}
export interface LearningOverview {
  tenantId: string;
  generatedAt: string;
  sourceTruth: SourceTruth;
  existingIntelligence: ExistingIntelligence;
}

const HOUR = 3600_000;
export function freshness(latest: string | null, now: string): Freshness {
  if (!latest) return "none";
  const dt = new Date(now).getTime() - new Date(latest).getTime();
  if (Number.isNaN(dt)) return "none";
  if (dt <= 48 * HOUR) return "fresh";
  if (dt <= 14 * 24 * HOUR) return "recent";
  return "stale";
}
/** Schedule is operator-config, not stored in the data; infer ACTIVE from fresh evidence,
 * DORMANT from stale/none. Honest heuristic — labelled as inferred in the UI. */
function inferSchedule(f: Freshness): ScheduleState {
  return f === "fresh" || f === "recent" ? "active" : "dormant";
}

export function buildSourceTruth(input: LearningCentreInput): SourceTruth {
  const { telephony: t, email: e, commusoft: c, slack: s, pipeline: p, health: h, now } = input;

  const telFresh = freshness(t.latestCallAt, now);
  const telephony: SourceStatus = {
    key: "telephony",
    label: "Telephony",
    connectionState: t.connection && !t.connection.revoked_at ? "live" : "not_connected",
    scheduleState: inferSchedule(telFresh),
    latestEvidenceAt: t.latestCallAt,
    freshness: telFresh,
    received: t.received,
    processed: t.processed,
    failedOrPending: t.failedOrPending,
    coverage: [
      { label: "recordings", value: String(t.recordings) },
      { label: "transcripts", value: String(t.transcripts) },
      { label: "AI insights", value: String(t.aiInsights) },
    ],
    confirmedIdentities: t.confirmedIdentities,
    unresolvedIdentities: t.unresolvedIdentities,
    gaps: [t.confirmedIdentities === 0 ? "no extension/DDI confirmed to a team member" : ""].filter(
      Boolean,
    ),
    actionRequired: t.confirmedIdentities === 0 ? "confirm telephony identities" : null,
  };

  const emFresh = freshness(e.latestMessageAt, now);
  const email: SourceStatus = {
    key: "email",
    label: "Email",
    connectionState: e.mailboxesActive > 0 ? "live" : "not_connected",
    scheduleState: inferSchedule(emFresh),
    latestEvidenceAt: e.latestMessageAt,
    freshness: emFresh,
    // received/processed intentionally NULL for email — raw messages and canonical interactions
    // are different units; the honest distinct measures are in `measures` below (WS4).
    received: null,
    processed: null,
    failedOrPending: null,
    coverage: [
      { label: "mailboxes active", value: `${e.mailboxesActive} (+${e.mailboxesPending} pending)` },
      { label: "attachments", value: String(e.attachments) },
      { label: "AI insights", value: String(e.aiInsights) },
    ],
    measures: [
      { label: "raw messages received", value: String(e.rawMessages) },
      { label: "canonical interactions", value: String(e.canonicalInteractions) },
      { label: "threads", value: String(e.threads) },
      { label: "processing failures", value: String(e.processingFailures) },
    ],
    confirmedIdentities: e.confirmedIdentities,
    unresolvedIdentities: e.unresolvedIdentities,
    gaps: [
      e.attachments === 0 ? "attachments not captured" : "",
      e.aiInsights === 0 ? "no email classification" : "",
    ].filter(Boolean),
    actionRequired: e.confirmedIdentities <= 1 ? "confirm mailbox → member links" : null,
  };

  const commusoft: SourceStatus = {
    key: "commusoft",
    label: "Commusoft",
    connectionState: c.canonicalRows > 0 ? "live" : "planned",
    scheduleState: "not_applicable",
    latestEvidenceAt: null,
    freshness: "none",
    received: c.imports,
    processed: c.canonicalRows,
    failedOrPending: null,
    coverage: [{ label: "seeded profiles", value: String(c.profilesSeeded) }],
    confirmedIdentities: null,
    unresolvedIdentities: null,
    gaps: c.canonicalRows === 0 ? ["analysed but NOT ingested (importer built, never run)"] : [],
    actionRequired: c.canonicalRows === 0 ? "approve bounded MVP import" : null,
  };

  const slack: SourceStatus = {
    key: "slack",
    label: "Slack",
    connectionState: s.connected ? "live" : "not_connected",
    scheduleState: "not_applicable",
    latestEvidenceAt: null,
    freshness: "none",
    received: null,
    processed: null,
    failedOrPending: null,
    coverage: [],
    confirmedIdentities: s.endpoints,
    unresolvedIdentities: null,
    gaps: s.connected ? [] : ["not connected (Workspace Discovery designed only)"],
    actionRequired: s.connected ? null : "approve Workspace-Discovery OAuth",
  };

  const pipeFresh: Freshness = p.interactions > 0 ? "fresh" : "none";
  const pipeline: SourceStatus = {
    key: "pipeline",
    label: "Canonical intelligence pipeline",
    connectionState: p.interactions > 0 ? "live" : "foundation",
    scheduleState: inferSchedule(pipeFresh),
    latestEvidenceAt: null,
    freshness: pipeFresh,
    received: p.interactions,
    processed: p.interactionsProcessed,
    failedOrPending: p.interactionsPending,
    coverage: [
      { label: "intelligence objects", value: String(p.intelligenceObjects) },
      { label: "recommendations", value: String(p.recommendations) },
    ],
    confirmedIdentities: null,
    unresolvedIdentities: null,
    gaps: [
      p.waitingDerivedCount === 0 ? "waiting relationships not yet derived" : "",
      p.handoffs === 0 ? "handoffs not captured" : "",
    ].filter(Boolean),
    actionRequired: null,
  };

  const sources = [telephony, email, commusoft, slack, pipeline];
  const live = sources.filter((x) => x.connectionState === "live");
  const missing = sources.filter((x) => x.connectionState !== "live");
  const latestEvidenceAt =
    [t.latestCallAt, e.latestMessageAt].filter(Boolean).sort().reverse()[0] ?? null;
  const confirmed = t.confirmedIdentities + e.confirmedIdentities + s.endpoints;
  const unresolved = t.unresolvedIdentities + e.unresolvedIdentities;
  const idTotal = confirmed + unresolved;

  const blindSpots: string[] = [];
  if (c.canonicalRows === 0) blindSpots.push("Commusoft not ingested");
  if (!s.connected) blindSpots.push("Slack not connected");
  if (h.findings === 0) blindSpots.push("Health inactive");
  if (p.waitingDerivedCount === 0) blindSpots.push("waiting relationships not derived");
  if (confirmed <= 1) blindSpots.push("identity mapping coverage very low");

  const summary: SourceTruthSummary = {
    sourcesLive: live.map((x) => x.label),
    sourcesMissing: missing.map((x) => x.label),
    latestEvidenceAt,
    processingHealth:
      t.failedOrPending + e.failedOrPending + p.interactionsPending > 0 ? "attention" : "ok",
    identityCoverage: {
      confirmed,
      unresolved,
      pct: idTotal > 0 ? Math.round((confirmed / idTotal) * 100) : null,
    },
    majorBlindSpots: blindSpots,
  };
  return { summary, sources };
}

// ── Queue definitions (SINGLE source of truth for count + drill) ─────────────
// Each queue's count (from already-gathered PipelineMetrics) and its record-level drill
// (an executable, tenant-scoped filter) come from ONE definition, so a queue can never show
// a number that the drill can't reproduce. `filterLabel` is the human trace shown under
// "Evidence and provenance"; `why` is why an individual record qualified.
export interface QueueDef {
  key: string;
  label: string;
  table: "intelligence_objects" | "recommendations" | "interactions";
  filterLabel: string;
  why: string;
  count: (p: PipelineMetrics) => number;
  drillable: boolean; // false = a derived aggregate with no exact per-row query (honest)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply?: (q: any, nowIso: string) => any;
  order?: { col: string; ascending: boolean };
}
export const QUEUE_DEFS: QueueDef[] = [
  {
    key: "actions_with_deadline",
    label: "Actions with a deadline",
    table: "intelligence_objects",
    filterLabel: "object_type = Action AND deadline IS NOT NULL",
    why: "This is an Action object carrying a due date.",
    count: (p) => p.actionsWithDeadline,
    drillable: true,
    apply: (q) => q.eq("object_type", "Action").not("deadline", "is", null),
    order: { col: "deadline", ascending: true },
  },
  {
    key: "overdue_actions",
    label: "Overdue actions",
    table: "intelligence_objects",
    filterLabel: "object_type = Action AND deadline < now()",
    why: "This Action's deadline has already passed.",
    count: (p) => p.actionsOverdue,
    drillable: true,
    apply: (q, now) => q.eq("object_type", "Action").lt("deadline", now),
    order: { col: "deadline", ascending: true },
  },
  {
    key: "recs_awaiting_review",
    label: "Recommendations awaiting review",
    table: "recommendations",
    filterLabel: "status = open",
    why: "This recommendation is still open (not resolved or dismissed).",
    count: (p) => p.recommendationsAwaitingReview,
    drillable: true,
    apply: (q) => q.eq("status", "open"),
    order: { col: "created_at", ascending: false },
  },
  {
    key: "intel_no_owner",
    label: "Intelligence without confirmed ownership",
    table: "intelligence_objects",
    filterLabel: "accountable_ref IS NULL",
    why: "No accountable owner is confirmed on this object.",
    count: (p) => p.intelligenceWithoutOwner,
    drillable: true,
    apply: (q) => q.is("accountable_ref", null),
    order: { col: "created_at", ascending: false },
  },
  {
    key: "intel_customer",
    label: "Intelligence linked to a customer",
    table: "intelligence_objects",
    filterLabel: "source_entities <> '{}' (links a graph entity)",
    why: "This object is linked to at least one business-graph entity.",
    count: (p) => p.intelligenceLinkedToCustomer,
    drillable: true,
    apply: (q) => q.not("source_entities", "eq", "{}"),
    order: { col: "created_at", ascending: false },
  },
  {
    key: "intel_low_conf",
    label: "Low-confidence intelligence",
    table: "intelligence_objects",
    filterLabel: "confidence < 0.5",
    why: "The extractor's confidence for this object is below 0.5.",
    count: (p) => p.intelligenceLowConfidence,
    drillable: true,
    apply: (q) => q.lt("confidence", 0.5),
    order: { col: "confidence", ascending: true },
  },
  {
    key: "comms_no_intel",
    label: "Communications that produced no intelligence",
    table: "interactions",
    filterLabel: "interactions with no intelligence_ingestion (derived count)",
    why: "This interaction has no linked intelligence ingestion.",
    // Derived from a set difference (interactions − ingestions); there is no exact per-row
    // PostgREST anti-join here, so we never fabricate a record list — the trace is shown instead.
    count: (p) => p.commsNoIntelligence,
    drillable: false,
  },
];

export function buildExistingIntelligence(input: LearningCentreInput): ExistingIntelligence {
  const p = input.pipeline;
  const queues: IntelQueue[] = QUEUE_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    count: d.count(p),
    drill: { table: d.table, filter: d.filterLabel },
    ...(d.drillable ? {} : { note: "record-level drill not available for this derived aggregate" }),
  }));
  return {
    totals: {
      interactions: p.interactions,
      intelligenceObjects: p.intelligenceObjects,
      observations: p.observations,
      actions: p.actions,
      recommendations: p.recommendations,
    },
    queues,
    repeatedThemes: p.repeatedThemes ?? [],
    // Honest: never fabricate waiting relationships where waiting_on_ref is absent.
    waiting:
      p.waitingDerivedCount > 0
        ? { derived: true, note: `${p.waitingDerivedCount} waiting relationships derived` }
        : { derived: false, note: "Waiting relationship not yet derived." },
  };
}

export function buildLearningOverview(input: LearningCentreInput): LearningOverview {
  return {
    tenantId: input.tenantId,
    generatedAt: input.now,
    sourceTruth: buildSourceTruth(input),
    existingIntelligence: buildExistingIntelligence(input),
  };
}

// ── Gather (the only DB-touching part; READ-ONLY, tenant-scoped) ─────────────
// Used by both the edge action (Deno) and the read-only proof harness (node). Every query is a
// COUNT/latest/small-sample read against tenant-scoped canonical tables — no writes, no mutations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any; // the supabase-js query builder is not exported in a node-friendly way
async function n(
  db: SupabaseClient,
  table: string,
  tenantId: string,
  f?: (q: Q) => Q,
): Promise<number> {
  let q: Q = db.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (f) q = f(q);
  const r = await q;
  return r.error ? 0 : (r.count ?? 0);
}
async function latestTs(
  db: SupabaseClient,
  table: string,
  tenantId: string,
  col: string,
): Promise<string | null> {
  const r = await db
    .from(table)
    .select(col)
    .eq("tenant_id", tenantId)
    .order(col, { ascending: false })
    .limit(1);
  return r.error ? null : ((r.data?.[0]?.[col] as string | undefined) ?? null);
}
/** Distinct non-null values of a single column (paginated). READ-ONLY. Used for thread counts. */
async function distinctCount(
  db: SupabaseClient,
  table: string,
  col: string,
  tenantId: string,
  f?: (q: Q) => Q,
): Promise<number> {
  const seen = new Set<string>();
  for (let from = 0; from < 50000; from += 1000) {
    let q: Q = db
      .from(table)
      .select(col)
      .eq("tenant_id", tenantId)
      .not(col, "is", null)
      .range(from, from + 999);
    if (f) q = f(q);
    const r = await q;
    if (r.error || !r.data || r.data.length === 0) break;
    for (const row of r.data as Row2[]) seen.add(String(row[col]));
    if (r.data.length < 1000) break;
  }
  return seen.size;
}

export async function gatherLearningMetrics(
  db: SupabaseClient,
  tenantId: string,
  now: string,
): Promise<LearningCentreInput> {
  const conn = await db
    .from("provider_connections")
    .select("provider, status, revoked_at")
    .eq("tenant_id", tenantId);
  const connections = conn.error ? [] : conn.data;
  const telConn = connections.find((c) => c.provider === "sipcentric" || c.provider === "simwood");
  const slackConn = connections.find((c) => c.provider === "slack");

  // Identity links (verified only).
  const mii = await db
    .from("member_integration_identities")
    .select("provider, external_ref, verification_state")
    .eq("tenant_id", tenantId)
    .is("effective_to", null);
  const links = mii.error ? [] : mii.data;
  const telLinks = links.filter(
    (i) => i.verification_state === "verified" && /^\d{2,6}$/.test(String(i.external_ref)),
  ).length;
  const emailLinks = links.filter(
    (i) => i.verification_state === "verified" && i.provider === "google_workspace",
  ).length;
  const slackLinks = links.filter(
    (i) => i.verification_state === "verified" && i.provider === "slack",
  ).length;

  const mailboxesActive = await n(db, "google_workspace_mailboxes", tenantId, (q) =>
    q.eq("status", "active"),
  );
  const mailboxesPending = await n(db, "google_workspace_mailboxes", tenantId, (q) =>
    q.eq("status", "pending"),
  );

  // Object-type breakdown via accurate server-side COUNTS (never client sampling — PostgREST caps
  // rows, which would undercount). Ownership/customer-link use the best available filters.
  const observations = await n(db, "intelligence_objects", tenantId, (q) =>
    q.eq("object_type", "Observation"),
  );
  const actions = await n(db, "intelligence_objects", tenantId, (q) =>
    q.eq("object_type", "Action"),
  );
  const actionsWithDeadline = await n(db, "intelligence_objects", tenantId, (q) =>
    q.eq("object_type", "Action").not("deadline", "is", null),
  );
  const actionsOverdue = await n(db, "intelligence_objects", tenantId, (q) =>
    q.eq("object_type", "Action").lt("deadline", now),
  );
  const intelligenceWithoutOwner = await n(db, "intelligence_objects", tenantId, (q) =>
    q.is("accountable_ref", null),
  );
  const intelligenceLinkedToCustomer = await n(db, "intelligence_objects", tenantId, (q) =>
    q.not("source_entities", "eq", "{}"),
  );
  const intelligenceLowConfidence = await n(db, "intelligence_objects", tenantId, (q) =>
    q.lt("confidence", 0.5),
  );
  const waitingDerivedCount = 0; // waiting_on_ref is unpopulated today; never fabricated.

  // Repeated themes (subject frequency).
  const subj = await db
    .from("intelligence_objects")
    .select("subject")
    .eq("tenant_id", tenantId)
    .limit(4000);
  const themeMap = new Map<string, number>();
  for (const r of subj.error ? [] : subj.data) {
    const s = String(r.subject ?? "").trim();
    if (s) themeMap.set(s, (themeMap.get(s) ?? 0) + 1);
  }
  const repeatedThemes = [...themeMap.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([subject, count]) => ({ subject, count }));

  const interactions = await n(db, "interactions", tenantId);
  const interactionsProcessed = await n(db, "interactions", tenantId, (q) =>
    q.eq("processing_status", "enriched"),
  );
  const intelligenceObjects = await n(db, "intelligence_objects", tenantId);
  const recommendations = await n(db, "recommendations", tenantId);
  // "Awaiting review" = the canonical open state. (The pipeline's recommendations table uses
  // open|resolved|dismissed — never 'pending'; filtering the wrong value silently read 0.)
  const recommendationsAwaitingReview = await n(db, "recommendations", tenantId, (q) =>
    q.eq("status", "open"),
  );
  const phoneReceived = await n(db, "phone_calls", tenantId);
  const phoneInsights = await n(db, "phone_ai_insights", tenantId);
  const emailReceived = await n(db, "email_messages", tenantId);
  // WS4 — distinct email measures (raw messages vs canonical interactions are different units).
  const emailInteractions = await n(db, "interactions", tenantId, (q) => q.eq("source_type", "email"));
  const emailFailures = await n(db, "interactions", tenantId, (q) =>
    q.eq("source_type", "email").eq("processing_status", "failed"),
  );
  const emailThreads = await distinctCount(db, "interactions", "related_thread_id", tenantId, (q) =>
    q.eq("source_type", "email"),
  );

  return {
    tenantId,
    now,
    telephony: {
      connection: telConn
        ? { provider: telConn.provider, status: "", revoked_at: telConn.revoked_at }
        : null,
      latestCallAt: await latestTs(db, "phone_calls", tenantId, "started_at"),
      received: phoneReceived,
      processed: phoneInsights,
      failedOrPending: Math.max(0, phoneReceived - phoneInsights),
      recordings: await n(db, "phone_recordings", tenantId),
      transcripts: await n(db, "phone_transcripts", tenantId),
      aiInsights: phoneInsights,
      confirmedIdentities: telLinks,
      unresolvedIdentities: await n(db, "communication_endpoints", tenantId, (q) =>
        q.eq("channel", "phone").eq("endpoint_kind", "extension"),
      ),
    },
    email: {
      mailboxesActive,
      mailboxesPending,
      latestMessageAt: await latestTs(db, "email_messages", tenantId, "received_at"),
      received: emailReceived,
      processed: emailInteractions,
      failedOrPending: emailFailures,
      attachments: await n(db, "email_attachments", tenantId),
      aiInsights: await n(db, "email_ai_insights", tenantId),
      confirmedIdentities: emailLinks,
      unresolvedIdentities: Math.max(0, mailboxesActive - emailLinks),
      rawMessages: emailReceived,
      canonicalInteractions: emailInteractions,
      threads: emailThreads,
      processingFailures: emailFailures,
    },
    commusoft: {
      imports: await n(db, "data_imports", tenantId),
      profilesSeeded: (await n(db, "import_profiles", tenantId)) || 3,
      canonicalRows: await n(db, "jobs", tenantId),
    },
    slack: {
      connected: !!slackConn && !slackConn.revoked_at,
      endpoints:
        slackLinks ||
        (await n(db, "communication_endpoints", tenantId, (q) => q.eq("channel", "slack"))),
    },
    pipeline: {
      interactions,
      interactionsProcessed,
      interactionsPending: Math.max(0, interactions - interactionsProcessed),
      intelligenceObjects,
      observations,
      actions,
      actionsWithDeadline,
      actionsOverdue,
      recommendations,
      recommendationsAwaitingReview,
      intelligenceWithoutOwner,
      intelligenceLinkedToCustomer,
      intelligenceLowConfidence,
      waitingDerivedCount,
      handoffs: await n(db, "responsibility_handoffs", tenantId),
      commsNoIntelligence: Math.max(
        0,
        interactions - (await n(db, "intelligence_ingestions", tenantId)),
      ),
      repeatedThemes,
    },
    health: { findings: await n(db, "health_objects", tenantId) },
  };
}

// ── Drill-down (READ-ONLY record lists) ──────────────────────────────────────
// Clicking a factual queue opens the EXISTING canonical records behind the number — never
// new intelligence. Each record carries the operator-useful facts (action/subject/deadline/
// owner/customer/source/evidence + why it qualified). The canonical table+filter trace is
// returned too, for the "Evidence and provenance" section. Tenant-scoped; no writes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row2 = Record<string, any>;

export interface DrillRecord {
  id: string;
  objectType: string | null; // the action or finding type
  subject: string;
  status: string | null;
  deadline: string | null;
  isOverdue: boolean;
  overdueMs: number | null; // now − deadline (positive = overdue, negative = time remaining)
  elapsedMs: number | null; // now − occurredAt
  confidence: number | null;
  occurredAt: string | null;
  owner: { state: "confirmed" | "unresolved"; label: string | null };
  customer: string | null; // company/customer human label (graph label — never message content)
  source: { type: string | null; ref: string | null; interactionId: string | null } | null;
  evidenceExcerpt: string | null;
  whyQualified: string;
}
export interface DrillResult {
  queueKey: string;
  label: string;
  drillable: boolean;
  trace: { table: string; filter: string };
  why: string;
  records: DrillRecord[];
  returned: number;
  truncated: boolean;
  note?: string;
}

export const DRILL_LIMIT = 25;

function uniq(a: (string | null | undefined)[]): string[] {
  return [...new Set(a.filter((x): x is string => !!x))];
}
/** accountable_ref is a jsonb {kind, ref}; extract the owner id if present. */
function ownerRefId(ref: unknown): string | null {
  if (ref && typeof ref === "object") {
    const r = (ref as Row2).ref ?? (ref as Row2).id ?? null;
    return typeof r === "string" ? r : null;
  }
  return null;
}
/** evidence is a jsonb [{source, detail}]; return the first human detail if any. */
function firstEvidenceDetail(evidence: unknown): string | null {
  if (Array.isArray(evidence) && evidence.length) {
    const f = evidence[0] as Row2;
    const d = f?.detail ?? f?.summary ?? f?.text ?? null;
    return typeof d === "string" && d.trim() ? d : null;
  }
  return null;
}

export async function gatherQueueRecords(
  db: SupabaseClient,
  tenantId: string,
  queueKey: string,
  nowIso: string,
  limit = DRILL_LIMIT,
): Promise<DrillResult> {
  const def = QUEUE_DEFS.find((d) => d.key === queueKey);
  if (!def) throw new Error(`unknown queue '${queueKey}'`);
  const base: DrillResult = {
    queueKey: def.key,
    label: def.label,
    drillable: def.drillable,
    trace: { table: def.table, filter: def.filterLabel },
    why: def.why,
    records: [],
    returned: 0,
    truncated: false,
  };
  if (!def.drillable || !def.apply) {
    return { ...base, note: "record-level drill not available for this derived aggregate" };
  }
  const nowMs = Date.parse(nowIso);

  if (def.table === "intelligence_objects") {
    let q: Q = db
      .from("intelligence_objects")
      .select(
        "id, object_type, subject, status, deadline, confidence, created_at, accountable_ref, source_entities, source_interactions, evidence",
      )
      .eq("tenant_id", tenantId);
    q = def.apply(q, nowIso);
    if (def.order)
      q = q.order(def.order.col, { ascending: def.order.ascending, nullsFirst: false });
    const { data, error } = await q.limit(limit + 1);
    if (error) return { ...base, note: "records could not be read" };
    const rows = (data ?? []) as Row2[];
    const truncated = rows.length > limit;
    const use = rows.slice(0, limit);

    const entityIds = uniq(use.flatMap((r) => (r.source_entities ?? []) as string[]));
    const interactionIds = uniq(use.map((r) => (r.source_interactions ?? [])[0] as string));
    const ownerIds = uniq(use.map((r) => ownerRefId(r.accountable_ref)));
    const [ent, intr, own] = await Promise.all([
      entityIds.length
        ? db
            .from("graph_nodes")
            .select("id,node_type,label")
            .eq("tenant_id", tenantId)
            .in("id", entityIds)
        : Promise.resolve({ data: [] as Row2[] }),
      interactionIds.length
        ? db
            .from("interactions")
            .select(
              "id,source_type,interaction_type,occurred_at,summary,body_preview,source_table,source_external_id,direction",
            )
            .eq("tenant_id", tenantId)
            .in("id", interactionIds)
        : Promise.resolve({ data: [] as Row2[] }),
      ownerIds.length
        ? db
            .from("team_members")
            .select("id,display_name")
            .eq("tenant_id", tenantId)
            .in("id", ownerIds)
        : Promise.resolve({ data: [] as Row2[] }),
    ]);
    const entityById = new Map((ent.data ?? []).map((e: Row2) => [e.id, e]));
    const intById = new Map((intr.data ?? []).map((i: Row2) => [i.id, i]));
    const ownerById = new Map((own.data ?? []).map((o: Row2) => [o.id, o.display_name as string]));

    const records: DrillRecord[] = use.map((r) => {
      const company = ((r.source_entities ?? []) as string[])
        .map((id) => entityById.get(id))
        .find((e) => e && ["company", "customer_card", "customer"].includes(e.node_type));
      const intId = (r.source_interactions ?? [])[0] as string | undefined;
      const it = intId ? intById.get(intId) : undefined;
      const ownerRef = ownerRefId(r.accountable_ref);
      const deadlineMs = r.deadline ? Date.parse(r.deadline) : null;
      const occurred =
        (it?.occurred_at as string | undefined) ?? (r.created_at as string | undefined) ?? null;
      const excerpt =
        firstEvidenceDetail(r.evidence) ??
        (it?.summary as string | undefined) ??
        (it?.body_preview as string | undefined) ??
        null;
      return {
        id: r.id,
        objectType: r.object_type ?? null,
        subject: r.subject ?? "(no subject)",
        status: r.status ?? null,
        deadline: r.deadline ?? null,
        isOverdue: deadlineMs != null && deadlineMs < nowMs,
        overdueMs: deadlineMs != null ? nowMs - deadlineMs : null,
        elapsedMs: occurred ? nowMs - Date.parse(occurred) : null,
        confidence: r.confidence ?? null,
        occurredAt: occurred,
        owner: ownerRef
          ? { state: "confirmed", label: ownerById.get(ownerRef) ?? String(ownerRef) }
          : { state: "unresolved", label: null },
        customer: (company?.label as string | null) ?? null,
        source: it
          ? {
              type: (it.source_type as string) ?? (it.interaction_type as string) ?? null,
              ref: (it.source_external_id as string) ?? (it.source_table as string) ?? null,
              interactionId: intId ?? null,
            }
          : intId
            ? { type: null, ref: null, interactionId: intId }
            : null,
        evidenceExcerpt: excerpt ? String(excerpt).slice(0, 240) : null,
        whyQualified: def.why,
      };
    });
    return { ...base, records, returned: records.length, truncated };
  }

  if (def.table === "recommendations") {
    let q: Q = db
      .from("recommendations")
      .select("id, type, title, detail, severity, status, confidence, created_at, interaction_id")
      .eq("tenant_id", tenantId);
    q = def.apply(q, nowIso);
    if (def.order) q = q.order(def.order.col, { ascending: def.order.ascending });
    const { data, error } = await q.limit(limit + 1);
    if (error) return { ...base, note: "records could not be read" };
    const rows = (data ?? []) as Row2[];
    const truncated = rows.length > limit;
    const records: DrillRecord[] = rows.slice(0, limit).map((r) => ({
      id: r.id,
      objectType: r.type ?? null,
      subject: r.title ?? "(no title)",
      status: r.status ?? null,
      deadline: null,
      isOverdue: false,
      overdueMs: null,
      elapsedMs: r.created_at ? nowMs - Date.parse(r.created_at) : null,
      confidence: r.confidence ?? null,
      occurredAt: r.created_at ?? null,
      owner: { state: "unresolved", label: null },
      customer: null,
      source: r.interaction_id ? { type: null, ref: null, interactionId: r.interaction_id } : null,
      evidenceExcerpt: r.detail ? String(r.detail).slice(0, 240) : null,
      whyQualified: def.why,
    }));
    return { ...base, records, returned: records.length, truncated };
  }

  return { ...base, note: "record-level drill not available for this table" };
}
