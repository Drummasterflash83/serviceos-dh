// Objective Evaluation — pure orchestration for the Objective Evaluation Worker.
//
// This module is the PURE, deterministic bridge between raw (already-loaded)
// database rows and the Objective Health / Contribution evaluators in
// `objectives.ts`. It NEVER duplicates the health formula — it normalises loaded
// rows into the evaluator's snapshot shape, chooses which measurements are in
// scope, derives the deterministic evaluation identity (input hash), diffs one
// snapshot against the previous one, and plans which events a change warrants.
//
// It holds NO database, client, event, clock or automation primitive and NO
// domain literals — the impure shell (worker_handlers/objective_evaluate.ts) does
// all I/O and passes plain objects in. Same guarantees as the rest of the core
// engine (conformance gates G1–G4).

import { evaluateContribution, evaluateObjectiveHealth } from "./objectives.ts";
import { stableHash } from "./policy.ts";
import type {
  ContributionAssessment,
  ExpectedContribution,
  MeasurementSnapshot,
  MetricDirection,
  ObjectiveConstraint,
  ObjectiveHealth,
  ObjectiveHealthStatus,
  ObjectiveSnapshot,
  OutcomeSnapshot,
} from "./types.ts";

/** Bump when the health/normalisation contract changes — part of the input hash,
 *  so a re-evaluation under a new evaluator appends a NEW snapshot. */
export const OBJECTIVE_EVALUATOR_VERSION = "obj-health@1";

/** The controlled set of events this worker may emit. The impure handler emits
 *  ONLY from this set; the conformance gate enforces it (no ad-hoc event names).
 *  Mirrors the seeded `objective_event_types` registry. */
export const OBJECTIVE_EVENT_TYPES = [
  "objective.health.evaluated",
  "objective.health.changed",
  "objective.at_risk",
  "objective.off_track",
  "objective.blocked",
  "objective.achieved",
  "objective.measurement.stale",
  "objective.contribution.assessed",
] as const;
export type ObjectiveEventType = (typeof OBJECTIVE_EVENT_TYPES)[number];

// ── Loaded-row shapes (what the impure handler reads from the DB and passes in).
// Plain data — deliberately NOT Supabase rows, so this stays pure and testable.

export interface LoadedObjectiveRow {
  id: string;
  objective_type: string;
  title: string;
  status: string; // lifecycle (draft|active|…), NOT health
  parent_objective_id: string | null;
  starts_at: string | null;
  target_at: string | null;
  stale_after_hours: number | null;
  version_id: string;
}

export interface LoadedMetricDef {
  id: string;
  key: string;
  unit: string | null;
  currency: string | null;
  direction: string | null;
}

export interface LoadedObjectiveMetric {
  metric_id: string;
  role: string; // 'primary' | 'supporting' | 'constraint'
  direction: string;
  baseline_value: number | null;
  baseline_unit: string | null;
  baseline_currency: string | null;
  target_value: number | null;
  target_unit: string | null;
  target_currency: string | null;
  target_range_min: number | null;
  target_range_max: number | null;
  weight: number | null;
}

export interface LoadedConstraint {
  key: string;
  kind: string; // 'hard' | 'soft' | 'guardrail'
  description: string;
  metric_id: string | null;
  direction: string | null;
  threshold: number | null;
  unit: string | null;
  version_id: string | null;
}

export interface LoadedMeasurementRow {
  id: string;
  metric_id: string;
  value: number | null;
  unit: string | null;
  currency: string | null;
  measured_at: string;
  source: string | null;
  confidence: number | null;
  freshness: string | null;
  milestone_reached: boolean | null;
}

export interface LoadedDependency {
  id: string;
  healthStatus: string;
}

/** A measurement carried with its DB id, so evidence/hash can reference the exact
 *  rows the evaluator saw. Structurally a MeasurementSnapshot (+id). */
export interface MeasurementInput extends MeasurementSnapshot {
  id: string;
}

/** The exact measurement rows selected as the latest-in-scope per metric — the
 *  evidence the health snapshot pins to (ids + timestamps + values only). */
export interface MeasurementRef {
  id: string;
  metricKey: string;
  measuredAt: string;
  value: number | null;
}

