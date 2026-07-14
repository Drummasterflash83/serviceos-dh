// Reference proof of the Objectives & Outcomes Engine. Run:
//   node supabase/functions/_shared/intelligence/objectives.verify.ts

import {
  evaluateObjectiveHealth,
  evaluateContribution,
  resolveObjectiveContext,
  verifyObjectiveLinks,
  areObjectiveReasonCodes,
} from "./objectives.ts";
import type {
  ExpectedContribution,
  MeasurementSnapshot,
  ObjectiveSnapshot,
  OutcomeSnapshot,
} from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const NOW = "2026-07-14T12:00:00Z"; // ~14% into the quarter Jul 1 → Sep 30
const Q = { startsAt: "2026-07-01T00:00:00Z", targetAt: "2026-09-30T00:00:00Z" };
const m = (
  metricKey: string,
  value: number | null,
  unit: string | null,
  measuredAt: string,
  extra: Partial<MeasurementSnapshot> = {},
): MeasurementSnapshot => ({
  metricKey,
  value,
  unit,
  currency: null,
  measuredAt,
  confidence: 0.8,
  ...extra,
});

// ── Two domains, identical evaluator, configuration only ────────────────────
const svc: ObjectiveSnapshot = {
  id: "obj-svc",
  objectiveType: "service_target",
  title: "Reduce response time",
  status: "active",
  primaryMetricKey: "response_time",
  direction: "decrease",
  baseline: { value: 6, unit: "hours", currency: null },
  target: { value: 2, unit: "hours", currency: null },
  ...Q,
  constraints: [],
  dependencies: [],
  staleAfterHours: 168,
};
const prod: ObjectiveSnapshot = {
  id: "obj-prod",
  objectiveType: "product_target",
  title: "Reduce stock-outs",
  status: "active",
  primaryMetricKey: "stock_out_rate",
  direction: "decrease",
  baseline: { value: 10, unit: "percent", currency: null },
  target: { value: 7, unit: "percent", currency: null },
  ...Q,
  constraints: [
    {
      key: "inventory_ceiling",
      kind: "hard",
      description: "inventory must not exceed the agreed ceiling",
      metricKey: "inventory_level",
      direction: "decrease",
      threshold: 1000,
      unit: "count",
    },
  ],
  dependencies: [],
  staleAfterHours: 168,
};

console.log("Determinism, purity, two domains:");
const before = JSON.stringify({ svc, prod });
const h1 = evaluateObjectiveHealth(
  svc,
  [m("response_time", 5, "hours", "2026-07-13T12:00:00Z")],
  NOW,
);
const h2 = evaluateObjectiveHealth(
  svc,
  [m("response_time", 5, "hours", "2026-07-13T12:00:00Z")],
  NOW,
);
check("1. deterministic (identical health)", JSON.stringify(h1) === JSON.stringify(h2));
check("21. no side effects (inputs unmutated)", JSON.stringify({ svc, prod }) === before);
const svcH = evaluateObjectiveHealth(
  svc,
  [m("response_time", 5, "hours", "2026-07-13T12:00:00Z")],
  NOW,
);
const prodH = evaluateObjectiveHealth(
  prod,
  [
    m("stock_out_rate", 8, "percent", "2026-07-13T12:00:00Z"),
    m("inventory_level", 900, "count", "2026-07-13T12:00:00Z"),
  ],
  NOW,
);
check(
  "2. ServiceOS + ProductOS use the SAME evaluator",
  svcH.status === "on_track" && prodH.status === "on_track",
  { svcH: svcH.status, prodH: prodH.status },
);

