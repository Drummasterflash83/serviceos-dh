/** Deterministic performance scoring. This module never writes records, makes
 * employment/pay decisions, or derives performance from sentiment/personality.
 * Source adapters supply evidenced measurements; tenant policy supplies weights.
 */
export type ScoreSubject = {
  kind: "member" | "team" | "job" | "customer";
  id: string;
  groupIds?: string[];
};
export type ScorePeriod = { start: string; end: string };
export type EvidenceRef = { table: string; id: string };
export interface ScoreMetricRule {
  key: string;
  label: string;
  unit: string;
  weight: number;
  /** Linear anchors. Reverse them for lower-is-better measures. */
  zeroAt: number;
  fullAt: number;
  minSamples: number;
  minCoverage: number;
  maxAgeHours: number;
  sourceSystems: string[];
}
export interface ScorecardPolicy {
  tenantId: string;
  id: string;
  version: number;
  name: string;
  status: "draft" | "published";
  publication?: { id: string; effectiveFrom: string; effectiveUntil: string | null };
  subjectKind: ScoreSubject["kind"];
  groupId?: string | null;
  scaleMax: number;
  metrics: ScoreMetricRule[];
}
export interface PerformanceMeasurement {
  id: string;
  tenantId: string;
  subject: ScoreSubject;
  metricKey: string;
  policyId: string;
  policyVersion: number;
  period: ScorePeriod;
  value: number | null;
  unit: string;
  sampleCount: number;
  /** Counts are for the eligible population after documented exclusions. */
  coveredCount: number;
  eligibleCount: number | null;
  observedAt: string;
  /** Human numerical corrections retain the original source-observation freshness. */
  sourceObservedAt?: string;
  sourceThrough: string | null;
  sourceSystem: string;
  review: "confirmed" | "inferred" | "disputed";
  evidence: EvidenceRef[];
  exclusions: { reason: string; count: number; evidence: EvidenceRef[] }[];
  /** A correction is a new measurement, never an edit to the old fact. */
  supersedes?: string;
}
export interface MetricScore {
  key: string;
  label: string;
  unit: string;
  weight: number;
  value: number | null;
  score: number | null;
  coverage: number | null;
  sampleCount: number | null;
  measurementId: string | null;
  reasons: string[];
  evidence: EvidenceRef[];
  exclusions: PerformanceMeasurement["exclusions"];
}
export interface ScorecardResult {
  policyId: string;
  policyVersion: number;
  subject: ScoreSubject;
  period: ScorePeriod;
  state: "ready" | "incomplete" | "draft";
  score: number | null;
  /** Draft previews are never labelled an assessed person's score. */
  previewScore: number | null;
  scaleMax: number;
  assessedWeight: number;
  totalWeight: number;
  metrics: MetricScore[];
  use: "advisory_review";
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nonnegativeInteger = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const named = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 200;
const stamp = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);
const subjectKinds = ["member", "team", "job", "customer"];
const sameSubject = (a: ScoreSubject, b: ScoreSubject) => a.kind === b.kind && a.id === b.id;
const samePeriod = (a: ScorePeriod, b: ScorePeriod) =>
  stamp(a.start) === stamp(b.start) && stamp(a.end) === stamp(b.end);
function validPeriod(period: ScorePeriod) {
  return period && Number.isFinite(stamp(period.start)) && stamp(period.end) > stamp(period.start);
}
function validEvidence(e: EvidenceRef[]) {
  return (
    Array.isArray(e) &&
    e.length > 0 &&
    e.every((r) => r && /^[a-z][a-z0-9_]{0,62}$/.test(r.table) && uuid(r.id))
  );
}

