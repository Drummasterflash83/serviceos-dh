// work_projection — the PURE core of the Command Centre's single work list.
//
// Turns the existing backend into ONE role-scoped, objective-linked, explainably ranked
// list of canonical action objects (intelligence_objects, object_class='action').
// Recommendations and other signals are FOLDED IN as evidence around the matching action
// — never a second competing queue (the two-pipeline fix). No IO here: the Edge Function
// loads tenant-scoped rows and passes them in, so folding + ranking are unit-provable.
//
// Universal: no tenant/Drummond branch. Weights are versioned + overridable per tenant.
//
// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

// ── Ownership context (subset of resolveUserOwnership the ranker needs) ──────
export interface ProjectionOwnership {
  userRef: string;                 // email|userId recorded/compared
  memberId: string | null;
  authorityLevel: string | null;   // individual|lead|manager|director|owner
  isLeadership: boolean;           // director|owner OR tenant.superadmin
  ownedObjectiveIds: Set<string>;  // objectives this user is accountable/responsible for
  responsibilityRefs: Set<string>; // target_refs (workflow/area/customer_segment/team) they own
  teamOrgUnitIds: Set<string>;
  managedMemberIds: Set<string>;
  perms: Set<string>;              // authority permissions held (work.assign, work.approve, …)
}

// ── Versioned ranking weights (tenant-overridable later; deterministic core) ─
export interface RankWeights {
  version: string;
  directOwner: number; accountableOwner: number; delegatedResponsibility: number;
  teamRelevance: number; managedOwner: number; authorityToAct: number;
  objectiveImportance: number; objectiveAtRisk: number; kpiRisk: number; strategicPriority: number;
  customerImpact: number; revenueImpact: number; marginImpact: number;
  urgencyOverdue: number; urgencyDueSoon: number; waitingAge: number;
  blockerEffect: number; dependencyBlocked: number; commitmentBreach: number;
  agentFailure: number; evidenceStalePenalty: number; lowConfidencePenalty: number; irreversibility: number;
  // Safety/compliance is a FLOOR, not just a weight, so it can't be buried behind revenue.
  safetyComplianceFloor: number;
}
export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  version: "cc-rank-2026-07-22.1",
  directOwner: 30, accountableOwner: 34, delegatedResponsibility: 18, teamRelevance: 10, managedOwner: 12, authorityToAct: 4,
  objectiveImportance: 12, objectiveAtRisk: 22, kpiRisk: 14, strategicPriority: 10,
  customerImpact: 10, revenueImpact: 12, marginImpact: 12,
  urgencyOverdue: 26, urgencyDueSoon: 14, waitingAge: 8,
  blockerEffect: 12, dependencyBlocked: 6, commitmentBreach: 16,
  agentFailure: 14, evidenceStalePenalty: -8, lowConfidencePenalty: -6, irreversibility: 6,
  safetyComplianceFloor: 1000,
};

export interface WorkEvidence {
  kind: string;          // 'recommendation'|'interaction'|'outcome'|'automation_intent'
  ref: string;
  detail: string | null;
  source: string | null;
  ageHours: number | null;
  confidence: number | null;
}
export interface RankExplanation {
  whyHere: string; whyYours: string; whyAboveNext: string | null;
  objective: string | null; kpi: string | null; consequenceOfDelay: string | null;
  recommends: string | null; aiCanHandle: string | null; humanJudgement: string | null;
  proofOfDone: string | null; missingOrStale: string[];
  factors: { factor: string; contribution: number }[];
}
export interface ProjectedWork {
  id: string; title: string; outcome: string | null; state: string;
  accountableOwner: string | null; operationalOwner: string | null; assignee: string | null;
  team: string | null; role: string | null;
  objectiveId: string | null; objectiveTitle: string | null; kpi: string | null; objectiveHealth: string | null;
  priority: string | null; urgency: string | null; dueAt: string | null;
  waitingOn: string | null; blocker: string | null;
  recommendedAction: string | null; consequenceOfDelay: string | null;
  doneWhen: string | null; completionEvidenceRequired: boolean;
  evidence: WorkEvidence[]; evidenceAgeHours: number | null; confidence: number | null;
  customerRef: string | null; jobRef: string | null; siteRef: string | null;
  relatedRecommendationIds: string[]; possibleDuplicateOf: string[];
  agentActivity: { intentId: string; status: string; outcome: string | null }[];
  score: number; explanation: RankExplanation;
  capabilityStatus: string; // 'LIVE' here (work is real); frontend maps controls per registry
  unresolved: string[];     // 'owner'|'objective'|'kpi_not_measured'|'source_unavailable'|'low_confidence'|'review_required'
}

