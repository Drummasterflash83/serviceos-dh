import type { LearnReadClient } from "./learn-cards.ts";
import {
  parseMeasurementSnapshot,
  type ReviewedPerformanceMeasurement,
} from "./learn-performance-measurements.ts";
import {
  evaluateScorecardV1,
  validateScorecardPolicy,
  type ScorecardPolicy,
  type ScoreSubject,
  type ScorePeriod,
} from "./learn-scorecards.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const stamp = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
export type AssessmentSummary = {
  id: string;
  tenant_id: string;
  publication_id: string;
  subject_kind: ScoreSubject["kind"];
  subject_id: string;
  window_start: string;
  window_end: string;
  recorded_at: string;
  recorded_by: string;
  reason: string;
};
const columns =
  "id,tenant_id,publication_id,subject_kind,subject_id,window_start,window_end,recorded_at,recorded_by,reason";
function validateSummary(
  r: any,
  tenant: string,
  subject: ScoreSubject,
): asserts r is AssessmentSummary {
  if (
    !r ||
    !uuid(r.id) ||
    r.tenant_id !== tenant ||
    !uuid(r.publication_id) ||
    !uuid(r.recorded_by) ||
    r.subject_kind !== subject.kind ||
    r.subject_id !== subject.id ||
    !Number.isFinite(stamp(r.window_start)) ||
    !(stamp(r.window_end) > stamp(r.window_start)) ||
    !(stamp(r.recorded_at) >= stamp(r.window_end)) ||
    typeof r.reason !== "string" ||
    !r.reason.trim() ||
    r.reason.length > 1000
  )
    throw Error("Saved assessment identity could not be verified");
}
/** Version 1 deliberately evaluates at its retained time, never today's clock.
 * Future engine changes must retain this version's semantics or use a new engine identifier.
 */
export function parseSavedAssessment(row: any, tenant: string, subject: ScoreSubject) {
  validateSummary(row, tenant, subject);
  const s = (row as any).snapshot;
  if (
    !s ||
    s.version !== "learn-assessment/1" ||
    s.engine !== "learn-scorecards/1" ||
    Object.keys(s).some(
      (k) =>
        ![
          "version",
          "engine",
          "policy",
          "subject",
          "period",
          "assessedAt",
          "measurements",
          "reviews",
          "corrections",
        ].includes(k),
    ) ||
    !s.policy ||
    validateScorecardPolicy(s.policy).length ||
    s.policy.status !== "published" ||
    s.policy.tenantId !== tenant ||
    s.policy.publication.id !== row.publication_id ||
    s.subject?.kind !== subject.kind ||
    s.subject?.id !== subject.id ||
    !Array.isArray(s.subject.groupIds) ||
    JSON.stringify(s.subject.groupIds) !==
      JSON.stringify(s.policy.groupId ? [s.policy.groupId] : []) ||
    stamp(s.period?.start) !== stamp(row.window_start) ||
    stamp(s.period?.end) !== stamp(row.window_end) ||
    stamp(s.assessedAt) !== stamp(row.recorded_at) ||
    !Array.isArray(s.measurements) ||
    !Array.isArray(s.reviews) ||
    !Array.isArray(s.corrections) ||
    new TextEncoder().encode(JSON.stringify(s)).length > 2097152
  )
    throw Error("Saved assessment snapshot could not be verified");
  const rows = parseMeasurementSnapshot(
    s.policy,
    s.subject,
    s.period,
    s.measurements,
    s.reviews,
    s.corrections,
  );
  if (
    rows.some((m) => stamp(m.observedAt) > stamp(s.assessedAt)) ||
    s.reviews.some((r: any) => stamp(r.created_at) > stamp(s.assessedAt))
  )
    throw Error("Saved assessment contains later evidence");
  return {
    summary: row as AssessmentSummary,
    policy: s.policy as ScorecardPolicy,
    rows,
    score: evaluateScorecardV1(s.policy, s.subject, s.period, rows, stamp(s.assessedAt)),
  };
}
export type SavedAssessment = ReturnType<typeof parseSavedAssessment>;
export const ASSESSMENT_HISTORY_PAGE_SIZE = 20;
export type AssessmentHistoryCursor = {
  tenantId: string;
  subjectKind: ScoreSubject["kind"];
  subjectId: string;
  recordedAt: string;
  id: string;
};
// PostgreSQL timestamps retain microseconds. Converting the cursor to JS Date
// would collapse distinct saves and could skip rows at a page boundary.
function recordedMicros(value: string): bigint {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  const seconds = m ? Date.parse(m[1] + m[3]) : NaN;
  if (!m || !Number.isFinite(seconds) || new Date(m[1] + "Z").toISOString().slice(0, 19) !== m[1])
    throw Error("Assessment history position could not be verified");
  return BigInt(seconds) * 1000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}