export interface NormalizedEvaluationInput {
  objective: ObjectiveSnapshot;
  /** Every in-scope measurement (primary + supporting + constraint metrics). The
   *  evaluator re-derives the latest per metric and its own stale set. */
  measurements: MeasurementInput[];
  /** The latest measurement per in-scope metric — for the input hash + evidence. */
  selected: MeasurementRef[];
  objectiveVersionId: string;
  primaryMetricKey: string | null;
}

function asDirection(d: string | null | undefined): MetricDirection {
  // Fall back to a safe numeric direction; the evaluator returns unknown when the
  // definition is insufficient, so this never fabricates a healthy reading.
  return (d ?? "increase") as MetricDirection;
}

function byMeasuredAtDesc(a: { measured_at: string }, b: { measured_at: string }): number {
  const ta = Date.parse(a.measured_at);
  const tb = Date.parse(b.measured_at);
  return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
}

/**
 * Normalise loaded rows into the pure evaluator's snapshot shape. Deterministic:
 * given the same rows it always produces the same objective + measurement set.
 * Metric IDs are resolved to metric KEYS (what the evaluator matches on). The
 * primary objective-metric drives baseline/target/direction; constraints and
 * supporting metrics are included so guardrails can cap and stale supporting data
 * can lower confidence — exactly as the evaluator already models.
 */
export function normalizeEvaluationInput(params: {
  objective: LoadedObjectiveRow;
  objectiveMetrics: LoadedObjectiveMetric[];
  metricDefs: LoadedMetricDef[];
  constraints: LoadedConstraint[];
  dependencies: LoadedDependency[];
  measurements: LoadedMeasurementRow[];
}): NormalizedEvaluationInput {
  const { objective, objectiveMetrics, metricDefs, constraints, dependencies, measurements } =
    params;
  const keyOf = new Map(metricDefs.map((d) => [d.id, d.key] as const));

  const primary = objectiveMetrics.find((m) => m.role === "primary") ?? objectiveMetrics[0] ?? null;
  const primaryMetricKey = primary ? (keyOf.get(primary.metric_id) ?? null) : null;

  const baseline = primary
    ? {
        value: primary.baseline_value,
        unit: primary.baseline_unit,
        currency: primary.baseline_currency,
      }
    : null;
  const target = primary
    ? {
        value: primary.target_value,
        unit: primary.target_unit,
        currency: primary.target_currency,
        rangeMin: primary.target_range_min,
        rangeMax: primary.target_range_max,
      }
    : null;

  const objConstraints: ObjectiveConstraint[] = constraints.map((c) => ({
    key: c.key,
    kind: (c.kind as ObjectiveConstraint["kind"]) ?? "soft",
    description: c.description,
    metricKey: c.metric_id ? (keyOf.get(c.metric_id) ?? null) : null,
    direction: c.direction ? asDirection(c.direction) : null,
    threshold: c.threshold,
    unit: c.unit,
  }));

  // In-scope metric ids: every objective-metric (any role) + every constraint metric.
  const scopeIds = new Set<string>();
  for (const m of objectiveMetrics) scopeIds.add(m.metric_id);
  for (const c of constraints) if (c.metric_id) scopeIds.add(c.metric_id);

  const inScope = measurements.filter((m) => scopeIds.has(m.metric_id));
  const measurementInputs: MeasurementInput[] = inScope.map((m) => ({
    id: m.id,
    metricKey: keyOf.get(m.metric_id) ?? m.metric_id,
    value: m.value,
    unit: m.unit,
    currency: m.currency,
    measuredAt: m.measured_at,
    source: m.source,
    confidence: m.confidence,
    milestoneReached: m.milestone_reached,
  }));

  // Latest measurement per in-scope metric id → evidence + hash identity.
  const latestByMetric = new Map<string, LoadedMeasurementRow>();
  for (const m of [...inScope].sort(byMeasuredAtDesc)) {
    if (!latestByMetric.has(m.metric_id)) latestByMetric.set(m.metric_id, m);
  }
  const selected: MeasurementRef[] = [...latestByMetric.values()]
    .map((m) => ({
      id: m.id,
      metricKey: keyOf.get(m.metric_id) ?? m.metric_id,
      measuredAt: m.measured_at,
      value: m.value,
    }))
    .sort((a, b) => (a.metricKey < b.metricKey ? -1 : a.metricKey > b.metricKey ? 1 : 0));

  const snapshot: ObjectiveSnapshot = {
    id: objective.id,
    objectiveType: objective.objective_type,
    title: objective.title,
    status: objective.status,
    primaryMetricKey,
    direction: asDirection(primary?.direction),
    baseline: baseline && (baseline.value !== null || baseline.unit !== null) ? baseline : null,
    target: target && (target.value !== null || target.rangeMin != null) ? target : null,
    startsAt: objective.starts_at,
    targetAt: objective.target_at,
    constraints: objConstraints,
    dependencies: [...dependencies].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    staleAfterHours: objective.stale_after_hours,
  };

  return {
    objective: snapshot,
    measurements: measurementInputs,
    selected,
    objectiveVersionId: objective.version_id,
    primaryMetricKey,
  };
}

