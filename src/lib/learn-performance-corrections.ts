import type { LearnReadClient } from "./learn-cards.ts";
import type { PerformanceMeasurement } from "./learn-scorecards.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const numberOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const stamp = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
export interface PerformanceCorrection {
  id: string;
  tenant_id: string;
  predecessor_id: string;
  previous_value: number | null;
  corrected_value: number | null;
  source_observed_at: string;
  expected_review_revision: number;
  corrected_by: string;
  reason: string;
  created_at: string;
}
export type CorrectedPerformanceMeasurement = PerformanceMeasurement & {
  correction?: PerformanceCorrection;
};
export async function attachPerformanceCorrections(
  db: LearnReadClient,
  tenant: string,
  measurements: PerformanceMeasurement[],
  markers: Map<string, string>,
): Promise<CorrectedPerformanceMeasurement[]> {
  if (
    !uuid(tenant) ||
    measurements.length > 500 ||
    [...markers].some(([id, marker]) => !uuid(id) || id !== marker)
  )
    throw Error("Invalid correction scope");
  const measurementIds = new Set(measurements.map((m) => m.id));
  if (
    measurementIds.size !== measurements.length ||
    measurements.some((m) => m.tenantId !== tenant) ||
    [...markers.keys()].some((id) => !measurementIds.has(id))
  )
    throw Error("Invalid correction scope");
  const ids = [...markers.keys()],
    rows: PerformanceCorrection[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const { data, error, count } = await db
      .from("learn_performance_corrections")
      .select(
        "id,tenant_id,predecessor_id,previous_value,corrected_value,source_observed_at,expected_review_revision,corrected_by,reason,created_at",
        { count: "exact" },
      )
      .eq("tenant_id", tenant)
      .in("id", batch)
      .limit(101);
    if (error || !Array.isArray(data) || count !== batch.length || data.length !== count)
      throw Error("Complete numerical correction history could not be read");
    rows.push(...(data as PerformanceCorrection[]));
  }
  return parsePerformanceCorrections(tenant, measurements, markers, rows);
}
export function parsePerformanceCorrections(
  tenant: string,
  measurements: PerformanceMeasurement[],
  markers: Map<string, string>,
  rows: PerformanceCorrection[],
): CorrectedPerformanceMeasurement[] {
  const corrections = new Map<string, PerformanceCorrection>(),
    batch = [...markers.keys()];
  if (!Array.isArray(rows) || rows.length !== batch.length)
    throw Error("Complete numerical correction history could not be read");
  for (const r of rows) {
    if (
      !r ||
      !batch.includes(r.id) ||
      corrections.has(r.id) ||
      r.tenant_id !== tenant ||
      !uuid(r.predecessor_id) ||
      !uuid(r.corrected_by) ||
      !numberOrNull(r.previous_value) ||
      !numberOrNull(r.corrected_value) ||
      r.previous_value === r.corrected_value ||
      !Number.isSafeInteger(r.expected_review_revision) ||
      r.expected_review_revision < 0 ||
      r.expected_review_revision >= 2147483647 ||
      typeof r.reason !== "string" ||
      !r.reason.trim() ||
      r.reason.length > 1000 ||
      !Number.isFinite(stamp(r.source_observed_at)) ||
      !Number.isFinite(stamp(r.created_at)) ||
      stamp(r.source_observed_at) > stamp(r.created_at)
    )
      throw Error("Numerical correction history failed validation");
    corrections.set(r.id, r);
  }
  return resolvePerformanceCorrections(measurements, corrections);
}
function resolvePerformanceCorrections(
  measurements: PerformanceMeasurement[],
  corrections: Map<string, PerformanceCorrection>,
): CorrectedPerformanceMeasurement[] {
  const byId = new Map(measurements.map((m) => [m.id, m])),
    resolved = new Map<string, CorrectedPerformanceMeasurement>(),
    visiting = new Set<string>();
  function resolve(m: PerformanceMeasurement): CorrectedPerformanceMeasurement {
    const existing = resolved.get(m.id);
    if (existing) return existing;
    if (visiting.has(m.id)) throw Error("Correction history contains a cycle");
    visiting.add(m.id);
    const c = corrections.get(m.id);
    let result: CorrectedPerformanceMeasurement = m;
    if (c) {
      const parent = byId.get(c.predecessor_id);
      if (
        !parent ||
        m.supersedes !== parent.id ||
        c.corrected_value !== m.value ||
        c.previous_value !== parent.value ||
        stamp(c.created_at) !== stamp(m.observedAt) ||
        stamp(parent.observedAt) >= stamp(m.observedAt) ||
        [
          "tenantId",
          "policyId",
          "policyVersion",
          "metricKey",
          "unit",
          "sourceSystem",
          "sampleCount",
          "coveredCount",
          "eligibleCount",
        ].some((k) => (m as any)[k] !== (parent as any)[k]) ||
        (stamp(m.sourceThrough) !== stamp(parent.sourceThrough) &&
          !(m.sourceThrough === null && parent.sourceThrough === null)) ||
        ["subject", "period", "evidence", "exclusions"].some(
          (k) => JSON.stringify((m as any)[k]) !== JSON.stringify((parent as any)[k]),
        )
      )
        throw Error("Correction differs from its retained source observation");
      const original = resolve(parent);
      if (stamp(c.source_observed_at) !== stamp(original.sourceObservedAt ?? original.observedAt))
        throw Error("Correction changed source freshness");
      result = { ...m, sourceObservedAt: c.source_observed_at, correction: c };
    }
    visiting.delete(m.id);
    resolved.set(m.id, result);
    return result;
  }
  return measurements.map(resolve);
}
export interface CorrectionRequest {
  tenantId: string;
  measurementId: string;
  requestId: string;
  expectedReviewRevision: number;
  value: number | null;
  reason: string;
}
export async function correctPerformanceMeasurement(
  db: {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: any; error: { code?: string } | null }>;
  },
  request: CorrectionRequest,
) {
  validateCorrectionRequest(request);
  const { data, error } = await db.rpc("learn_performance_correct", {
    p_tenant: request.tenantId,
    p_measurement: request.measurementId,
    p_request: request.requestId,
    p_expected_review_revision: request.expectedReviewRevision,
    p_value: request.value,
    p_reason: request.reason.trim(),
  });
  if (error)
    throw Error(
      ["PT409", "40001"].includes(error.code ?? "")
        ? "This observation or review changed. Reload before correcting it."
        : error.code === "42501"
          ? "Only a company owner or admin outside preview can correct evidence."
          : "Correction was not confirmed. Retry the same request to avoid duplicates.",
    );
  if (
    !data ||
    data.measurementId !== request.requestId ||
    data.predecessorId !== request.measurementId ||
    typeof data.reused !== "boolean"
  )
    throw Error("Correction receipt could not be verified. Retry the same request.");
  return data as { measurementId: string; predecessorId: string; reused: boolean };
}

export function validateCorrectionRequest(request: CorrectionRequest) {
  if (
    !uuid(request.tenantId) ||
    !uuid(request.measurementId) ||
    !uuid(request.requestId) ||
    !Number.isSafeInteger(request.expectedReviewRevision) ||
    request.expectedReviewRevision < 0 ||
    request.expectedReviewRevision >= 2147483647 ||
    !numberOrNull(request.value) ||
    typeof request.reason !== "string" ||
    !request.reason.trim() ||
    request.reason.trim().length > 1000
  )
    throw Error("A valid corrected value or withheld value and reason are required");
}