const hoursBetween = (aIso: string | null | undefined, now: number): number | null =>
  aIso ? Math.max(0, (now - Date.parse(aIso)) / 3.6e6) : null;

// ── Deterministic association keys (repository-native identifiers) ──────────
function actionKeys(a: Row, linkedObjectiveIds: string[]): Set<string> {
  const k = new Set<string>();
  for (const i of (a.source_interactions ?? [])) k.add("int:" + i);
  for (const e of (a.source_entities ?? [])) k.add("ent:" + e);
  const at = a.attributes ?? {};
  // Customer identity may be a person or company; emit a GENERIC entity key too so an
  // action's customer_id associates with a recommendation's person_id/company_id.
  if (at.customer_id) { k.add("cust:" + at.customer_id); k.add("ent:" + at.customer_id); }
  if (at.company_id) { k.add("co:" + at.company_id); k.add("ent:" + at.company_id); }
  if (at.person_id) { k.add("person:" + at.person_id); k.add("ent:" + at.person_id); }
  if (at.job_id) k.add("job:" + at.job_id);
  if (at.site_id) k.add("site:" + at.site_id);
  if (at.commitment_id) k.add("commit:" + at.commitment_id);
  for (const o of linkedObjectiveIds) k.add("obj:" + o);
  return k;
}
function recKeys(r: Row): Set<string> {
  const k = new Set<string>();
  if (r.interaction_id) k.add("int:" + r.interaction_id);
  if (r.person_id) { k.add("person:" + r.person_id); k.add("ent:" + r.person_id); }
  if (r.company_id) { k.add("co:" + r.company_id); k.add("ent:" + r.company_id); }
  if (r.card_id) k.add("card:" + r.card_id);
  const ev = r.evidence ?? {};
  if (ev.job_id) k.add("job:" + ev.job_id);
  if (ev.site_id) k.add("site:" + ev.site_id);
  return k;
}
const intersects = (a: Set<string>, b: Set<string>): boolean => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

/**
 * Filter verification/test artifacts and COLLAPSE repetitive unowned generic actions to one
 * representative (non-destructive — the underlying objects are untouched). Excludes
 * attributes.verification===true. Unowned actions sharing a subject are collapsed to the most
 * recent, carrying `_collapsedCount`; owned actions always pass through individually so real
 * assigned work is never merged.
 */
export function collapseActions(actions: Row[]): Row[] {
  const kept = actions.filter((a) => a.attributes?.verification !== true);
  const groups = new Map<string, Row[]>();
  const singles: Row[] = [];
  for (const a of kept) {
    const owned = a.accountable_ref?.ref || a.responsible_ref?.ref;
    if (owned) { singles.push(a); continue; }
    const key = (a.subject as string) || (a.id as string);
    const arr = groups.get(key) ?? []; arr.push(a); groups.set(key, arr);
  }
  const collapsed: Row[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) { collapsed.push(arr[0]); continue; }
    const rep = arr.slice().sort((x, y) => String(y.updated_at ?? "").localeCompare(String(x.updated_at ?? "")))[0];
    collapsed.push({ ...rep, _collapsedCount: arr.length });
  }
  return [...singles, ...collapsed];
}

export interface FoldResult {
  evidenceByAction: Map<string, Row[]>;   // action.id → recommendations folded as evidence
  standaloneRecs: Row[];                   // matched no action — remain separate
  reviewRecs: { rec: Row; candidateActionIds: string[] }[]; // ambiguous — routed to review, never silently merged
}
/** Fold recommendations onto actions deterministically. 1 match → evidence; >1 → review; 0 → standalone. */
export function foldRecommendations(actions: Row[], recommendations: Row[], objectiveLinksByAction: Map<string, string[]>): FoldResult {
  const aKeys = actions.map((a) => ({ id: a.id as string, keys: actionKeys(a, objectiveLinksByAction.get(a.id) ?? []) }));
  const evidenceByAction = new Map<string, Row[]>();
  const standaloneRecs: Row[] = [];
  const reviewRecs: { rec: Row; candidateActionIds: string[] }[] = [];
  for (const r of recommendations) {
    const rk = recKeys(r);
    const matches = aKeys.filter((a) => intersects(a.keys, rk)).map((a) => a.id);
    if (matches.length === 1) {
      const arr = evidenceByAction.get(matches[0]) ?? [];
      arr.push(r); evidenceByAction.set(matches[0], arr);
    } else if (matches.length > 1) {
      reviewRecs.push({ rec: r, candidateActionIds: matches });
    } else {
      standaloneRecs.push(r);
    }
  }
  return { evidenceByAction, standaloneRecs, reviewRecs };
}

