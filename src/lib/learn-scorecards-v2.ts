import {
  evaluateScorecardV1,
  validateScorecardPolicy,
  type PerformanceMeasurement,
  type ScorecardPolicy,
  type ScorecardResult,
  type ScorePeriod,
  type ScoreSubject,
} from "./learn-scorecards.ts";

/** A separate policy contract keeps retained V1 assessments on their original
 * all-measures-required engine. Thresholds are business decisions, never defaults. */
export interface ScorecardPolicyV2 extends ScorecardPolicy {
  engine: "learn-scorecards/2";
  /** Percentage of positive policy weight that must have confirmed evidence. */
  minimumAssessedWeightPercent: number;
  /** Prevents a single well-weighted measure from standing in for a scorecard. */
  minimumAssessedMetricCount: number;
  /** Critical measures cannot be omitted even if the weight floor is met. */
  requiredMetricKeys: string[];
}

export interface ScorecardResultV2 extends ScorecardResult {
  engine: "learn-scorecards/2";
  assessedWeightPercent: number;
  assessedMetricCount: number;
  minimumAssessedWeightPercent: number;
  minimumAssessedMetricCount: number;
  /** Only positive-weight measures contribute to the rescaled denominator. */
  rescaledDenominator: number;
  omittedMetrics: { key: string; weight: number; reasons: string[] }[];
  evidenceReady: boolean;
  gateReasons: string[];
}

export function validateScorecardPolicyV2(policy: ScorecardPolicyV2): string[] {
  if (!policy || typeof policy !== "object") return ["Invalid V2 policy"];
  const errors = validateScorecardPolicy(policy);
  if (
    policy.engine !== "learn-scorecards/2" ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 2
  )
    errors.push("V2 requires its own engine and policy revision of at least 2");
  if (
    !Number.isFinite(policy.minimumAssessedWeightPercent) ||
    policy.minimumAssessedWeightPercent <= 0 ||
    policy.minimumAssessedWeightPercent > 100
  )
    errors.push("Choose an explicit minimum assessed-weight percentage from 1 to 100");
  const activeCount = Array.isArray(policy.metrics)
    ? policy.metrics.filter((rule) => rule?.weight > 0).length
    : 0;
  if (
    !Number.isSafeInteger(policy.minimumAssessedMetricCount) ||
    policy.minimumAssessedMetricCount < 1 ||
    policy.minimumAssessedMetricCount > activeCount
  )
    errors.push("Choose an explicit minimum assessed measure count");
  const activeKeys = new Set(
    Array.isArray(policy.metrics)
      ? policy.metrics.filter((rule) => rule?.weight > 0).map((rule) => rule.key)
      : [],
  );
  if (
    !Array.isArray(policy.requiredMetricKeys) ||
    policy.requiredMetricKeys.some((key) => !activeKeys.has(key)) ||
    new Set(policy.requiredMetricKeys).size !== policy.requiredMetricKeys.length
  )
    errors.push("Required measures must be unique positive-weight policy keys");
  return errors;
}

/** V1 validates each observation and its correction chain. V2 excludes only
 * measures V1 could not confirm, then rescales the remaining positive weights
 * if the versioned policy's minimum evidence gates are met. No writes occur. */
export function evaluateScorecardV2(
  policy: ScorecardPolicyV2,
  subject: ScoreSubject,
  period: ScorePeriod,
  measurements: PerformanceMeasurement[],
  now = Date.now(),
): ScorecardResultV2 {
  const errors = validateScorecardPolicyV2(policy);
  if (errors.length) throw Error(errors.join("; "));
  const keys = new Set(policy.metrics.map((rule) => rule.key));
  if (measurements.some((measurement) => !keys.has(measurement?.metricKey)))
    throw Error("Measurement is outside the versioned policy");
  const v1 = evaluateScorecardV1(policy, subject, period, measurements, now);
  const active = v1.metrics.filter((metric) => metric.weight > 0);
  const assessed = active.filter((metric) => metric.score !== null);
  const assessedWeight = assessed.reduce((weight, metric) => weight + metric.weight, 0);
  const assessedWeightPercent = (assessedWeight / v1.totalWeight) * 100;
  const gateReasons: string[] = [];
  if (assessedWeightPercent < policy.minimumAssessedWeightPercent)
    gateReasons.push("Minimum assessed policy weight has not been met");
  if (assessed.length < policy.minimumAssessedMetricCount)
    gateReasons.push("Minimum count of assessed measures has not been met");
  const assessedKeys = new Set(assessed.map((metric) => metric.key));
  const missingRequired = policy.requiredMetricKeys.filter((key) => !assessedKeys.has(key));
  if (missingRequired.length)
    gateReasons.push(`Required measures lack confirmed evidence: ${missingRequired.join(", ")}`);
  const evidenceReady = gateReasons.length === 0;
  const weighted = evidenceReady
    ? assessed.reduce((total, metric) => total + metric.score! * metric.weight, 0) / assessedWeight
    : null;
  return {
    ...v1,
    engine: "learn-scorecards/2",
    state: policy.status === "draft" ? "draft" : evidenceReady ? "ready" : "incomplete",
    score: policy.status === "published" ? weighted : null,
    previewScore: policy.status === "draft" ? weighted : null,
    assessedWeight,
    assessedWeightPercent,
    assessedMetricCount: assessed.length,
    minimumAssessedWeightPercent: policy.minimumAssessedWeightPercent,
    minimumAssessedMetricCount: policy.minimumAssessedMetricCount,
    rescaledDenominator: assessedWeight,
    omittedMetrics: active
      .filter((metric) => metric.score === null)
      .map((metric) => ({ key: metric.key, weight: metric.weight, reasons: [...metric.reasons] })),
    evidenceReady,
    gateReasons,
  };
}
