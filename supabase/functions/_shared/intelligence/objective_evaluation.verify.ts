// Reference proof of the pure Objective Evaluation orchestration. Run:
//   node supabase/functions/_shared/intelligence/objective_evaluation.verify.ts
//
// These fixtures include the controlled verification slice (baseline 6h → target
// 2h, current 4.5h) ONLY as a test input — never as a published strategic claim.

import {
  OBJECTIVE_EVALUATOR_VERSION,
  OBJECTIVE_EVENT_TYPES,
  SUPPORTED_OUTCOME_EVIDENCE_TYPES,
  buildObjectiveInputHash,
  diffObjectiveHealth,
  enforceContributionEvidenceBoundary,
  evaluateNormalized,
  hasImmutableOutcomeEvidence,
  normalizeEvaluationInput,
  planContributions,
  planObjectiveEvents,
  shouldEnqueueParent,
  type ContributionCandidate,
  type LoadedConstraint,
  type LoadedMeasurementRow,
  type LoadedMetricDef,
  type LoadedObjectiveMetric,
  type LoadedObjectiveRow,
  type OutcomeEvidenceRef,
} from "./objective_evaluation.ts";
import { evaluateContribution, evaluateObjectiveHealth } from "./objectives.ts";
import type { MeasurementSnapshot } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const NOW = "2026-08-15T12:00:00Z"; // ~half-way through Jul 1 → Sep 30
const OBJ_VERSION = "40000000-0000-0000-0000-000000000001";

const objective: LoadedObjectiveRow = {
  id: "1295f92c-6204-4c08-8ba5-e29fb2097ef6",
  objective_type: "service_target",
  title: "Reduce response time",
  status: "active",
  parent_objective_id: null,
  starts_at: "2026-07-01T00:00:00Z",
  target_at: "2026-09-30T00:00:00Z",
  stale_after_hours: 168,
  version_id: OBJ_VERSION,
};
const metricDefs: LoadedMetricDef[] = [
  {
    id: "b341661b-91c1-4a9f-b735-bc1e649888a8",
    key: "response_time",
    unit: "hours",
    currency: null,
    direction: "decrease",
  },
];
const objectiveMetrics: LoadedObjectiveMetric[] = [
  {
    metric_id: "b341661b-91c1-4a9f-b735-bc1e649888a8",
    role: "primary",
    direction: "decrease",
    baseline_value: 6,
    baseline_unit: "hours",
    baseline_currency: null,
    target_value: 2,
    target_unit: "hours",
    target_currency: null,
    target_range_min: null,
    target_range_max: null,
    weight: 1,
  },
];
const constraints: LoadedConstraint[] = [];
const measRow = (id: string, value: number, measuredAt: string): LoadedMeasurementRow => ({
  id,
  metric_id: "b341661b-91c1-4a9f-b735-bc1e649888a8",
  value,
  unit: "hours",
  currency: null,
  measured_at: measuredAt,
  source: "verification",
  confidence: 0.9,
  freshness: null,
  milestone_reached: null,
});

// ── Normalisation + the live verification slice ─────────────────────────────
console.log("Normalisation + live slice (6h → 2h, current 4.5h):");
const input = normalizeEvaluationInput({
  objective,
  objectiveMetrics,
  metricDefs,
  constraints,
  dependencies: [],
  measurements: [measRow("43000000-0000-0000-0000-000000000001", 4.5, NOW)],
});
check("primary metric key resolved from metric id", input.primaryMetricKey === "response_time");
check("selected evidence pins the one latest measurement", input.selected.length === 1);
check("objective version id carried for the hash", input.objectiveVersionId === OBJ_VERSION);

const health = evaluateNormalized(input, NOW);
check(
  "10. baseline 6, current 4.5, target 2 ⇒ progress 0.375",
  health.progress === 0.375,
  health.progress,
);
check(
  "status is a real health status (time-aware)",
  ["on_track", "at_risk", "off_track"].includes(health.status),
  health.status,
);
check(
  "evaluateNormalized == direct evaluateObjectiveHealth (no duplicated formula)",
  JSON.stringify(health) ===
    JSON.stringify(evaluateObjectiveHealth(input.objective, input.measurements, NOW)),
);

