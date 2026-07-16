/**
 * Command Centre feed — the unified "business intelligence" surface (CLIENT-AGNOSTIC).
 * Read-only, tenant-scoped, built ENTIRELY from existing backend sources: platform_events,
 * intelligence_objects, recommendations, automation_intents, decision_log and outcomes.
 * It fabricates nothing: every item is a real row, mapped into one timeline shape
 * (timestamp, type, title, business context, AI reasoning, recommended action,
 * confidence, status, priority). Each source degrades independently.
 *
 * This module imports NO Supabase client accessor, so it is safe to run under Node (the
 * demo export) as well as the browser. The fetch takes any SupabaseClient; the mapping is
 * pure. The SAME `fetchCommandRows` + `mapCommandFeed` therefore serve BOTH surfaces:
 *   • authenticated mode — the RLS browser client (tenant scoped by the session);
 *   • demo/proof mode     — a tenant-scoped service-role export.
 * The browser wrapper `getCommandFeed()` lives in ./command-centre.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type CommandSource =
  | "recommendation"
  | "signal" // intelligence_objects Observation
  | "action" // intelligence_objects Action
  | "automation" // automation_intents
  | "outcome"
  | "event"; // platform_events

export type CommandPriority = "high" | "medium" | "low";

/** One row in the unified command feed. Every field maps to a real backend column. */
export interface CommandItem {
  id: string; // source-prefixed to avoid cross-table collisions
  rawId: string; // the underlying row id (unprefixed) — used to act on the item
  source: CommandSource;
  /** The business STORY this item belongs to: a shared decision lineage (signal → action
   *  → intent → outcome) or a shared customer entity. Items with the same key group. */
  storyKey: string;
  entityRef: string | null; // customer/company/card id when the item is entity-anchored
  timestamp: string; // ISO
  eventType: string; // human-readable
  title: string;
  context: string | null; // business context
  reasoning: string | null; // AI reasoning (decision_log, rules, evidence)
  recommendedAction: string | null;
  confidence: number | null; // 0..1
  /** The resolved customer's display name, when the item is anchored to a known
   *  customer (surfaced from the Observation's customer context). null otherwise. */
  customerName: string | null;
  /** The human "why this surfaced / why it matters" line, when known (the customer-card
   *  summary carried on the Observation). Distinct from AI `reasoning`. */
  whySurfaced: string | null;
  status: string; // raw lifecycle status
  priority: CommandPriority;
  /** Open = still needs a human/engine to act; terminal states are closed. */
  isOpen: boolean;
  isCompleted: boolean;
  isAutomated: boolean;
  /** Whether Approve / Edit / Dismiss affordances are meaningful for this item. */
  actionable: boolean;
}

export interface CommandSummary {
  total: number;
  needsAttention: number;
  recommendations: number;
  completed: number;
  automated: number;
  high: number;
  medium: number;
  low: number;
  latestAt: string | null;
}

export interface CommandFeed {
  items: CommandItem[];
  summary: CommandSummary;
  /** Which sources answered vs were unavailable (honest partial state). */
  sources: Record<CommandSource, "ok" | "unavailable">;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function humanize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
function clampLimit(v: number | undefined, def = 60): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : def;
  return Math.max(1, Math.min(200, n));
}
function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
const TERMINAL_OK = new Set([
  "succeeded",
  "resolved",
  "actioned",
  "observed",
  "completed",
  "closed",
]);
const TERMINAL_DEAD = new Set(["dismissed", "cancelled", "rejected", "expired", "failed"]);

