// Universal Objectives & Outcomes Engine (pure).
//
// The strategic layer: what the business is trying to achieve, and whether our
// decisions and actions moved it closer. This module holds ONLY pure, deterministic
// evaluators — Objective Health and Contribution — plus the context resolver the
// caller uses before the Decision Engine. It defines nothing, measures nothing,
// executes nothing, routes nothing. No DB, no events, no clock (now is injected),
// no domain literals.

import type {
  CandidateObjectiveLink,
  ContributionAssessment,
  ExpectedContribution,
  KnownObjective,
  MeasurementSnapshot,
  MetricDirection,
  ObjectiveContext,
  ObjectiveHealth,
  ObjectiveHealthStatus,
  ObjectiveLinkFact,
  ObjectiveSnapshot,
  OutcomeSnapshot,
  VerificationState,
} from "./types.ts";

// ── controlled registries (mirror the seeded SQL registries) ────────────────
export const METRIC_DIRECTIONS = [
  "increase",
  "decrease",
  "maintain",
  "range",
  "threshold",
  "binary",
  "milestone",
] as const;

export const OBJECTIVE_HEALTH_REASON_CODES = [
  "dependency_blocked",
  "measurement_missing",
  "measurement_stale",
  "unit_mismatch",
  "currency_mismatch",
  "milestone_reached",
  "milestone_pending",
  "target_achieved",
  "target_missed",
  "metric_deteriorating",
  "off_track",
  "at_risk",
  "on_track",
  "constraint_violated",
] as const;
export type ObjectiveReasonCode = (typeof OBJECTIVE_HEALTH_REASON_CODES)[number];
const REASONS: ReadonlySet<string> = new Set(OBJECTIVE_HEALTH_REASON_CODES);
export function areObjectiveReasonCodes(codes: string[]): boolean {
  return codes.every((c) => REASONS.has(c));
}

export const CONTRIBUTION_STATES = [
  "proposed",
  "expected",
  "in_progress",
  "outcome_observed",
  "contribution_confirmed",
  "contribution_rejected",
  "inconclusive",
] as const;

export const VERIFICATION_STATES = [
  "verified_published",
  "approved_link",
  "proposed",
  "inferred_unverified",
  "rejected",
] as const;

const VERIFIED = new Set<VerificationState>(["verified_published", "approved_link"]);
export function isVerified(state: VerificationState): boolean {
  return VERIFIED.has(state);
}

/**
 * Verify caller-supplied candidate objective links against the tenant's known
 * objectives (supplied by the caller from the DB — this stays pure). Cross-tenant
 * references are REJECTED; only same-tenant published/active objectives may be
 * `verified_published`; approved links keep `approved_link`; unknown or draft
 * objectives stay unverified. Rejected links are dropped from the result.
 */
export function verifyObjectiveLinks(
  candidates: CandidateObjectiveLink[],
  known: KnownObjective[],
  tenantId: string,
): ObjectiveLinkFact[] {
  const byId = new Map(known.map((o) => [o.id, o]));
  const out: ObjectiveLinkFact[] = [];
  for (const c of candidates) {
    const obj = byId.get(c.objectiveId);
    let state: VerificationState;
    if (obj && obj.tenantId !== tenantId) {
      state = "rejected"; // cross-tenant reference — never trusted
    } else if (!obj) {
      state = "proposed"; // unknown objective — not verified, not trusted
    } else if (obj.status !== "active") {
      state = "inferred_unverified"; // known but not published/active
    } else if (c.source === "approved_link") {
      state = "approved_link";
    } else {
      state = "verified_published"; // same-tenant, active/published objective
    }
    if (state === "rejected") continue; // dropped entirely
    out.push({
      objectiveId: c.objectiveId,
      relation: c.relation,
      primary: c.primary,
      verificationState: state,
      expectedContribution: c.expectedContribution ?? null,
      confidence: c.confidence ?? null,
      constraintKeys: c.constraintKeys,
    });
  }
  return out;
}