// ── Projection: assemble one ProjectedWork from an action + its context ─────
export interface ActionContext {
  objective: Row | null; objectiveHealth: Row | null; metric: Row | null;
  team: Row | null; evidenceRecs: Row[]; relatedIntents: Row[]; possibleDuplicateOf: string[];
}
export function projectWork(a: Row, ctx: ActionContext, now: number): ProjectedWork {
  const at = a.attributes ?? {};
  const unresolved: string[] = [];
  const accountable = a.accountable_ref?.ref ?? null;
  const responsible = a.responsible_ref?.ref ?? null;
  if (!accountable && !responsible) unresolved.push("owner");
  const objectiveId = ctx.objective?.id ?? null;
  if (!objectiveId) unresolved.push("objective");
  const health = ctx.objectiveHealth?.status ?? null;
  const kpi = ctx.metric?.name ?? null;
  const kpiValue = ctx.metric?.current_value ?? ctx.metric?.baseline_value ?? null;
  if (objectiveId && kpiValue == null) unresolved.push("kpi_not_measured");
  const doneWhen = typeof at.done_when === "string" && at.done_when.trim() ? at.done_when.trim() : null;
  const conf = typeof a.confidence === "number" ? a.confidence : null;
  if (conf != null && conf < 0.4) unresolved.push("low_confidence");

  const evidence: WorkEvidence[] = (ctx.evidenceRecs ?? []).map((r) => ({
    kind: "recommendation", ref: r.id, detail: r.title ?? r.detail ?? null,
    source: r.source_rule ?? r.type ?? null,
    ageHours: hoursBetween(r.created_at, now), confidence: typeof r.confidence === "number" ? r.confidence : null,
  }));
  const evidenceAges = evidence.map((e) => e.ageHours).filter((x): x is number => x != null);
  const evidenceAge = evidenceAges.length ? Math.min(...evidenceAges) : hoursBetween(a.updated_at, now);

  return {
    id: a.id,
    title: a._collapsedCount > 1 ? `${a.subject ?? "(untitled)"} (+${a._collapsedCount - 1} similar)` : (a.subject ?? "(untitled action)"),
    outcome: at.outcome ?? null, state: a.status ?? "unknown",
    accountableOwner: accountable, operationalOwner: responsible, assignee: responsible,
    team: ctx.team?.name ?? null, role: at.role ?? null,
    objectiveId, objectiveTitle: ctx.objective?.title ?? null, kpi, objectiveHealth: health,
    priority: a.priority ?? null, urgency: at.urgency ?? null, dueAt: a.deadline ?? null,
    waitingOn: a.waiting_on_ref?.ref ?? null, blocker: at.blocker ?? null,
    recommendedAction: at.recommended_action ?? (ctx.evidenceRecs[0]?.recommended_action ?? null),
    consequenceOfDelay: at.consequence_of_delay ?? null,
    doneWhen, completionEvidenceRequired: !!doneWhen,
    evidence, evidenceAgeHours: evidenceAge, confidence: conf,
    customerRef: at.customer_id ?? at.company_id ?? null, jobRef: at.job_id ?? null, siteRef: at.site_id ?? null,
    relatedRecommendationIds: (ctx.evidenceRecs ?? []).map((r) => r.id),
    possibleDuplicateOf: ctx.possibleDuplicateOf ?? [],
    agentActivity: (ctx.relatedIntents ?? []).map((i) => ({ intentId: i.id, status: i.status, outcome: i.outcome_summary ?? null })),
    score: 0, capabilityStatus: "LIVE",
    explanation: { whyHere: "", whyYours: "", whyAboveNext: null, objective: ctx.objective?.title ?? null, kpi,
      consequenceOfDelay: at.consequence_of_delay ?? null, recommends: at.recommended_action ?? null,
      aiCanHandle: null, humanJudgement: null, proofOfDone: doneWhen, missingOrStale: [], factors: [] },
    unresolved,
  };
}