export function validateScorecardPolicy(policy: ScorecardPolicy): string[] {
  const errors: string[] = [];
  if (!policy || !uuid(policy.tenantId) || !uuid(policy.id)) return ["Invalid policy identity"];
  if (policy.groupId && (!uuid(policy.groupId) || !["member", "team"].includes(policy.subjectKind)))
    errors.push("Invalid team group scope");
  if (!nonnegativeInteger(policy.version) || policy.version < 1)
    errors.push("Policy version must be a positive integer");
  if (
    !named(policy.name) ||
    !["draft", "published"].includes(policy.status) ||
    !subjectKinds.includes(policy.subjectKind)
  )
    errors.push("Invalid policy scope");
  if (
    policy.status === "published" &&
    (!policy.publication ||
      !uuid(policy.publication.id) ||
      !Number.isFinite(stamp(policy.publication.effectiveFrom)) ||
      !(
        policy.publication.effectiveUntil === null ||
        (Number.isFinite(stamp(policy.publication.effectiveUntil)) &&
          stamp(policy.publication.effectiveUntil) > stamp(policy.publication.effectiveFrom))
      ))
  )
    errors.push("Published rules require their verified effective interval");
  if (!finite(policy.scaleMax) || policy.scaleMax <= 0 || policy.scaleMax > 10000)
    errors.push("Choose a scale greater than zero and at most 10,000");
  if (!Array.isArray(policy.metrics) || !policy.metrics.length || policy.metrics.length > 50)
    return [...errors, "Choose between 1 and 50 measures"];
  const keys = new Set<string>();
  for (const m of policy.metrics) {
    if (!m || !named(m.key) || !/^[a-z][a-z0-9_.-]+$/.test(m.key) || keys.has(m.key)) {
      errors.push("Measure keys must be unique");
      continue;
    }
    keys.add(m.key);
    if (!named(m.label) || !named(m.unit)) errors.push(`${m.key}: label and unit are required`);
    if (!finite(m.weight) || m.weight < 0 || m.weight > 10000)
      errors.push(`${m.key}: invalid weight`);
    if (!finite(m.zeroAt) || !finite(m.fullAt) || m.zeroAt === m.fullAt)
      errors.push(`${m.key}: distinct finite scoring anchors are required`);
    if (!nonnegativeInteger(m.minSamples) || m.minSamples < 1)
      errors.push(`${m.key}: minimum sample count must be positive`);
    if (!finite(m.minCoverage) || m.minCoverage <= 0 || m.minCoverage > 1)
      errors.push(`${m.key}: coverage must be greater than zero and at most 100%`);
    if (!finite(m.maxAgeHours) || m.maxAgeHours <= 0)
      errors.push(`${m.key}: freshness limit must be positive`);
    if (!Array.isArray(m.sourceSystems) || !m.sourceSystems.length || !m.sourceSystems.every(named))
      errors.push(`${m.key}: choose accepted evidence sources`);
  }
  if (!policy.metrics.some((m) => m?.weight > 0))
    errors.push("At least one measure needs a positive weight");
  return errors;
}

/** Use only measurements for this exact subject and period. Callers must read
 * them with tenant authorization; any mixed scope rejects the whole evaluation. */