// ── Missing / stale / achieved / deteriorating / at-risk ────────────────────
console.log("Health states:");
check(
  "3. missing data ⇒ unknown (never healthy)",
  evaluateObjectiveHealth(svc, [], NOW).status === "unknown" &&
    evaluateObjectiveHealth(svc, [], NOW).reasons.includes("measurement_missing"),
);
const staleH = evaluateObjectiveHealth(
  svc,
  [m("response_time", 5, "hours", "2026-06-01T00:00:00Z")],
  NOW,
);
check(
  "4. stale primary data ⇒ unknown + reported",
  staleH.status === "unknown" &&
    staleH.reasons.includes("measurement_stale") &&
    staleH.staleMeasurements.includes("response_time"),
  staleH,
);
check(
  "5. achieved target ⇒ achieved",
  evaluateObjectiveHealth(svc, [m("response_time", 2, "hours", NOW)], NOW).status === "achieved",
);
const detr = evaluateObjectiveHealth(svc, [m("response_time", 7, "hours", NOW)], NOW);
check(
  "6a. deteriorating metric ⇒ off_track",
  detr.status === "off_track" && detr.reasons.includes("metric_deteriorating"),
  detr,
);
const risk = evaluateObjectiveHealth(svc, [m("response_time", 5.9, "hours", NOW)], NOW);
check("6b. behind plan (not deteriorating) ⇒ at_risk", risk.status === "at_risk", risk);

// ── Dependencies / constraints ──────────────────────────────────────────────
console.log("Dependencies & constraints:");
const child: ObjectiveSnapshot = {
  ...svc,
  id: "obj-child",
  dependencies: [{ id: "obj-parent", healthStatus: "off_track" }],
};
const blocked = evaluateObjectiveHealth(child, [m("response_time", 5, "hours", NOW)], NOW);
check(
  "7/12. blocked dependency (parent/child) ⇒ blocked",
  blocked.status === "blocked" && blocked.blockers.includes("obj-parent"),
  blocked,
);
const conViol = evaluateObjectiveHealth(
  prod,
  [m("stock_out_rate", 8, "percent", NOW), m("inventory_level", 1200, "count", NOW)],
  NOW,
);
check(
  "8. a hard constraint violation is surfaced and caps status",
  conViol.reasons.includes("constraint_violated") &&
    conViol.blockers.includes("inventory_ceiling") &&
    conViol.status === "off_track",
  conViol,
);

// ── Unit / currency safety ──────────────────────────────────────────────────
console.log("Unit / currency safety:");
const unitBad = evaluateObjectiveHealth(svc, [m("response_time", 120, "minutes", NOW)], NOW);
check(
  "9. incompatible units are NOT compared ⇒ unknown",
  unitBad.status === "unknown" && unitBad.reasons.includes("unit_mismatch"),
  unitBad,
);
const rev: ObjectiveSnapshot = {
  ...svc,
  primaryMetricKey: "revenue",
  direction: "increase",
  baseline: { value: 100, unit: "currency", currency: "GBP" },
  target: { value: 150, unit: "currency", currency: "GBP" },
};
const ccyBad = evaluateObjectiveHealth(
  rev,
  [
    {
      metricKey: "revenue",
      value: 120,
      unit: "currency",
      currency: "USD",
      measuredAt: NOW,
      confidence: 0.8,
    },
  ],
  NOW,
);
check(
  "10. unlike currencies are NOT compared ⇒ unknown",
  ccyBad.status === "unknown" && ccyBad.reasons.includes("currency_mismatch"),
  ccyBad,
);

// ── Qualitative milestone ───────────────────────────────────────────────────
console.log("Qualitative objectives:");
const mile: ObjectiveSnapshot = {
  ...svc,
  primaryMetricKey: "iso_certification",
  direction: "milestone",
  baseline: null,
  target: null,
};
check(
  "11a. milestone reached ⇒ achieved",
  evaluateObjectiveHealth(
    mile,
    [m("iso_certification", null, null, NOW, { milestoneReached: true })],
    NOW,
  ).status === "achieved",
);
check(
  "11b. milestone pending ⇒ on_track (qualitative supported)",
  evaluateObjectiveHealth(
    mile,
    [m("iso_certification", null, null, NOW, { milestoneReached: false })],
    NOW,
  ).status === "on_track",
);