// ── Deterministic, explainable, role-aware ranking ──────────────────────────
function isSafety(w: ProjectedWork): boolean {
  const t = `${w.title} ${w.blocker ?? ""}`.toLowerCase();
  return /\b(h&s|health\s*&?\s*safety|rams|compliance|gas\s*safe|hazard|unsafe|legal)\b/.test(t) ||
    (w as any)._safety === true;
}
export function rankWork(items: ProjectedWork[], own: ProjectionOwnership, w: RankWeights, now: number): ProjectedWork[] {
  for (const it of items) {
    let score = 0; const factors: { factor: string; contribution: number }[] = [];
    const add = (factor: string, c: number) => { if (c) { score += c; factors.push({ factor, contribution: c }); } };

    // ownership / role relevance
    const mine = it.accountableOwner && (it.accountableOwner === own.userRef || it.accountableOwner === own.memberId);
    const opMine = it.operationalOwner && (it.operationalOwner === own.userRef || it.operationalOwner === own.memberId);
    if (mine) add("accountable owner", w.accountableOwner);
    if (opMine) add("direct owner", w.directOwner);
    if (it.objectiveId && own.ownedObjectiveIds.has(it.objectiveId)) add("owns linked objective", w.delegatedResponsibility);
    if (it.customerRef && own.responsibilityRefs.has(it.customerRef)) add("responsibility area", w.delegatedResponsibility);
    if ((it.accountableOwner && own.managedMemberIds.has(it.accountableOwner)) || (it.operationalOwner && own.managedMemberIds.has(it.operationalOwner))) add("manages the owner", w.managedOwner);
    if (own.perms.has("work.approve") || own.perms.has("work.assign")) add("authority to act", w.authorityToAct);

    // objective / KPI
    if (it.objectiveId) add("linked objective", w.objectiveImportance);
    if (it.objectiveHealth && /risk|red|off|breach/i.test(it.objectiveHealth)) add("objective at risk", w.objectiveAtRisk);
    if (it.unresolved.includes("kpi_not_measured")) { it.explanation.missingOrStale.push("KPI not measured"); }
    else if (it.kpi) add("KPI at risk", w.kpiRisk / 2);

    // impact (only when present in real data)
    const at = (it as any); // impact fields live under attributes projected to fields when present
    if (it.customerRef) add("customer impact", w.customerImpact / 2);

    // urgency / deadline
    if (it.dueAt) {
      const h = hoursBetween(it.dueAt, now);
      if (h != null && Date.parse(it.dueAt) < now) add("overdue", w.urgencyOverdue);
      else if (h != null && Date.parse(it.dueAt) - now < 24 * 3.6e6) add("due soon", w.urgencyDueSoon);
    }
    // waiting / blocked age
    if (it.state === "waiting" || it.state === "blocked") {
      const h = hoursBetween(it.evidenceAgeHours != null ? new Date(now - it.evidenceAgeHours * 3.6e6).toISOString() : null, now);
      add(it.state === "blocked" ? "blocked" : "waiting", w.waitingAge + (it.state === "blocked" ? w.dependencyBlocked : 0));
    }
    // agent/automation failure
    if (it.agentActivity.some((a) => /fail|blocked|error/i.test(a.status))) add("automation failure", w.agentFailure);

    // freshness / confidence
    if (it.evidenceAgeHours != null && it.evidenceAgeHours > 24 * 7) { add("stale evidence", w.evidenceStalePenalty); it.explanation.missingOrStale.push("evidence >7d old"); }
    if (it.confidence != null && it.confidence < 0.4) add("low confidence", w.lowConfidencePenalty);

    // safety/compliance FLOOR — never buried behind revenue
    if (isSafety(it)) add("safety/compliance floor", w.safetyComplianceFloor);

    it.score = Math.round(score);
    it.explanation.factors = factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    it.explanation.whyHere = factors.slice(0, 3).map((f) => f.factor).join(", ") || "in your tenant's active work";
    it.explanation.whyYours = mine ? "you are accountable" : opMine ? "assigned to you" :
      (it.objectiveId && own.ownedObjectiveIds.has(it.objectiveId)) ? "serves an objective you own" :
      own.isLeadership ? "within your leadership remit" : "within your area";
    it.explanation.consequenceOfDelay = it.consequenceOfDelay ??
      (isSafety(it) ? "safety/compliance exposure" : it.objectiveHealth && /risk/i.test(it.objectiveHealth) ? "an at-risk objective slips further" : null);
    it.explanation.humanJudgement = (it.confidence != null && it.confidence < 0.5) || it.unresolved.length ? "confirm owner/objective/approval" : null;
    it.explanation.aiCanHandle = it.agentActivity.length ? "automation is engaged" : null;
    it.explanation.proofOfDone = it.doneWhen;
  }
  // stable sort: score desc, then earliest due, then oldest evidence, then id
  const sorted = items.slice().sort((a, b) =>
    b.score - a.score ||
    (Date.parse(a.dueAt ?? "9999") - Date.parse(b.dueAt ?? "9999")) ||
    ((b.evidenceAgeHours ?? 0) - (a.evidenceAgeHours ?? 0)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1];
    sorted[i].explanation.whyAboveNext = next
      ? `higher priority (${sorted[i].score}) than "${next.title}" (${next.score}) — ${sorted[i].explanation.factors[0]?.factor ?? "ranking"}`
      : null;
  }
  return sorted;
}