function olderThan(a: { recorded_at: string; id: string }, b: { recorded_at: string; id: string }) {
  const at = recordedMicros(a.recorded_at),
    bt = recordedMicros(b.recorded_at);
  return at < bt || (at === bt && a.id.toLowerCase() < b.id.toLowerCase());
}
export async function loadAssessmentHistory(
  db: LearnReadClient,
  tenant: string,
  subject: ScoreSubject,
  after: AssessmentHistoryCursor | null = null,
) {
  if (
    !uuid(tenant) ||
    !uuid(subject?.id) ||
    !["member", "team", "job", "customer"].includes(subject.kind)
  )
    throw Error("Invalid assessment history scope");
  if (
    after &&
    (after.tenantId !== tenant ||
      after.subjectKind !== subject.kind ||
      after.subjectId !== subject.id ||
      !uuid(after.id))
  )
    throw Error("Assessment history position belongs to another card");
  if (after) recordedMicros(after.recordedAt);
  let query = db
    .from("learn_assessments")
    .select(columns, { count: "exact" })
    .eq("tenant_id", tenant)
    .eq("subject_kind", subject.kind)
    .eq("subject_id", subject.id);
  if (after)
    query = query.or(
      `recorded_at.lt.${after.recordedAt},and(recorded_at.eq.${after.recordedAt},id.lt.${after.id})`,
    );
  const { data, error, count } = await query
    .order("recorded_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ASSESSMENT_HISTORY_PAGE_SIZE);
  if (
    error ||
    !Array.isArray(data) ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    data.length !== Math.min(ASSESSMENT_HISTORY_PAGE_SIZE, count) ||
    new Set(data.map((r: any) => r.id)).size !== data.length
  )
    throw Error("Saved assessment history could not be read");
  let previous = after ? { id: after.id, recorded_at: after.recordedAt } : null;
  for (const row of data) {
    validateSummary(row, tenant, subject);
    recordedMicros(row.recorded_at);
    if (previous && !olderThan(row, previous))
      throw Error("Assessment history order could not be verified");
    previous = row;
  }
  const last = data.at(-1) as AssessmentSummary | undefined;
  const nextCursor: AssessmentHistoryCursor | null =
    last && count > data.length
      ? {
          tenantId: tenant,
          subjectKind: subject.kind,
          subjectId: subject.id,
          recordedAt: last.recorded_at,
          id: last.id,
        }
      : null;
  return { rows: data as AssessmentSummary[], total: count as number, nextCursor };
}
export async function loadSavedAssessment(
  db: LearnReadClient,
  tenant: string,
  subject: ScoreSubject,
  id: string,
): Promise<SavedAssessment> {
  if (!uuid(tenant) || !uuid(subject?.id) || !uuid(id))
    throw Error("Invalid saved assessment scope");
  const { data, error } = await db
    .from("learn_assessments")
    .select(columns + ",snapshot")
    .eq("tenant_id", tenant)
    .eq("id", id)
    .limit(2);
  if (error || !Array.isArray(data) || data.length !== 1 || data[0].id !== id)
    throw Error("Saved assessment is unavailable with your current access");
  return parseSavedAssessment(data[0], tenant, subject);
}
export interface SaveAssessmentRequest {
  tenantId: string;
  requestId: string;
  publicationId: string;
  subject: ScoreSubject;
  groupId: string | null;
  period: ScorePeriod;
  expected: { id: string; reviewRevision: number }[];
  reason: string;
}
export function assessmentRequest(
  policy: ScorecardPolicy,
  subject: ScoreSubject,
  period: ScorePeriod,
  rows: ReviewedPerformanceMeasurement[],
  reason: string,
  requestId: string,
): SaveAssessmentRequest {
  if (
    validateScorecardPolicy(policy).length ||
    policy.status !== "published" ||
    !policy.publication ||
    subject.kind !== policy.subjectKind
  )
    throw Error("Only published-rule assessments can be retained");
  return {
    tenantId: policy.tenantId,
    requestId,
    publicationId: policy.publication.id,
    subject,
    groupId: policy.groupId ?? null,
    period,
    expected: rows
      .map((m) => ({ id: m.id, reviewRevision: m.reviews.at(-1)?.revision ?? 0 }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    reason: reason.trim(),
  };
}
export type AssessmentClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: any;
    error: { code?: string } | null;
  }>;
};
export function validateAssessmentRequest(r: SaveAssessmentRequest) {
  if (
    !r ||
    !uuid(r.tenantId) ||
    !uuid(r.requestId) ||
    !uuid(r.publicationId) ||
    !uuid(r.subject?.id) ||
    !["member", "team", "job", "customer"].includes(r.subject.kind) ||
    !(r.groupId === null || uuid(r.groupId)) ||
    !Number.isFinite(stamp(r.period?.start)) ||
    !(stamp(r.period?.end) > stamp(r.period.start)) ||
    !Array.isArray(r.expected) ||
    r.expected.length > 500 ||
    new Set(r.expected.map((e) => e?.id)).size !== r.expected.length ||
    r.expected.some(
      (e) => !e || !uuid(e.id) || !Number.isSafeInteger(e.reviewRevision) || e.reviewRevision < 0,
    ) ||
    typeof r.reason !== "string" ||
    !r.reason.trim() ||
    r.reason.length > 1000
  )
    throw Error("A valid published assessment and reason are required");
}
export function assessmentArguments(r: SaveAssessmentRequest) {
  validateAssessmentRequest(r);
  return {
    p_tenant: r.tenantId,
    p_request: r.requestId,
    p_publication: r.publicationId,
    p_kind: r.subject.kind,
    p_subject: r.subject.id,
    p_group: r.groupId,
    p_start: new Date(r.period.start).toISOString(),
    p_end: new Date(r.period.end).toISOString(),
    p_expected: r.expected,
    p_reason: r.reason.trim(),
  };
}
export async function saveAssessment(db: AssessmentClient, r: SaveAssessmentRequest) {
  const { data, error } = await db.rpc("learn_assessment_save", assessmentArguments(r));
  if (error)
    throw Error(
      ["PT409", "40001"].includes(error.code ?? "")
        ? "Evidence or rules changed. Reload before saving a new assessment."
        : error.code === "42501"
          ? "Only a company owner or admin outside preview can save an assessment."
          : "Assessment save was not confirmed. Retry the same request.",
    );
  if (
    !data ||
    data.assessmentId !== r.requestId ||
    !Number.isFinite(stamp(data.recordedAt)) ||
    typeof data.reused !== "boolean"
  )
    throw Error("Assessment receipt could not be verified. Retry the same request.");
  return data as { assessmentId: string; recordedAt: string; reused: boolean };
}