// ── Contribution — honest attribution ───────────────────────────────────────
console.log("Contribution (honest attribution):");
const exp: ExpectedContribution = {
  objectiveId: "obj-svc",
  metricKey: "response_time",
  expectedDirection: "decrease",
  actionRef: "act-1",
};
check(
  "16. a link with no outcome does NOT claim impact ⇒ expected",
  evaluateContribution(exp, [], []).state === "expected",
);
const outcomes: OutcomeSnapshot[] = [
  { ref: "act-1", status: "complete", observedAt: "2026-07-10T00:00:00Z" },
];
const confirmed = evaluateContribution(exp, outcomes, [
  m("response_time", 6, "hours", "2026-07-05T00:00:00Z"),
  m("response_time", 4, "hours", "2026-07-13T00:00:00Z"),
]);
check(
  "17. outcome + before/after movement ⇒ contribution_confirmed",
  confirmed.state === "contribution_confirmed" && confirmed.observedMovement === -2,
  confirmed,
);
check(
  "18. outcome but no before/after evidence ⇒ inconclusive",
  evaluateContribution(exp, outcomes, []).state === "inconclusive",
);

// ── Provenance & verification (requirement 2) ───────────────────────────────
console.log("Objective-context provenance:");
const known = [
  { id: "obj-svc", tenantId: "t1", status: "active" },
  { id: "obj-draft", tenantId: "t1", status: "draft" },
  { id: "obj-other", tenantId: "t2", status: "active" },
];
const verified = verifyObjectiveLinks(
  [
    {
      objectiveId: "obj-svc",
      relation: "contributes_to",
      primary: true,
      source: "caller",
      constraintKeys: ["inventory_ceiling"],
    },
    { objectiveId: "obj-draft", relation: "supports", source: "caller" },
    { objectiveId: "obj-unknown", relation: "supports", source: "ai_inferred" },
    { objectiveId: "obj-other", relation: "supports", source: "caller" },
  ],
  known,
  "t1",
);
check(
  "22.1 same-tenant published objective ⇒ verified_published",
  verified.find((l) => l.objectiveId === "obj-svc")?.verificationState === "verified_published",
);
check(
  "22.2 unknown objective ⇒ proposed (not verified)",
  verified.find((l) => l.objectiveId === "obj-unknown")?.verificationState === "proposed",
);
check(
  "22.2b draft objective ⇒ inferred_unverified",
  verified.find((l) => l.objectiveId === "obj-draft")?.verificationState === "inferred_unverified",
);
check(
  "22.3 cross-tenant objective ⇒ rejected (dropped)",
  !verified.some((l) => l.objectiveId === "obj-other"),
);
const ctx = resolveObjectiveContext(verified);
check(
  "context exposes the VERIFIED subset only for value claims",
  ctx.verifiedObjectiveIds.length === 1 &&
    ctx.verifiedObjectiveIds[0] === "obj-svc" &&
    ctx.objectiveIds.length === 3 &&
    ctx.primaryObjectiveId === "obj-svc",
  ctx,
);
const unverConf = evaluateContribution({ ...exp, verified: false }, outcomes, [
  m("response_time", 6, "hours", "2026-07-05T00:00:00Z"),
  m("response_time", 4, "hours", "2026-07-13T00:00:00Z"),
]);
check(
  "22.4 an unverified link cannot create contribution_confirmed",
  unverConf.state !== "contribution_confirmed",
  unverConf,
);

// ── Reason codes are from the controlled registry ───────────────────────────
const allCodes = [svcH, prodH, staleH, detr, risk, blocked, conViol, unitBad, ccyBad].flatMap(
  (h) => h.reasons,
);
check(
  "reason codes are all registered",
  areObjectiveReasonCodes(allCodes),
  allCodes.filter((c) => !areObjectiveReasonCodes([c])),
);

console.log(failures === 0 ? "\nALL OBJECTIVES CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