const DEFAULT_STALE_HOURS = 168; // 7 days, if the objective sets none

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function latestOf(
  measurements: MeasurementSnapshot[],
  key: string | null,
): MeasurementSnapshot | null {
  if (!key) return null;
  const rel = measurements
    .filter((m) => m.metricKey === key)
    .sort((a, b) => (ms(b.measuredAt) ?? 0) - (ms(a.measuredAt) ?? 0));
  return rel[0] ?? null;
}

/** Fraction of the objective's time window elapsed (0..1), or null if unknown. */
function timeElapsed(
  startsAt: string | null | undefined,
  targetAt: string | null | undefined,
  nowMs: number,
): number | null {
  const s = ms(startsAt);
  const t = ms(targetAt);
  if (s === null || t === null || t <= s) return null;
  return clamp01((nowMs - s) / (t - s));
}

/**
 * Pure, deterministic Objective Health. Missing or stale data is NEVER healthy.
 * Unlike units/currencies are never compared. Replayable given (objective,
 * measurements, now).
 */
export function evaluateObjectiveHealth(
  objective: ObjectiveSnapshot,
  measurements: MeasurementSnapshot[],
  now: string,
): ObjectiveHealth {
  const nowMs = ms(now) ?? 0;
  const reasons: string[] = [];
  const blockers: string[] = [];
  const push = (c: ObjectiveReasonCode) => {
    if (!reasons.includes(c)) reasons.push(c);
  };
  const staleMs = (objective.staleAfterHours ?? DEFAULT_STALE_HOURS) * 3_600_000;
  const staleMeasurements = Array.from(
    new Set(
      measurements
        .filter((m) => {
          const age = nowMs - (ms(m.measuredAt) ?? nowMs);
          return age > staleMs;
        })
        .map((m) => m.metricKey),
    ),
  );

  const done = (
    status: ObjectiveHealthStatus,
    progress: number | null,
    confidence: number,
  ): ObjectiveHealth => ({
    status,
    progress,
    confidence,
    reasons,
    blockers,
    staleMeasurements,
    evaluatedAt: now,
  });

  // 1) Blocked by a dependency.
  for (const d of objective.dependencies ?? []) {
    if (
      d.healthStatus === "blocked" ||
      d.healthStatus === "off_track" ||
      d.healthStatus === "missed"
    ) {
      blockers.push(d.id);
    }
  }
  if (blockers.length > 0) {
    push("dependency_blocked");
    return done("blocked", null, 0.5);
  }

  // 2) Primary measurement present + fresh.
  const latest = latestOf(measurements, objective.primaryMetricKey);
  if (!objective.primaryMetricKey || !latest) {
    push("measurement_missing");
    return done("unknown", null, 0.1);
  }
  const latestAge = nowMs - (ms(latest.measuredAt) ?? nowMs);
  if (latestAge > staleMs) {
    push("measurement_stale");
    return done("unknown", null, 0.2); // stale data never reads as healthy
  }
  const confidence = latest.confidence ?? 0.7;

  // 3) Qualitative milestone / binary.
  if (objective.direction === "milestone" || objective.direction === "binary") {
    if (latest.milestoneReached === true) {
      push("milestone_reached");
      return done("achieved", 1, confidence);
    }
    push("milestone_pending");
    const past = ms(objective.targetAt) !== null && nowMs > (ms(objective.targetAt) as number);
    return done(past ? "missed" : "on_track", 0, confidence);
  }

  // 4) Numeric — never compare unlike units/currencies.
  const b = objective.baseline;
  const t = objective.target;
  const units = [b?.unit, t?.unit, latest.unit].filter((u): u is string => u != null);
  if (new Set(units).size > 1) {
    push("unit_mismatch");
    return done("unknown", null, 0.3);
  }
  if (units.includes("currency")) {
    const ccy = [b?.currency, t?.currency, latest.currency].filter((c): c is string => c != null);
    if (new Set(ccy).size > 1) {
      push("currency_mismatch");
      return done("unknown", null, 0.3);
    }
  }

  const baseline = b?.value ?? null;
  const target = t?.value ?? null;
  const current = latest.value;
  if (current === null) {
    push("measurement_missing");
    return done("unknown", null, 0.2);
  }

  // 5) Direction → progress, achieved, deteriorating.
  let achieved = false;
  let deteriorating = false;
  let progress: number | null = null;
  const dir: MetricDirection = objective.direction;
  if (dir === "increase" && baseline !== null && target !== null && target !== baseline) {
    achieved = current >= target;
    deteriorating = current < baseline;
    progress = clamp01((current - baseline) / (target - baseline));
  } else if (dir === "decrease" && baseline !== null && target !== null && target !== baseline) {
    achieved = current <= target;
    deteriorating = current > baseline;
    progress = clamp01((baseline - current) / (baseline - target));
  } else if (dir === "maintain" && target !== null) {
    const tol = Math.max(Math.abs(target) * 0.05, 1e-9);
    achieved = Math.abs(current - target) <= tol;
    deteriorating = baseline !== null && Math.abs(current - baseline) > tol && !achieved;
    progress = achieved ? 1 : 0.5;
  } else if (dir === "range" && t && t.rangeMin != null && t.rangeMax != null) {
    achieved = current >= t.rangeMin && current <= t.rangeMax;
    deteriorating = !achieved;
    progress = achieved ? 1 : 0;
  } else if (dir === "threshold" && target !== null) {
    achieved = baseline !== null && baseline > target ? current <= target : current >= target;
    progress = achieved ? 1 : 0.5;
  } else {
    // insufficient definition to compute numerically
    push("measurement_missing");
    return done("unknown", null, 0.3);
  }

  // 6) Constraint checks — a violated HARD constraint caps the status.
  let cap: ObjectiveHealthStatus | null = null;
  for (const con of objective.constraints ?? []) {
    if (con.threshold == null || !con.metricKey) continue;
    const cm = latestOf(measurements, con.metricKey);
    if (!cm || cm.value == null) continue;
    const violated =
      (con.direction === "increase" && cm.value < con.threshold) ||
      (con.direction === "decrease" && cm.value > con.threshold);
    if (violated) {
      push("constraint_violated");
      blockers.push(con.key);
      if (con.kind === "hard") cap = "off_track";
      else if (cap !== "off_track") cap = "at_risk";
    }
  }

  // 7) Time-aware status.
  const past = ms(objective.targetAt) !== null && nowMs > (ms(objective.targetAt) as number);
  let status: ObjectiveHealthStatus;
  if (achieved) {
    push("target_achieved");
    status = "achieved";
    progress = 1;
  } else if (past) {
    push("target_missed");
    status = "missed";
  } else if (deteriorating) {
    push("metric_deteriorating");
    status = "off_track";
  } else {
    const expected = timeElapsed(objective.startsAt, objective.targetAt, nowMs);
    if (expected !== null && progress !== null && progress < expected - 0.15) {
      push("off_track");
      status = "off_track";
    } else if (expected !== null && progress !== null && progress < expected) {
      push("at_risk");
      status = "at_risk";
    } else {
      push("on_track");
      status = "on_track";
    }
  }

  // apply the constraint cap (never let a violation read better than the cap)
  const ORDER: ObjectiveHealthStatus[] = [
    "achieved",
    "on_track",
    "at_risk",
    "off_track",
    "blocked",
    "missed",
    "unknown",
  ];
  if (cap && ORDER.indexOf(cap) > ORDER.indexOf(status)) status = cap;

  const conf = staleMeasurements.length > 0 ? Math.min(confidence, 0.6) : confidence;
  return done(status, progress, conf);
}