/** A guarded select: returns rows, or null when the table/query is unavailable. */
async function safeSelect<T>(
  build: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[] | null> {
  try {
    const { data, error } = await build();
    if (error) return null;
    return (data ?? []) as T[];
  } catch {
    return null;
  }
}

// ── decision_log reasoning index (AI reasoning for objects + intents) ──────────

interface DecisionRow {
  id: string;
  decision: string | null;
  reason_codes: string[] | null;
  decision_package: Record<string, unknown> | null;
}
function reasoningFromDecision(d: DecisionRow | undefined): string | null {
  if (!d) return null;
  const pkg = d.decision_package as { rationale?: { summary?: string } } | null;
  const summary = pkg?.rationale?.summary;
  if (typeof summary === "string" && summary.trim()) return summary;
  const codes = (d.reason_codes ?? []).map(humanize).filter(Boolean);
  const head = d.decision ? humanize(d.decision) : null;
  const tail = codes.length ? codes.slice(0, 3).join(" · ") : null;
  return [head, tail].filter(Boolean).join(" — ") || null;
}

/** Pull the resolved customer context an Observation carries (title = customer name,
 *  summary = the "why it matters" narrative) + the customer-card recommended action.
 *  All honest: absent context stays null, never fabricated. */
function customerContextFor(obj: Record<string, unknown>): {
  name: string | null;
  summary: string | null;
  recommendedAction: string | null;
} {
  const attrs = (obj.attributes as Record<string, unknown> | null) ?? {};
  const cc = (attrs.customer_context as Record<string, unknown> | null) ?? null;
  const name = (cc?.title as string | null) ?? null;
  const summary = (cc?.summary as string | null) ?? null;
  let recommendedAction: string | null = null;
  const evidence = obj.evidence;
  if (Array.isArray(evidence)) {
    for (const e of evidence) {
      const ref = e as { ref?: string; recommended_action?: string } | null;
      if (ref?.ref === "customer_card" && typeof ref.recommended_action === "string") {
        recommendedAction = ref.recommended_action;
        break;
      }
    }
  }
  return { name, summary, recommendedAction };
}

// ── priority derivation (the "intelligence" that ranks the feed) ───────────────

function priorityFor(args: {
  source: CommandSource;
  status: string;
  severity?: string | null;
}): CommandPriority {
  const { source, status, severity } = args;
  if (TERMINAL_OK.has(status) || TERMINAL_DEAD.has(status)) return "low";
  switch (source) {
    case "automation":
      return status === "pending" ? "high" : status === "failed" ? "medium" : "low";
    case "recommendation":
      return severity === "critical" || severity === "high"
        ? "high"
        : severity === "medium"
          ? "medium"
          : "low";
    case "action":
      return ["ready", "proposed", "review", "blocked", "monitoring"].includes(status)
        ? "high"
        : "medium";
    case "signal":
      return ["waiting", "blocked"].includes(status) ? "medium" : "low";
    default:
      return "low";
  }
}

// ── raw rows (source-agnostic) ─────────────────────────────────────────────────

/** Raw, already-fetched feed rows (one array per source) + the resolved decisions.
 *  The SAME shape whether fetched via the RLS browser client (authenticated mode) or a
 *  tenant-scoped service-role client (demo export) — so mapping stays single-source. */
export interface CommandRows {
  recs: Record<string, unknown>[] | null;
  objs: Record<string, unknown>[] | null;
  intents: Record<string, unknown>[] | null;
  outs: Record<string, unknown>[] | null;
  events: Record<string, unknown>[] | null;
  decisions: DecisionRow[];
}

export interface FetchRowsOptions {
  perSource?: number;
  /** Scope every query to a tenant. Required for the service-role export; omitted in
   *  authenticated mode, where RLS already scopes to the caller's tenant. */
  tenantId?: string;
}

/** One guarded, optionally tenant-scoped select. */
function scopedSelect(
  supabase: SupabaseClient,
  tenantId: string | undefined,
  table: string,
  columns: string,
  orderColumn: string,
  lim: number,
): Promise<Record<string, unknown>[] | null> {
  return safeSelect<Record<string, unknown>>(() => {
    let q = supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: false })
      .limit(lim);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    return q;
  });
}

/** Fetch the feed rows with ANY Supabase client. Pass tenantId to scope explicitly
 *  (service-role/export); omit it under RLS. Pure of mapping logic. */
