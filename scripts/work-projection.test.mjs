// Regression test — work-projection (the Command Centre's single work list).
// Pure + deterministic (Node strips TS types from the shared module). Proves:
//   • evidence folding: recommendations become evidence on the matching action, never a
//     second queue; call+email+job about one outcome = ONE item; unrelated stays separate;
//     ambiguous routes to review (never silently merged).
//   • explainable, role-aware ranking for the six roles; safety/compliance is never buried
//     behind revenue; ties are stable; every ranked item explains itself.
//
// Run:  node --experimental-strip-types scripts/work-projection.test.mjs
import { foldRecommendations, rankWork, collapseActions, DEFAULT_RANK_WEIGHTS } from "../supabase/functions/_shared/work_projection.ts";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };
const NOW = Date.parse("2026-07-22T09:00:00Z");
const W = DEFAULT_RANK_WEIGHTS;

// ── helpers ────────────────────────────────────────────────────────────────
const emptyExpl = () => ({ whyHere: "", whyYours: "", whyAboveNext: null, objective: null, kpi: null,
  consequenceOfDelay: null, recommends: null, aiCanHandle: null, humanJudgement: null, proofOfDone: null, missingOrStale: [], factors: [] });
function mk(id, o = {}) {
  return {
    id, title: o.title ?? id, outcome: null, state: o.state ?? "ready",
    accountableOwner: o.accountableOwner ?? null, operationalOwner: o.operationalOwner ?? null, assignee: null,
    team: null, role: null, objectiveId: o.objectiveId ?? null, objectiveTitle: null, kpi: o.kpi ?? null,
    objectiveHealth: o.objectiveHealth ?? null, priority: null, urgency: null, dueAt: o.dueAt ?? null,
    waitingOn: null, blocker: o.blocker ?? null, recommendedAction: null, consequenceOfDelay: null,
    doneWhen: o.doneWhen ?? null, completionEvidenceRequired: !!o.doneWhen, evidence: [], evidenceAgeHours: o.evidenceAgeHours ?? 1,
    confidence: o.confidence ?? null, customerRef: o.customerRef ?? null, jobRef: null, siteRef: null,
    relatedRecommendationIds: [], possibleDuplicateOf: [], agentActivity: o.agentActivity ?? [],
    score: 0, explanation: emptyExpl(), capabilityStatus: "LIVE", unresolved: o.unresolved ?? [],
  };
}
function own(o = {}) {
  return { userRef: o.userRef ?? "u", memberId: o.memberId ?? "m", authorityLevel: o.authorityLevel ?? "individual",
    isLeadership: !!o.isLeadership, ownedObjectiveIds: new Set(o.ownedObjectiveIds ?? []),
    responsibilityRefs: new Set(o.responsibilityRefs ?? []), teamOrgUnitIds: new Set(o.teamOrgUnitIds ?? []),
    managedMemberIds: new Set(o.managedMemberIds ?? []), perms: new Set(o.perms ?? []) };
}

// ═══ 1. Evidence folding ═════════════════════════════════════════════════════
const actionA = { id: "A", source_interactions: ["int-call-1"], source_entities: [], attributes: { customer_id: "cust-9", job_id: "job-7" } };
const actionB = { id: "B", source_interactions: ["int-x"], source_entities: [], attributes: { customer_id: "cust-2" } };
const recCall  = { id: "r-call",  interaction_id: "int-call-1", title: "Call: chase quote" };
const recEmail = { id: "r-email", person_id: "cust-9", title: "Email: customer replied" };          // same customer as A
const recJob   = { id: "r-job",   evidence: { job_id: "job-7" }, title: "Job update" };               // same job as A
const recOther = { id: "r-other", person_id: "cust-404", title: "Unrelated customer" };               // matches nothing
const recAmbig = { id: "r-amb",   person_id: "cust-9", evidence: {}, title: "ambiguous" };             // will match A and (below) A2 sharing cust-9

const links = new Map([["A", []], ["B", []]]);
let f = foldRecommendations([actionA, actionB], [recCall, recEmail, recJob, recOther], links);
ok((f.evidenceByAction.get("A") ?? []).length === 3, "call+email+job all fold onto ONE action (A) → one item, not three");
ok(!f.evidenceByAction.has("B"), "action B gets no unrelated evidence");
ok(f.standaloneRecs.length === 1 && f.standaloneRecs[0].id === "r-other", "unrelated recommendation stays separate");
ok(f.reviewRecs.length === 0, "no false ambiguity when each rec matches ≤1 action");

// ambiguity: two actions share the same customer key → an ambiguous rec routes to review
const actionA2 = { id: "A2", source_interactions: [], source_entities: [], attributes: { customer_id: "cust-9" } };
f = foldRecommendations([actionA, actionA2], [recAmbig], new Map([["A", []], ["A2", []]]));
ok(f.reviewRecs.length === 1 && f.reviewRecs[0].candidateActionIds.length === 2, "ambiguous rec (matches 2 actions) routes to REVIEW, not silently merged");
ok((f.evidenceByAction.get("A") ?? []).length === 0, "ambiguous rec is NOT attached as evidence to either candidate");