export function evaluateScorecardV1(
  policy: ScorecardPolicy,
  subject: ScoreSubject,
  period: ScorePeriod,
  measurements: PerformanceMeasurement[],
  now = Date.now(),
): ScorecardResult {
  const policyErrors = validateScorecardPolicy(policy);
  if (policyErrors.length) throw new Error(policyErrors.join("; "));
  if (
    policy.groupId &&
    !(subject?.kind === "team"
      ? subject.id === policy.groupId
      : subject?.groupIds?.includes(policy.groupId))
  )
    throw new Error("Subject does not belong to the configured team group");
  if (
    !subject ||
    !uuid(subject.id) ||
    subject.kind !== policy.subjectKind ||
    !validPeriod(period) ||
    !finite(now) ||
    stamp(period.end) > now
  )
    throw new Error("Invalid assessment scope or unfinished period");
  if (
    measurements.some(
      (m) =>
        !m ||
        !uuid(m.id) ||
        m.tenantId !== policy.tenantId ||
        !m.subject ||
        !sameSubject(m.subject, subject) ||
        !m.period ||
        !samePeriod(m.period, period) ||
        m.policyId !== policy.id ||
        m.policyVersion !== policy.version,
    )
  )
    throw new Error("Measurement scope does not match policy, subject, version and period");
  if (
    policy.status === "published" &&
    (stamp(period.start) < stamp(policy.publication!.effectiveFrom) ||
      (policy.publication!.effectiveUntil !== null &&
        stamp(period.end) > stamp(policy.publication!.effectiveUntil)))
  )
    throw new Error("Assessment period falls outside the published rule interval");
  const byId = new Map<string, PerformanceMeasurement>();
  for (const m of measurements) {
    const prior = byId.get(m.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(m))
      throw new Error("Conflicting copies of the same measurement");
    byId.set(m.id, m);
  }
  const unique = [...byId.values()];
  const metrics: MetricScore[] = policy.metrics.map((rule) => {
    const candidates = unique.filter((m) => m.metricKey === rule.key);
    // Only explicit correction chains replace facts; "newest wins" hides disputes.
    const replaced = new Set(candidates.map((m) => m.supersedes).filter(Boolean));
    const leaves = candidates.filter((m) => !replaced.has(m.id));
    const reasons: string[] = [];
    const invalidChain = candidates.some(
      (m) =>
        m.supersedes &&
        (!byId.has(m.supersedes) ||
          byId.get(m.supersedes)?.metricKey !== rule.key ||
          stamp(byId.get(m.supersedes)?.observedAt) >= stamp(m.observedAt)),
    );
    const measurement = leaves.length === 1 && !invalidChain ? leaves[0] : null;
    if (invalidChain || leaves.length > 1 || (candidates.length > 0 && !leaves.length))
      reasons.push("Conflicting or incomplete correction history");
    else if (!measurement) reasons.push("No measurement for this subject and period");
    let coverage: number | null = null;
    if (measurement) {
      const m = measurement;
      if (m.review !== "confirmed")
        reasons.push(
          m.review === "disputed" ? "Evidence is disputed" : "Evidence needs confirmation",
        );
      if (!finite(m.value)) reasons.push("Measured value is missing or invalid");
      if (m.unit !== rule.unit) reasons.push("Measurement unit does not match the scoring rule");
      if (!rule.sourceSystems.includes(m.sourceSystem))
        reasons.push("Evidence source is not accepted by this rule");
      if (!nonnegativeInteger(m.sampleCount) || m.sampleCount < rule.minSamples)
        reasons.push("Insufficient samples");
      if (
        nonnegativeInteger(m.coveredCount) &&
        nonnegativeInteger(m.eligibleCount) &&
        m.eligibleCount > 0 &&
        m.coveredCount <= m.eligibleCount
      )
        coverage = m.coveredCount / m.eligibleCount;
      if (coverage === null || coverage < rule.minCoverage)
        reasons.push("Evidence coverage is incomplete or unknown");
      if (
        !Number.isFinite(stamp(m.observedAt)) ||
        stamp(m.observedAt) > now ||
        !Number.isFinite(stamp(m.sourceObservedAt ?? m.observedAt)) ||
        stamp(m.sourceObservedAt ?? m.observedAt) > stamp(m.observedAt) ||
        now - stamp(m.sourceObservedAt ?? m.observedAt) > rule.maxAgeHours * 3600000
      )
        reasons.push("Measurement freshness is not established");
      if (
        !Number.isFinite(stamp(m.sourceThrough)) ||
        stamp(m.sourceThrough) < stamp(period.end) ||
        stamp(m.sourceThrough) > now
      )
        reasons.push("Source coverage does not reach the assessment period end");
      if (!validEvidence(m.evidence)) reasons.push("Supporting source evidence is missing");
      if (
        !Array.isArray(m.exclusions) ||
        m.exclusions.some(
          (e) => !named(e.reason) || !nonnegativeInteger(e.count) || !validEvidence(e.evidence),
        )
      )
        reasons.push("Exclusions need a reason and supporting evidence");
    }
    return {
      key: rule.key,
      label: rule.label,
      unit: rule.unit,
      weight: rule.weight,
      value: finite(measurement?.value) ? measurement.value : null,
      score:
        measurement && !reasons.length
          ? Math.min(
              1,
              Math.max(0, (measurement.value! - rule.zeroAt) / (rule.fullAt - rule.zeroAt)),
            ) * policy.scaleMax
          : null,
      coverage,
      sampleCount: nonnegativeInteger(measurement?.sampleCount) ? measurement.sampleCount : null,
      measurementId: measurement?.id ?? null,
      reasons,
      evidence: measurement?.evidence ?? [],
      exclusions: measurement?.exclusions ?? [],
    };
  });
  const active = metrics.filter((m) => m.weight > 0);
  const totalWeight = active.reduce((n, m) => n + m.weight, 0);
  const assessedWeight = active.filter((m) => m.score !== null).reduce((n, m) => n + m.weight, 0);
  // Do not silently reweight the remaining metrics when a source is missing.
  const complete = active.every((m) => m.score !== null);
  const weighted = complete
    ? active.reduce((n, m) => n + m.score! * m.weight, 0) / totalWeight
    : null;
  return {
    policyId: policy.id,
    policyVersion: policy.version,
    subject,
    period,
    state: policy.status === "draft" ? "draft" : complete ? "ready" : "incomplete",
    score: policy.status === "published" ? weighted : null,
    previewScore: policy.status === "draft" ? weighted : null,
    scaleMax: policy.scaleMax,
    assessedWeight,
    totalWeight,
    metrics,
    use: "advisory_review",
  };
}