export async function fetchCommandRows(
  supabase: SupabaseClient,
  opts: FetchRowsOptions = {},
): Promise<CommandRows> {
  const lim = clampLimit(opts.perSource);
  const t = opts.tenantId;

  const [recs, objs, intents, outs, events] = await Promise.all([
    scopedSelect(
      supabase,
      t,
      "recommendations",
      "id, type, title, detail, severity, status, recommended_action, confidence, impact, source_rule, card_id, person_id, company_id, created_at",
      "created_at",
      lim,
    ),
    scopedSelect(
      supabase,
      t,
      "intelligence_objects",
      "id, domain, object_type, subject, priority, severity, confidence, status, deadline, decision_id, attributes, evidence, created_at",
      "created_at",
      lim,
    ),
    scopedSelect(
      supabase,
      t,
      "automation_intents",
      "id, action_object_id, intent_type, capability_key, status, parameters, decision_id, created_at",
      "created_at",
      lim,
    ),
    scopedSelect(
      supabase,
      t,
      "outcomes",
      "id, outcome_type, outcome_layer, status, automation_intent_id, action_object_id, observed_at, created_at",
      "observed_at",
      lim,
    ),
    scopedSelect(
      supabase,
      t,
      "platform_events",
      "id, event_type, subject_type, subject_id, source, domain, payload, occurred_at, created_at",
      "occurred_at",
      Math.min(lim, 40),
    ),
  ]);

  // Reasoning index: fetch the decisions referenced by objects + intents in one query.
  const decisionIds = Array.from(
    new Set(
      [...(objs ?? []), ...(intents ?? [])]
        .map((r) => r.decision_id as string | null)
        .filter((x): x is string => typeof x === "string"),
    ),
  );
  let decisions: DecisionRow[] = [];
  if (decisionIds.length > 0) {
    const decRows = await safeSelect<DecisionRow>(() => {
      let q = supabase
        .from("decision_log")
        .select("id, decision, reason_codes, decision_package")
        .in("id", decisionIds);
      if (t) q = q.eq("tenant_id", t);
      return q;
    });
    decisions = decRows ?? [];
  }

  return { recs, objs, intents, outs, events, decisions };
}

// ── the unified feed (PURE: rows → feed) ───────────────────────────────────────

/** Map already-fetched rows into the unified feed. Deterministic, no I/O — the single
 *  source of truth for BOTH the authenticated UI and the demo export. */