/**
 * Deterministic evaluation identity. Same objective version + same latest
 * measurements + same constraints + same dependency state + same evaluator ⇒ same
 * hash ⇒ the DB idempotency index collapses a retry to the SAME logical snapshot.
 * A changed measurement/version/constraint/dependency changes the hash ⇒ a NEW
 * snapshot. `nonce` (force/backfill) deliberately mints a fresh audit identity.
 * NEVER include `now()` — the whole point is replayability.
 */
export function buildObjectiveInputHash(params: {
  tenantId: string;
  objectiveId: string;
  objectiveVersionId: string;
  objectiveMetrics: LoadedObjectiveMetric[];
  constraints: LoadedConstraint[];
  selected: MeasurementRef[];
  dependencies: LoadedDependency[];
  evaluatorVersion?: string;
  /** Coarse evaluation-time bucket (e.g. the UTC day of `now`). Included so that
   *  time-AWARE status (crossing target_at, plan-vs-elapsed) can yield a fresh
   *  snapshot on a new bucket, while a same-bucket retry stays idempotent. Never
   *  the raw clock — that would defeat replayability. */
  timeBucket?: string | null;
  nonce?: string | null;
}): string {
  const metricSpec = [...params.objectiveMetrics]
    .map((m) => ({
      metricId: m.metric_id,
      role: m.role,
      direction: m.direction,
      baseline: m.baseline_value,
      baselineUnit: m.baseline_unit,
      baselineCurrency: m.baseline_currency,
      target: m.target_value,
      targetUnit: m.target_unit,
      targetCurrency: m.target_currency,
      rangeMin: m.target_range_min,
      rangeMax: m.target_range_max,
      weight: m.weight,
    }))
    .sort((a, b) =>
      `${a.metricId}:${a.role}` < `${b.metricId}:${b.role}`
        ? -1
        : `${a.metricId}:${a.role}` > `${b.metricId}:${b.role}`
          ? 1
          : 0,
    );

  const constraintSpec = [...params.constraints]
    .map((c) => ({
      key: c.key,
      kind: c.kind,
      metricId: c.metric_id,
      direction: c.direction,
      threshold: c.threshold,
      versionId: c.version_id,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const measurementSpec = [...params.selected]
    .map((m) => ({ id: m.id, metricKey: m.metricKey, measuredAt: m.measuredAt, value: m.value }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const dependencySpec = [...params.dependencies]
    .map((d) => ({ id: d.id, healthStatus: d.healthStatus }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Fixed key order + sorted arrays ⇒ stableHash (JSON.stringify + djb2) is stable.
  return stableHash({
    v: params.evaluatorVersion ?? OBJECTIVE_EVALUATOR_VERSION,
    tenantId: params.tenantId,
    objectiveId: params.objectiveId,
    objectiveVersionId: params.objectiveVersionId,
    metricSpec,
    constraintSpec,
    measurementSpec,
    dependencySpec,
    timeBucket: params.timeBucket ?? null,
    nonce: params.nonce ?? null,
  });
}

/** The UTC-day bucket for a timestamp — the default evaluation cadence bucket. */
export function utcDayBucket(now: string): string {
  const t = new Date(now);
  return Number.isNaN(t.getTime()) ? "epoch" : t.toISOString().slice(0, 10);
}

/** Run the pure evaluator over a normalised input. Thin, single call site — the
 *  formula lives ONLY in evaluateObjectiveHealth. */
export function evaluateNormalized(input: NormalizedEvaluationInput, now: string): ObjectiveHealth {
  return evaluateObjectiveHealth(input.objective, input.measurements, now);
}

// ── Snapshot diff + event planning ──────────────────────────────────────────

export interface PriorHealth {
  status: string;
  progress: number | null;
  confidence: number | null;
  staleMeasurements: string[];
  blockers: string[];
}

export interface HealthChange {
  statusChanged: boolean;
  previousStatus: string | null;
  newStatus: ObjectiveHealthStatus;
  progressDelta: number | null;
  confidenceDelta: number | null;
  newlyStale: string[];
  resolvedStale: string[];
  newBlockers: string[];
  resolvedBlockers: string[];
}

function diffSets(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const p = new Set(prev);
  const n = new Set(next);
  return {
    added: next.filter((x) => !p.has(x)).sort(),
    removed: prev.filter((x) => !n.has(x)).sort(),
  };
}

/** Compare a new health reading to the previous snapshot (for events + audit).
 *  Descriptive only — never mutates the previous snapshot. */
export function diffObjectiveHealth(prev: PriorHealth | null, next: ObjectiveHealth): HealthChange {
  const stale = diffSets(prev?.staleMeasurements ?? [], next.staleMeasurements);
  const blocked = diffSets(prev?.blockers ?? [], next.blockers);
  return {
    statusChanged: (prev?.status ?? null) !== next.status,
    previousStatus: prev?.status ?? null,
    newStatus: next.status,
    progressDelta:
      prev?.progress != null && next.progress != null ? next.progress - prev.progress : null,
    confidenceDelta:
      prev?.confidence != null && next.confidence != null
        ? next.confidence - prev.confidence
        : null,
    newlyStale: stale.added,
    resolvedStale: stale.removed,
    newBlockers: blocked.added,
    resolvedBlockers: blocked.removed,
  };
}

export interface PlannedEvent {
  type: ObjectiveEventType;
  subjectType: string;
  subjectId: string;
  payload: Record<string, unknown>;
}

const STATUS_EVENT: Partial<Record<ObjectiveHealthStatus, ObjectiveEventType>> = {
  at_risk: "objective.at_risk",
  off_track: "objective.off_track",
  blocked: "objective.blocked",
  achieved: "objective.achieved",
};

/**
 * Plan the events a snapshot warrants — avoiding event storms:
 *  • `objective.health.evaluated` for EVERY new logical snapshot (subject = snapshot);
 *  • `objective.health.changed` + a status-specific event ONLY on a status change;
 *  • `objective.measurement.stale` ONLY when a metric is newly stale.
 * Contribution events are planned separately by the handler (they need an
 * assessment id). Facts only — nothing here executes remediation.
 */
export function planObjectiveEvents(params: {
  objectiveId: string;
  snapshotId: string;
  health: ObjectiveHealth;
  change: HealthChange;
}): PlannedEvent[] {
  const { objectiveId, snapshotId, health, change } = params;
  const events: PlannedEvent[] = [
    {
      type: "objective.health.evaluated",
      subjectType: "objective_health",
      subjectId: snapshotId,
      payload: {
        objective_id: objectiveId,
        status: health.status,
        progress: health.progress,
        confidence: health.confidence,
      },
    },
  ];

  if (change.statusChanged) {
    events.push({
      type: "objective.health.changed",
      subjectType: "objective",
      subjectId: objectiveId,
      payload: {
        previous_status: change.previousStatus,
        new_status: change.newStatus,
        health_snapshot_id: snapshotId,
      },
    });
    const specific = STATUS_EVENT[change.newStatus];
    if (specific) {
      events.push({
        type: specific,
        subjectType: "objective",
        subjectId: objectiveId,
        payload: { health_snapshot_id: snapshotId, status: change.newStatus },
      });
    }
  }

  if (change.newlyStale.length > 0) {
    events.push({
      type: "objective.measurement.stale",
      subjectType: "objective",
      subjectId: objectiveId,
      payload: { newly_stale: change.newlyStale, health_snapshot_id: snapshotId },
    });
  }

  return events;
}

/** Whether a child snapshot change should trigger a parent re-evaluation. Bounded
 *  cycle/depth control lives in the impure handler (it holds the ancestry). */
export function shouldEnqueueParent(change: HealthChange, parentId: string | null): boolean {
  return change.statusChanged && !!parentId;
}

// ── Contribution integrity boundary (v1) ────────────────────────────────────
//
// An objective link expresses a relationship/expectation — it is NOT immutable
// evidence that an outcome occurred. A completed Action, a succeeded Automation
// Intent, or a metric that merely moved afterwards prove work/change, NOT causation.
// `contribution_confirmed` therefore requires an IMMUTABLE observed-outcome record
// (or an explicitly verified external outcome-evidence reference) of a SUPPORTED
// type. Because there is no first-class Outcomes layer yet, the supported set
// is EMPTY — so confirmed attribution is structurally impossible in v1. This is an
// intentional boundary: the future Outcomes layer is the prerequisite for it.

/** Supported immutable outcome-evidence types. EMPTY in v1 (no Outcomes layer). */
export const SUPPORTED_OUTCOME_EVIDENCE_TYPES: readonly string[] = [];

/** A reference to observed-outcome evidence. `type` must be a supported immutable
 *  type for it to back a confirmed contribution. */
export interface OutcomeEvidenceRef {
  type: string;
  ref: string;
  observedAt: string;
  metricKey?: string | null;
}

/** True only when at least one ref is of a SUPPORTED immutable type. Always false
 *  in v1 (SUPPORTED_OUTCOME_EVIDENCE_TYPES is empty). */
export function hasImmutableOutcomeEvidence(evidence: OutcomeEvidenceRef[]): boolean {
  return evidence.some((e) => SUPPORTED_OUTCOME_EVIDENCE_TYPES.includes(e.type));
}

/** Map SUPPORTED immutable outcome evidence into the pure evaluator's outcome
 *  snapshots. In v1 this is always empty — links/actions are never turned into
 *  "observed outcomes". */
function evidenceToOutcomes(evidence: OutcomeEvidenceRef[]): OutcomeSnapshot[] {
  return evidence
    .filter((e) => SUPPORTED_OUTCOME_EVIDENCE_TYPES.includes(e.type))
    .map((e) => ({
      ref: e.ref,
      status: "complete",
      observedAt: e.observedAt,
      metricKey: e.metricKey ?? null,
    }));
}

/**
 * The v1 integrity guard: `contribution_confirmed` is IMPOSSIBLE without immutable
 * outcome evidence. An otherwise-confirmed assessment is downgraded to
 * `inconclusive` (movement preserved for audit). Any other state passes through
 * unchanged. Pure and deterministic — the single choke point every persisted
 * contribution flows through.
 */
export function enforceContributionEvidenceBoundary(
  assessment: ContributionAssessment,
  evidence: OutcomeEvidenceRef[],
): ContributionAssessment {
  if (assessment.state === "contribution_confirmed" && !hasImmutableOutcomeEvidence(evidence)) {
    return {
      state: "inconclusive",
      confidence: Math.min(assessment.confidence, 0.3),
      observedMovement: assessment.observedMovement,
      rationale: [
        ...assessment.rationale,
        "Confirmation withheld: no immutable outcome evidence (a first-class Outcomes layer is required for confirmed attribution)",
      ],
    };
  }
  return assessment;
}

export interface ContributionCandidate {
  linkId: string;
  expected: ExpectedContribution;
}

export interface PlannedContribution {
  linkId: string;
  assessment: ContributionAssessment;
}

/**
 * Plan the contribution assessments for a set of verified candidate links. Outcomes
 * are derived ONLY from supported immutable evidence (empty in v1), so a verified
 * expected link with no evidence yields `expected`, and no path can reach
 * `contribution_confirmed` without evidence — every result passes through the
 * integrity boundary. No candidates ⇒ no assessments (e.g. the live health slice).
 */
export function planContributions(
  candidates: ContributionCandidate[],
  evidence: OutcomeEvidenceRef[],
  measurements: MeasurementSnapshot[],
): PlannedContribution[] {
  const outcomes = evidenceToOutcomes(evidence);
  return candidates.map((c) => ({
    linkId: c.linkId,
    assessment: enforceContributionEvidenceBoundary(
      evaluateContribution(c.expected, outcomes, measurements),
      evidence,
    ),
  }));
}
