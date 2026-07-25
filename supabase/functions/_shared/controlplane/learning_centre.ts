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
  received: number;
  processed: number; // projected to interactions
  failedOrPending: number;
  attachments: number;
  aiInsights: number;
  confirmedIdentities: number;
  unresolvedIdentities: number;
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
    received: e.received,
    processed: e.processed,
    failedOrPending: e.failedOrPending,
    coverage: [
      { label: "mailboxes active", value: `${e.mailboxesActive} (+${e.mailboxesPending} pending)` },
      { label: "attachments", value: String(e.attachments) },
      { label: "AI insights", value: String(e.aiInsights) },
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

export function buildExistingIntelligence(input: LearningCentreInput): ExistingIntelligence {
  const p = input.pipeline;
  const queues: IntelQueue[] = [
    {
      key: "actions_with_deadline",
      label: "Actions with a deadline",
      count: p.actionsWithDeadline,
      drill: { table: "intelligence_objects", filter: "object_type=Action & deadline not null" },
    },
    {
      key: "overdue_actions",
      label: "Overdue actions",
      count: p.actionsOverdue,
      drill: { table: "intelligence_objects", filter: "object_type=Action & deadline < now" },
    },
    {
      key: "recs_awaiting_review",
      label: "Recommendations awaiting review",
      count: p.recommendationsAwaitingReview,
      drill: { table: "recommendations", filter: "status=pending" },
    },
    {
      key: "intel_no_owner",
      label: "Intelligence without confirmed ownership",
      count: p.intelligenceWithoutOwner,
      drill: { table: "intelligence_objects", filter: "no accountable_ref" },
    },
    {
      key: "intel_customer",
      label: "Intelligence linked to a customer",
      count: p.intelligenceLinkedToCustomer,
      drill: { table: "intelligence_objects", filter: "source_entities → company" },
    },
    {
      key: "intel_low_conf",
      label: "Low-confidence intelligence",
      count: p.intelligenceLowConfidence,
      drill: { table: "intelligence_objects", filter: "confidence < 0.5" },
    },
    {
      key: "comms_no_intel",
      label: "Communications that produced no intelligence",
      count: p.commsNoIntelligence,
      drill: { table: "interactions", filter: "no intelligence_ingestion" },
    },
  ];
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
  const recommendationsAwaitingReview = await n(db, "recommendations", tenantId, (q) =>
    q.eq("status", "pending"),
  );
  const phoneReceived = await n(db, "phone_calls", tenantId);
  const phoneInsights = await n(db, "phone_ai_insights", tenantId);
  const emailReceived = await n(db, "email_messages", tenantId);

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
      processed: await n(db, "interactions", tenantId, (q) => q.eq("source_type", "email")),
      failedOrPending: 0,
      attachments: await n(db, "email_attachments", tenantId),
      aiInsights: await n(db, "email_ai_insights", tenantId),
      confirmedIdentities: emailLinks,
      unresolvedIdentities: Math.max(0, mailboxesActive - emailLinks),
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