export function mapCommandFeed(rows: CommandRows): CommandFeed {
  const { recs, objs, intents, outs, events } = rows;

  const decisionIndex = new Map<string, DecisionRow>();
  for (const d of rows.decisions) decisionIndex.set(d.id, d);

  // Lineage maps — so an outcome/event/intent can be threaded to the SAME story as the
  // decision + action + signal it descends from (the backbone already links these ids).
  const objDecision = new Map<string, string>();
  for (const o of objs ?? []) {
    const dId = o.decision_id as string | null;
    if (dId) objDecision.set(o.id as string, dId);
  }
  const intentDecision = new Map<string, string>();
  const intentActionObj = new Map<string, string>();
  for (const a of intents ?? []) {
    const dId = (a.decision_id as string | null) ?? objDecision.get(a.action_object_id as string);
    if (dId) intentDecision.set(a.id as string, dId);
    if (a.action_object_id) intentActionObj.set(a.id as string, a.action_object_id as string);
  }
  /** Prefer the decision thread; fall back to the action object; finally the row itself. */
  const lineageKey = (decisionId: string | null, actionObjId: string | null, self: string) =>
    decisionId ? `decision:${decisionId}` : actionObjId ? `obj:${actionObjId}` : self;

  const items: CommandItem[] = [];

  // 1) recommendations — explainable next-actions (title/context/action/confidence built-in)
  for (const r of recs ?? []) {
    const status = (r.status as string) ?? "open";
    const severity = (r.severity as string) ?? null;
    const priority = priorityFor({ source: "recommendation", status, severity });
    const impact = r.impact as string | null;
    const entity =
      (r.card_id as string | null) ??
      (r.person_id as string | null) ??
      (r.company_id as string | null) ??
      null;
    items.push({
      id: `rec:${r.id}`,
      rawId: r.id as string,
      source: "recommendation",
      storyKey: entity ? `entity:${entity}` : `rec:${r.id}`,
      entityRef: entity,
      timestamp: (r.created_at as string) ?? new Date(0).toISOString(),
      eventType: r.type ? humanize(r.type as string) : "Recommendation",
      title: (r.title as string) ?? "Recommendation",
      context: (r.detail as string) ?? null,
      reasoning: r.source_rule
        ? `Rule: ${humanize(r.source_rule as string)}${impact ? ` — if ignored: ${impact}` : ""}`
        : impact
          ? `If ignored: ${impact}`
          : null,
      recommendedAction: (r.recommended_action as string) ?? null,
      confidence: (r.confidence as number | null) ?? null,
      customerName: null,
      whySurfaced: null,
      status,
      priority,
      isOpen: status === "open",
      isCompleted: TERMINAL_OK.has(status),
      isAutomated: false,
      actionable: status === "open",
    });
  }

  // 2) intelligence_objects — Observations (signals) + Actions (proposed work)
  for (const o of objs ?? []) {
    const objectType = (o.object_type as string) ?? "Observation";
    const isAction = objectType.toLowerCase() === "action";
    const status = (o.status as string) ?? "monitoring";
    const attrs = (o.attributes as Record<string, unknown> | null) ?? {};
    const source: CommandSource = isAction ? "action" : "signal";
    const priority = priorityFor({ source, status, severity: o.severity as string | null });
    const cc = customerContextFor(o);
    items.push({
      id: `obj:${o.id}`,
      rawId: o.id as string,
      source,
      storyKey: lineageKey(o.decision_id as string | null, o.id as string, `obj:${o.id}`),
      entityRef: null,
      timestamp: (o.created_at as string) ?? new Date(0).toISOString(),
      eventType: isAction ? "Proposed action" : "Business signal",
      title: (o.subject as string) ?? (isAction ? "Proposed action" : "Signal"),
      context:
        (attrs.description as string) ??
        (o.domain ? `${humanize(o.domain as string)} · ${humanize(objectType)}` : null),
      reasoning:
        reasoningFromDecision(decisionIndex.get(o.decision_id as string)) ??
        (attrs.reason as string) ??
        null,
      recommendedAction: isAction
        ? (attrs.action_type as string)
          ? humanize(attrs.action_type as string)
          : (attrs.automation_intent as string)
            ? humanize(attrs.automation_intent as string)
            : null
        : cc.recommendedAction,
      confidence: (o.confidence as number | null) ?? null,
      customerName: cc.name,
      whySurfaced: cc.summary,
      status,
      priority,
      isOpen: !TERMINAL_OK.has(status) && !TERMINAL_DEAD.has(status),
      isCompleted: TERMINAL_OK.has(status),
      isAutomated: false,
      actionable: isAction && !TERMINAL_OK.has(status) && !TERMINAL_DEAD.has(status),
    });
  }

  // 3) automation_intents — the actionable automation layer (pending = needs approval)
  for (const a of intents ?? []) {
    const status = (a.status as string) ?? "pending";
    const params = (a.parameters as Record<string, unknown> | null) ?? {};
    const body = (params.body as string) ?? (params.note as string) ?? null;
    const priority = priorityFor({ source: "automation", status });
    items.push({
      id: `intent:${a.id}`,
      rawId: a.id as string,
      source: "automation",
      storyKey: lineageKey(
        intentDecision.get(a.id as string) ?? null,
        (a.action_object_id as string | null) ?? null,
        `intent:${a.id}`,
      ),
      entityRef: null,
      timestamp: (a.created_at as string) ?? new Date(0).toISOString(),
      eventType: "Automated action",
      title: humanize((a.intent_type as string) ?? "Automation intent"),
      context: a.capability_key ? `Capability: ${humanize(a.capability_key as string)}` : null,
      reasoning:
        reasoningFromDecision(decisionIndex.get(a.decision_id as string)) ??
        (status === "pending" ? "Awaiting human approval before execution." : null),
      recommendedAction: body
        ? body.slice(0, 240)
        : humanize((a.intent_type as string) ?? "") || null,
      confidence: null,
      customerName: null,
      whySurfaced: null,
      status,
      priority,
      isOpen: status === "pending" || status === "failed",
      isCompleted: status === "succeeded",
      isAutomated: true,
      actionable: status === "pending",
    });
  }

  // 4) outcomes — recorded operational results (completed, informational)
  for (const oc of outs ?? []) {
    const status = (oc.status as string) ?? "observed";
    const ocDecision =
      intentDecision.get(oc.automation_intent_id as string) ??
      objDecision.get(oc.action_object_id as string) ??
      null;
    items.push({
      id: `outcome:${oc.id}`,
      rawId: oc.id as string,
      source: "outcome",
      storyKey: lineageKey(
        ocDecision,
        (oc.action_object_id as string | null) ?? null,
        `outcome:${oc.id}`,
      ),
      entityRef: null,
      timestamp:
        (oc.observed_at as string) ?? (oc.created_at as string) ?? new Date(0).toISOString(),
      eventType: "Outcome recorded",
      title: humanize((oc.outcome_type as string) ?? "Outcome"),
      context: oc.outcome_layer ? `${humanize(oc.outcome_layer as string)} outcome` : null,
      reasoning: null,
      recommendedAction: null,
      confidence: null,
      customerName: null,
      whySurfaced: null,
      status,
      priority: "low",
      isOpen: false,
      isCompleted: true,
      isAutomated: oc.automation_intent_id != null,
      actionable: false,
    });
  }

  // 5) platform_events — the raw event stream (informational; the "Everything" firehose)
  for (const e of events ?? []) {
    const et = (e.event_type as string) ?? "event";
    const subjId = e.subject_id as string | null;
    const evDecision =
      e.subject_type === "automation_intent" && subjId
        ? (intentDecision.get(subjId) ?? objDecision.get(intentActionObj.get(subjId) ?? "") ?? null)
        : null;
    items.push({
      id: `event:${e.id}`,
      rawId: e.id as string,
      source: "event",
      storyKey: evDecision ? `decision:${evDecision}` : `event:${e.id}`,
      entityRef: null,
      timestamp: (e.occurred_at as string) ?? (e.created_at as string) ?? new Date(0).toISOString(),
      eventType: humanize(et),
      title: humanize(et),
      context: e.domain
        ? `${humanize(e.domain as string)} · ${humanize((e.source as string) ?? "")}`.trim()
        : ((e.source as string) ?? null),
      reasoning: null,
      recommendedAction: null,
      confidence: null,
      customerName: null,
      whySurfaced: null,
      status: (e.status as string) ?? "recorded",
      priority: "low",
      isOpen: false,
      isCompleted: false,
      isAutomated: et.startsWith("automation."),
      actionable: false,
    });
  }

  items.sort((a, b) => ms(b.timestamp) - ms(a.timestamp));

  const summary: CommandSummary = {
    total: items.length,
    needsAttention: items.filter((i) => i.priority === "high" && i.isOpen).length,
    recommendations: items.filter((i) => i.source === "recommendation").length,
    completed: items.filter((i) => i.isCompleted).length,
    automated: items.filter((i) => i.isAutomated).length,
    high: items.filter((i) => i.priority === "high").length,
    medium: items.filter((i) => i.priority === "medium").length,
    low: items.filter((i) => i.priority === "low").length,
    latestAt: items[0]?.timestamp ?? null,
  };

  return {
    items,
    summary,
    sources: {
      recommendation: recs == null ? "unavailable" : "ok",
      signal: objs == null ? "unavailable" : "ok",
      action: objs == null ? "unavailable" : "ok",
      automation: intents == null ? "unavailable" : "ok",
      outcome: outs == null ? "unavailable" : "ok",
      event: events == null ? "unavailable" : "ok",
    },
  };
}