// ── Missing data ⇒ unknown (never healthy) ──────────────────────────────────
const noData = normalizeEvaluationInput({
  objective,
  objectiveMetrics,
  metricDefs,
  constraints,
  dependencies: [],
  measurements: [],
});
check("6. missing data ⇒ unknown", evaluateNormalized(noData, NOW).status === "unknown");

// ── Input hash: determinism + sensitivity ───────────────────────────────────
console.log("Input hash — determinism & sensitivity:");
const hashArgs = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  objectiveId: objective.id,
  objectiveVersionId: input.objectiveVersionId,
  objectiveMetrics,
  constraints,
  selected: input.selected,
  dependencies: [] as { id: string; healthStatus: string }[],
};
const h1 = buildObjectiveInputHash(hashArgs);
const h2 = buildObjectiveInputHash({ ...hashArgs });
check("2. same inputs ⇒ same hash (retry is idempotent)", h1 === h2, { h1, h2 });

const newerInput = normalizeEvaluationInput({
  objective,
  objectiveMetrics,
  metricDefs,
  constraints,
  dependencies: [],
  measurements: [measRow("43000000-0000-0000-0000-0000000000ff", 4.5, "2026-08-20T12:00:00Z")],
});
check(
  "3. changed measurement ⇒ different hash (new snapshot)",
  buildObjectiveInputHash({ ...hashArgs, selected: newerInput.selected }) !== h1,
);
check(
  "4. changed objective version ⇒ different hash",
  buildObjectiveInputHash({
    ...hashArgs,
    objectiveVersionId: "40000000-0000-0000-0000-000000000002",
  }) !== h1,
);
check(
  "5. changed constraint ⇒ different hash",
  buildObjectiveInputHash({
    ...hashArgs,
    constraints: [
      {
        key: "budget",
        kind: "hard",
        description: "x",
        metric_id: null,
        direction: "decrease",
        threshold: 10,
        unit: null,
        version_id: null,
      },
    ],
  }) !== h1,
);
check(
  "changed dependency state ⇒ different hash",
  buildObjectiveInputHash({
    ...hashArgs,
    dependencies: [{ id: "d1", healthStatus: "off_track" }],
  }) !== h1,
);
check(
  "force nonce ⇒ different hash (explicit fresh audit identity)",
  buildObjectiveInputHash({ ...hashArgs, nonce: "manual-1" }) !== h1,
);
check(
  "evaluator version participates in the hash",
  buildObjectiveInputHash({ ...hashArgs, evaluatorVersion: "obj-health@99" }) !== h1,
);
check(
  "new time bucket ⇒ different hash (fresh snapshot on cadence)",
  buildObjectiveInputHash({ ...hashArgs, timeBucket: "2026-08-16" }) !==
    buildObjectiveInputHash({ ...hashArgs, timeBucket: "2026-08-15" }),
);

// ── Diff + event planning (no storms) ───────────────────────────────────────
console.log("Diff + event planning:");
const first = evaluateNormalized(input, NOW);
const changeFirst = diffObjectiveHealth(null, first);
check("first evaluation is a status change vs no prior", changeFirst.statusChanged === true);
const evFirst = planObjectiveEvents({
  objectiveId: objective.id,
  snapshotId: "snap-1",
  health: first,
  change: changeFirst,
});
check(
  "16. first snapshot emits evaluated + changed",
  evFirst.some((e) => e.type === "objective.health.evaluated") &&
    evFirst.some((e) => e.type === "objective.health.changed"),
);

const same = diffObjectiveHealth(
  {
    status: first.status,
    progress: first.progress,
    confidence: first.confidence,
    staleMeasurements: [],
    blockers: [],
  },
  first,
);
const evSame = planObjectiveEvents({
  objectiveId: objective.id,
  snapshotId: "snap-2",
  health: first,
  change: same,
});
check(
  "17. unchanged status ⇒ ONLY evaluated (no change-storm)",
  evSame.length === 1 && evSame[0].type === "objective.health.evaluated",
  evSame.map((e) => e.type),
);