/**
 * Pure, deterministic Contribution assessment. It is HONEST: an action is never
 * credited merely because it was linked. Attribution requires before/after
 * measurement evidence; otherwise the result is inconclusive.
 */
export function evaluateContribution(
  expected: ExpectedContribution,
  outcomes: OutcomeSnapshot[],
  measurements: MeasurementSnapshot[],
): ContributionAssessment {
  if (outcomes.length === 0) {
    return {
      state: "expected",
      confidence: 0.3,
      observedMovement: null,
      rationale: ["No outcome observed yet"],
    };
  }
  const completed = outcomes.filter((o) => o.status === "complete");
  if (completed.length === 0) {
    const allFailed = outcomes.every((o) => o.status === "failed");
    return allFailed
      ? {
          state: "contribution_rejected",
          confidence: 0.6,
          observedMovement: null,
          rationale: ["Action(s) failed"],
        }
      : {
          state: "in_progress",
          confidence: 0.3,
          observedMovement: null,
          rationale: ["Action in progress"],
        };
  }

  const key = expected.metricKey;
  if (!key || !expected.expectedDirection) {
    return {
      state: "outcome_observed",
      confidence: 0.4,
      observedMovement: null,
      rationale: ["Outcome observed; no metric to attribute against"],
    };
  }
  const outcomeTime = Math.min(...completed.map((o) => ms(o.observedAt) ?? Infinity));
  const series = measurements
    .filter((m) => m.metricKey === key && m.value !== null)
    .sort((a, b) => (ms(a.measuredAt) ?? 0) - (ms(b.measuredAt) ?? 0));
  const before = series.filter((m) => (ms(m.measuredAt) ?? 0) <= outcomeTime).pop();
  const after = series.filter((m) => (ms(m.measuredAt) ?? 0) > outcomeTime).pop();
  if (!before || !after) {
    return {
      state: "inconclusive",
      confidence: 0.3,
      observedMovement: null,
      rationale: ["Insufficient before/after measurements to attribute contribution"],
    };
  }
  const movement = (after.value as number) - (before.value as number);
  const matches =
    expected.expectedDirection === "increase"
      ? movement > 0
      : expected.expectedDirection === "decrease"
        ? movement < 0
        : Math.abs(movement) < 1e-9;
  if (Math.abs(movement) === 0) {
    return {
      state: "inconclusive",
      confidence: 0.3,
      observedMovement: 0,
      rationale: ["No measured movement to attribute"],
    };
  }
  if (matches) {
    // An UNVERIFIED objective link may never claim confirmed contribution.
    if (expected.verified === false) {
      return {
        state: "inconclusive",
        confidence: 0.3,
        observedMovement: movement,
        rationale: ["Movement observed but the objective link is unverified — not attributable"],
      };
    }
    return {
      state: "contribution_confirmed",
      confidence: Math.min(0.9, after.confidence ?? 0.6),
      observedMovement: movement,
      rationale: ["Measured movement in the expected direction after the outcome"],
    };
  }
  return {
    state: "contribution_rejected",
    confidence: 0.5,
    observedMovement: movement,
    rationale: ["Measured movement contradicts the expected direction"],
  };
}

/**
 * Resolve the objective context for an intelligence object from its RESOLVED
 * links (the caller supplies them from the DB). Pure. Descriptive only — the
 * Decision Engine records this but never routes on it.
 */
export function resolveObjectiveContext(links: ObjectiveLinkFact[]): ObjectiveContext {
  const primary = links.find((l) => l.primary) ?? links[0] ?? null;
  return {
    objectiveIds: links.map((l) => l.objectiveId),
    verifiedObjectiveIds: links
      .filter((l) => isVerified(l.verificationState))
      .map((l) => l.objectiveId),
    primaryObjectiveId: primary?.objectiveId ?? null,
    expectedContribution: primary?.expectedContribution ?? null,
    contributionConfidence: primary?.confidence ?? null,
    constraintsChecked: Array.from(new Set(links.flatMap((l) => l.constraintKeys ?? []))),
  };
}
