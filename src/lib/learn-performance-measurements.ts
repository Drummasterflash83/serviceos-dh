import {
  attachPerformanceCorrections,
  parsePerformanceCorrections,
  type PerformanceCorrection,
} from "./learn-performance-corrections.ts";
/** Read the complete correction history for one exact assessment cell set.
 * Uses the signed-in client/RLS; never a service credential. Exact count prevents
 * a server row cap from silently presenting old or incomplete correction history.
 */
import type { LearnReadClient } from "./learn-cards.ts";
import {
  validateScorecardPolicy,
  type PerformanceMeasurement,
  type ScorecardPolicy,
  type ScorePeriod,
  type ScoreSubject,
} from "./learn-scorecards.ts";
import {
  loadPerformanceReviews,
  parsePerformanceReviews,
  type PerformanceReview,
} from "./learn-performance-reviews.ts";
export type ReviewedPerformanceMeasurement = PerformanceMeasurement & {
  reviews: PerformanceReview[];
  correction?: PerformanceCorrection;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const stamp = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const sources = new Set([
  "interactions",
  "email_messages",
  "phone_calls",
  "phone_recordings",
  "jobs",
  "team_members",
  "learn_work_measurement_runs",
  "learn_team_work_measurement_runs",
  "learn_work_collection_runs",
]);
const evidence = (v: any): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((r) => r && sources.has(r.table) && uuid(r.id));
const columns =
  "id,tenant_id,subject_kind,subject_id,policy_id,policy_revision,metric_key,value,unit,window_start,window_end,measured_at,source,source_through,sample_count,covered_count,eligible_count,review_state,evidence,exclusions,supersedes,group_ids,correction_request_id:request_payload->>manualCorrectionId";
export async function loadPerformanceMeasurements(
  db: LearnReadClient,
  policy: ScorecardPolicy,
  subject: ScoreSubject,
  period: ScorePeriod,
): Promise<ReviewedPerformanceMeasurement[]> {
  if (
    validateScorecardPolicy(policy).length ||
    !uuid(subject?.id) ||
    subject.kind !== policy.subjectKind ||
    !Number.isFinite(stamp(period?.start)) ||
    !Number.isFinite(stamp(period?.end)) ||
    stamp(period.end) <= stamp(period.start)
  )
    throw Error("Invalid performance measurement scope");
  const { data, error, count } = await db
    .from("measurements")
    .select(columns, { count: "exact" })
    .eq("tenant_id", policy.tenantId)
    .eq("policy_id", policy.id)
    .eq("policy_revision", policy.version)
    .eq("subject_kind", subject.kind)
    .eq("subject_id", subject.id)
    .eq("window_start", new Date(period.start).toISOString())
    .eq("window_end", new Date(period.end).toISOString())
    .order("measured_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(501);
  if (error || !Array.isArray(data) || !integer(count) || count > 500 || data.length !== count)
    throw Error("Complete measurement history could not be read. No score has been calculated.");
  const { measurements, correctionMarkers } = parseMeasurementRows(policy, subject, period, data);
  const corrected = await attachPerformanceCorrections(
    db,
    policy.tenantId,
    measurements,
    correctionMarkers,
  );
  const histories = await loadPerformanceReviews(
    db,
    policy.tenantId,
    measurements.map((m) => m.id),
  );
  return corrected.map((m) => {
    const reviews = histories.get(m.id) ?? [];
    // Human decisions are separate facts. They never change observedAt, sourceThrough,
    // values, counts or the source correction chain. No ledger = no confirmation.
    return { ...m, review: reviews.at(-1)?.decision ?? "inferred", reviews };
  });
}

export function parseMeasurementRows(
  policy: ScorecardPolicy,
  subject: ScoreSubject,
  period: ScorePeriod,
  data: any[],
) {
  if (
    validateScorecardPolicy(policy).length ||
    !uuid(subject?.id) ||
    subject.kind !== policy.subjectKind ||
    !Number.isFinite(stamp(period?.start)) ||
    !(stamp(period?.end) > stamp(period.start)) ||
    !Array.isArray(data) ||
    data.length > 500
  )
    throw Error("Invalid measurement snapshot scope");
  const ids = new Set<string>();
  const correctionMarkers = new Map<string, string>();
  const measurements: PerformanceMeasurement[] = data.map((r: any) => {
    if (
      !r ||
      !uuid(r.id) ||
      ids.has(r.id) ||
      r.tenant_id !== policy.tenantId ||
      r.policy_id !== policy.id ||
      r.policy_revision !== policy.version ||
      r.subject_kind !== subject.kind ||
      r.subject_id !== subject.id ||
      stamp(r.window_start) !== stamp(period.start) ||
      stamp(r.window_end) !== stamp(period.end) ||
      !policy.metrics.some(
        (m) => m.key === r.metric_key && m.unit === r.unit && m.sourceSystems.includes(r.source),
      ) ||
      !(r.value === null || finite(r.value)) ||
      !integer(r.sample_count) ||
      !integer(r.covered_count) ||
      !(
        r.eligible_count === null ||
        (integer(r.eligible_count) && r.eligible_count >= r.covered_count)
      ) ||
      !Number.isFinite(stamp(r.measured_at)) ||
      stamp(r.measured_at) < stamp(period.end) ||
      !(
        r.source_through === null ||
        (Number.isFinite(stamp(r.source_through)) &&
          stamp(r.source_through) <= stamp(r.measured_at))
      ) ||
      !["inferred", "confirmed", "disputed"].includes(r.review_state) ||
      !evidence(r.evidence) ||
      !Array.isArray(r.exclusions) ||
      r.exclusions.some(
        (e: any) =>
          !e ||
          typeof e.reason !== "string" ||
          !e.reason.trim() ||
          e.reason.length > 200 ||
          !integer(e.count) ||
          !evidence(e.evidence),
      ) ||
      !(r.supersedes === null || uuid(r.supersedes)) ||
      !Array.isArray(r.group_ids) ||
      !r.group_ids.every(uuid) ||
      (policy.groupId && !r.group_ids.includes(policy.groupId))
    )
      throw Error(
        "Measurement history failed scope or evidence validation. No score has been calculated.",
      );
    if (r.correction_request_id != null) {
      if (r.correction_request_id !== r.id) throw Error("Correction request identity differs");
      correctionMarkers.set(r.id, r.correction_request_id);
    }
    ids.add(r.id);
    return {
      id: r.id,
      tenantId: r.tenant_id,
      subject: { kind: r.subject_kind, id: r.subject_id, groupIds: r.group_ids },
      policyId: r.policy_id,
      policyVersion: r.policy_revision,
      metricKey: r.metric_key,
      period: { start: r.window_start, end: r.window_end },
      value: r.value,
      unit: r.unit,
      sampleCount: r.sample_count,
      coveredCount: r.covered_count,
      eligibleCount: r.eligible_count,
      observedAt: r.measured_at,
      sourceThrough: r.source_through,
      sourceSystem: r.source,
      review: r.review_state,
      evidence: r.evidence,
      exclusions: r.exclusions,
      ...(r.supersedes ? { supersedes: r.supersedes } : {}),
    };
  });
  return { measurements, correctionMarkers };
}

export function parseMeasurementSnapshot(
  policy: ScorecardPolicy,
  subject: ScoreSubject,
  period: ScorePeriod,
  data: any[],
  reviews: PerformanceReview[],
  corrections: PerformanceCorrection[],
): ReviewedPerformanceMeasurement[] {
  const { measurements, correctionMarkers } = parseMeasurementRows(policy, subject, period, data);
  const corrected = parsePerformanceCorrections(
    policy.tenantId,
    measurements,
    correctionMarkers,
    corrections,
  );
  const histories = parsePerformanceReviews(
    policy.tenantId,
    measurements.map((m) => m.id),
    reviews,
  );
  return corrected.map((m) => {
    const reviews = histories.get(m.id) ?? [];
    return { ...m, review: reviews.at(-1)?.decision ?? "inferred", reviews };
  });
}