// deterioration ⇒ off_track transition emits the specific event
const detr = evaluateNormalized(
  normalizeEvaluationInput({
    objective,
    objectiveMetrics,
    metricDefs,
    constraints,
    dependencies: [],
    measurements: [measRow("m-detr", 7, NOW)],
  }),
  NOW,
);
const changeDetr = diffObjectiveHealth(
  { status: "on_track", progress: 0.5, confidence: 0.9, staleMeasurements: [], blockers: [] },
  detr,
);
const evDetr = planObjectiveEvents({
  objectiveId: objective.id,
  snapshotId: "snap-3",
  health: detr,
  change: changeDetr,
});
check(
  "12. deterioration ⇒ off_track + specific event",
  detr.status === "off_track" && evDetr.some((e) => e.type === "objective.off_track"),
  { status: detr.status, events: evDetr.map((e) => e.type) },
);

// newly stale surfaces exactly once
const staleChange = diffObjectiveHealth(
  { status: "on_track", progress: 0.5, confidence: 0.9, staleMeasurements: [], blockers: [] },
  { ...first, staleMeasurements: ["response_time"] },
);
check("7. newly stale is detected", staleChange.newlyStale.includes("response_time"));
const evStale = planObjectiveEvents({
  objectiveId: objective.id,
  snapshotId: "snap-4",
  health: { ...first, staleMeasurements: ["response_time"] },
  change: staleChange,
});
check(
  "stale event emitted when newly stale",
  evStale.some((e) => e.type === "objective.measurement.stale"),
);

// ── Event names all from the controlled set ─────────────────────────────────
const allTypes = [...evFirst, ...evSame, ...evDetr, ...evStale].map((e) => e.type);
check(
  "all planned events are in the controlled registry",
  allTypes.every((t) => (OBJECTIVE_EVENT_TYPES as readonly string[]).includes(t)),
  allTypes,
);

// ── Parent enqueue is gated on a real status change + a parent ───────────────
check(
  "23. parent enqueue only on change + parent present",
  shouldEnqueueParent(changeDetr, "parent-1") === true &&
    shouldEnqueueParent(same, "parent-1") === false &&
    shouldEnqueueParent(changeDetr, null) === false,
);

check("evaluator version constant is stable", OBJECTIVE_EVALUATOR_VERSION === "obj-health@1");