// ═══ 2. Role-aware ranking ═══════════════════════════════════════════════════
const items = () => [
  mk("SAFETY", { title: "H&S gate: RAMS missing before site work", customerRef: "cust-1" }),
  mk("OPS_RISK", { title: "Further Works SLA breach", objectiveId: "obj-margin", objectiveHealth: "at_risk", operationalOwner: "ops-m", customerRef: "cust-3" }),
  mk("FIN", { title: "GP exception on invoice", operationalOwner: "fin-m", customerRef: "cust-5", kpi: "gross_margin" }),
  mk("ENG_DUE", { title: "Boiler service due today", operationalOwner: "eng-m", dueAt: "2026-07-22T15:00:00Z" }),
  mk("REVENUE", { title: "Upsell opportunity", customerRef: "cust-9" }),
];

// Leadership: safety must be #1 despite revenue existing
let ranked = rankWork(items(), own({ isLeadership: true, authorityLevel: "owner", perms: ["work.approve", "work.assign"] }), W, NOW);
ok(ranked[0].id === "SAFETY", "SAFETY ranks #1 for leadership (safety floor, never buried behind revenue)");
ok(ranked[0].score > ranked.find((x) => x.id === "REVENUE").score, "safety outranks revenue");

// Engineer: their due-today assigned job is top among NON-safety work
ranked = rankWork(items(), own({ memberId: "eng-m", authorityLevel: "individual" }), W, NOW);
const engTopNonSafety = ranked.filter((x) => x.id !== "SAFETY")[0];
ok(engTopNonSafety.id === "ENG_DUE", "engineer's assigned, due-today job is top non-safety item");
ok(engTopNonSafety.explanation.whyYours === "assigned to you", "engineer explanation: assigned to you");

// Finance: their owned GP exception outranks ops item for them
ranked = rankWork(items(), own({ memberId: "fin-m", authorityLevel: "manager" }), W, NOW);
ok(ranked.findIndex((x) => x.id === "FIN") < ranked.findIndex((x) => x.id === "OPS_RISK"), "finance: owned GP exception outranks unowned ops item");

// Ops: owns the margin objective → OPS_RISK (assigned + objective at risk) tops non-safety
ranked = rankWork(items(), own({ memberId: "ops-m", ownedObjectiveIds: ["obj-margin"], authorityLevel: "manager" }), W, NOW);
ok(ranked.filter((x) => x.id !== "SAFETY")[0].id === "OPS_RISK", "ops: assigned at-risk-objective item tops non-safety");

// Explanation completeness on the top item
ok(ranked[0].explanation.whyHere && ranked[0].explanation.whyYours && ranked[0].explanation.factors.length > 0, "top item explains why-here / why-yours / factors");
ok(ranked.slice(0, -1).every((x) => x.explanation.whyAboveNext), "every non-last item explains why it ranks above the next");

// ═══ 3. Stable ties ══════════════════════════════════════════════════════════
const tie = [mk("zeta", { dueAt: "2026-07-25T00:00:00Z" }), mk("alpha", { dueAt: "2026-07-25T00:00:00Z" })];
const r1 = rankWork(tie, own(), W, NOW).map((x) => x.id).join(",");
const r2 = rankWork(tie.slice().reverse(), own(), W, NOW).map((x) => x.id).join(",");
ok(r1 === r2, `equal scores tie-break deterministically (${r1})`);

// ═══ 4. collapse + verification filter (data-provenance guards) ══════════════
const raw = [
  { id: "v1", subject: "verification controlled action", attributes: { verification: true } },
  { id: "n1", subject: "Record a controlled internal note", attributes: {}, updated_at: "2026-07-22T10:00:00Z" },
  { id: "n2", subject: "Record a controlled internal note", attributes: {}, updated_at: "2026-07-22T11:00:00Z" },
  { id: "n3", subject: "Record a controlled internal note", attributes: {}, updated_at: "2026-07-22T12:00:00Z" },
  { id: "owned", subject: "Chase overdue invoice", attributes: {}, accountable_ref: { kind: "user", ref: "elaine" } },
];
const out = collapseActions(raw);
ok(!out.some((a) => a.id.startsWith("v")), "collapse: verification=true artifact excluded");
const note = out.find((a) => a.subject === "Record a controlled internal note");
ok(out.filter((a) => a.subject === "Record a controlled internal note").length === 1, "collapse: 3 identical unowned notes → ONE representative");
ok(note?._collapsedCount === 3, "collapse: representative carries _collapsedCount=3");
ok(note?.id === "n3", "collapse: representative is the most recent (n3)");
ok(out.some((a) => a.id === "owned"), "collapse: owned action passes through individually (never merged)");

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