/** Current engine. Retained assessments call V1 explicitly; keep its semantics stable. */
export const evaluateScorecard = evaluateScorecardV1;

export type TimeWindow = { start: string; end: string };
function union(windows: TimeWindow[], from: number, to: number): [number, number][] {
  const sorted: [number, number][] = windows
    .map((w) => {
      if (!validPeriod(w)) throw new Error("Invalid work-time interval");
      return [Math.max(stamp(w.start), from), Math.min(stamp(w.end), to)] as [number, number];
    })
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const result: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else result.push([a, b]);
  }
  return result;
}
function intersection(a: [number, number][], b: [number, number][]): [number, number][] {
  const result: [number, number][] = [];
  for (const x of a)
    for (const y of b) {
      const start = Math.max(x[0], y[0]),
        end = Math.min(x[1], y[1]);
      if (end > start) result.push([start, end]);
    }
  return result;
}
const minutes = (windows: [number, number][]) =>
  windows.reduce((n, [a, b]) => n + (b - a) / 60000, 0);
/** Work residence is separate from source inference. Caller supplies confirmed
 * ownership, explicit business calendar windows and approved exclusions. */
export function measureDeskTime(input: {
  period: TimeWindow;
  ownership: TimeWindow[];
  businessHours: TimeWindow[];
  approvedExclusions: TimeWindow[];
}) {
  if (!validPeriod(input.period)) throw new Error("Invalid work period");
  const from = stamp(input.period.start),
    to = stamp(input.period.end);
  const owned = union(input.ownership, from, to),
    working = intersection(owned, union(input.businessHours, from, to));
  const excluded = intersection(working, union(input.approvedExclusions, from, to));
  return {
    elapsedOwnedMinutes: minutes(owned),
    businessMinutes: minutes(working),
    excludedMinutes: minutes(excluded),
    assessedMinutes: minutes(working) - minutes(excluded),
  };
}

/** Team rates pool underlying outcomes; never average member percentages or scores. */
export function pooledRate(samples: { numerator: number; denominator: number }[]) {
  if (
    samples.some(
      (s) =>
        !nonnegativeInteger(s.numerator) ||
        !nonnegativeInteger(s.denominator) ||
        s.numerator > s.denominator,
    )
  )
    throw new Error("Invalid outcome counts");
  const numerator = samples.reduce((n, s) => n + s.numerator, 0),
    denominator = samples.reduce((n, s) => n + s.denominator, 0);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator))
    throw new Error("Outcome counts exceed safe precision");
  return { numerator, denominator, value: denominator ? numerator / denominator : null };
}