// ── Contribution integrity boundary (v1: confirmation impossible) ───────────
console.log("Contribution integrity (v1 — no first-class Outcomes layer):");
const cm = (value: number, measuredAt: string): MeasurementSnapshot => ({
  metricKey: "response_time",
  value,
  unit: "hours",
  currency: null,
  measuredAt,
  confidence: 0.8,
});
// A raw assessment that WOULD confirm (verified link + matching before/after movement).
const wouldConfirm = evaluateContribution(
  { objectiveId: "o", metricKey: "response_time", expectedDirection: "decrease", verified: true },
  [{ ref: "outcome-1", status: "complete", observedAt: "2026-08-10T00:00:00Z" }],
  [cm(6, "2026-08-05T00:00:00Z"), cm(4, "2026-08-12T00:00:00Z")],
);
check(
  "v1 sanity: raw evaluator CAN reach contribution_confirmed",
  wouldConfirm.state === "contribution_confirmed",
  wouldConfirm.state,
);
check(
  "no supported immutable outcome-evidence type exists in v1",
  SUPPORTED_OUTCOME_EVIDENCE_TYPES.length === 0 && hasImmutableOutcomeEvidence([]) === false,
);
// 1 & 2. approved link / completed work + metric improvement does NOT confirm.
check(
  "1/2. would-be confirmation WITHOUT immutable evidence ⇒ inconclusive (not confirmed)",
  enforceContributionEvidenceBoundary(wouldConfirm, []).state === "inconclusive",
  enforceContributionEvidenceBoundary(wouldConfirm, []),
);
// A hypothetical unsupported evidence ref must not unlock confirmation either.
const unsupported: OutcomeEvidenceRef[] = [
  { type: "objective_link", ref: "l1", observedAt: "2026-08-10T00:00:00Z" },
];
check(
  "unsupported evidence type never confirms",
  enforceContributionEvidenceBoundary(wouldConfirm, unsupported).state === "inconclusive",
);
// 3. unverified links never confirm.
const unverified = evaluateContribution(
  { objectiveId: "o", metricKey: "response_time", expectedDirection: "decrease", verified: false },
  [{ ref: "outcome-1", status: "complete", observedAt: "2026-08-10T00:00:00Z" }],
  [cm(6, "2026-08-05T00:00:00Z"), cm(4, "2026-08-12T00:00:00Z")],
);
check(
  "3. unverified link never confirms",
  unverified.state !== "contribution_confirmed" &&
    enforceContributionEvidenceBoundary(unverified, []).state !== "contribution_confirmed",
  unverified.state,
);
// 4. missing outcome evidence ⇒ inconclusive (the boundary is the choke point).
const candidates: ContributionCandidate[] = [
  {
    linkId: "link-1",
    expected: {
      objectiveId: "o",
      metricKey: "response_time",
      expectedDirection: "decrease",
      verified: true,
    },
  },
];
const plannedNoEvidence = planContributions(
  candidates,
  [],
  [cm(6, "2026-08-05T00:00:00Z"), cm(4, "2026-08-12T00:00:00Z")],
);
check(
  "4. verified expected link, NO immutable evidence ⇒ expected (never confirmed)",
  plannedNoEvidence.length === 1 &&
    plannedNoEvidence[0].assessment.state === "expected" &&
    plannedNoEvidence.every((p) => p.assessment.state !== "contribution_confirmed"),
  plannedNoEvidence.map((p) => p.assessment.state),
);
// 5. the live health slice (no links) ⇒ ZERO confirmed contributions.
const liveSliceContribs = planContributions([], [], input.measurements);
check(
  "5. live slice (no candidate links) ⇒ zero contributions, zero confirmed",
  liveSliceContribs.length === 0,
);
check(
  "no planContributions path yields contribution_confirmed in v1",
  [...plannedNoEvidence, ...liveSliceContribs].every(
    (p) => p.assessment.state !== "contribution_confirmed",
  ),
);

// ── UTC-day bucket: a target-date transition WITHOUT a new measurement ───────
console.log("UTC-day bucket — time-only transition:");
const fresh = measRow("m-fresh", 4.5, "2026-09-29T12:00:00Z"); // fresh vs both evaluations
const beforeTarget = normalizeEvaluationInput({
  objective,
  objectiveMetrics,
  metricDefs,
  constraints,
  dependencies: [],
  measurements: [fresh],
});
const hBefore = evaluateNormalized(beforeTarget, "2026-09-29T13:00:00Z"); // before target_at
const hAfter = evaluateNormalized(beforeTarget, "2026-09-30T13:00:00Z"); // past target_at, same measurement
check(
  "target-date transition captured WITHOUT a new measurement (same rows, later day)",
  hBefore.status !== "missed" && hAfter.status === "missed",
  { before: hBefore.status, after: hAfter.status },
);
const bucketArgs = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  objectiveId: objective.id,
  objectiveVersionId: beforeTarget.objectiveVersionId,
  objectiveMetrics,
  constraints,
  selected: beforeTarget.selected,
  dependencies: [] as { id: string; healthStatus: string }[],
};
check(
  "same day + same inputs ⇒ same hash; next day ⇒ different hash",
  buildObjectiveInputHash({ ...bucketArgs, timeBucket: "2026-09-29" }) ===
    buildObjectiveInputHash({ ...bucketArgs, timeBucket: "2026-09-29" }) &&
    buildObjectiveInputHash({ ...bucketArgs, timeBucket: "2026-09-29" }) !==
      buildObjectiveInputHash({ ...bucketArgs, timeBucket: "2026-09-30" }),
);

console.log(
  failures === 0 ? "\nALL OBJECTIVE-EVALUATION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
