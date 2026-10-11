import { WORK_COLLECTORS } from "../../src/lib/learn-work-collection.ts";
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function fixture(kind = "handoffs", legacy = false, n = 10) {
  const spec = WORK_COLLECTORS[kind],
    table = legacy
      ? spec.subjectKind === "team"
        ? "learn_team_work_measurement_runs"
        : "learn_work_measurement_runs"
      : "learn_work_collection_runs";
  const m = {
    id: id(n),
    tenantId: id(1),
    policyId: id(2),
    policyVersion: 1,
    subject: { kind: spec.subjectKind, id: id(3) },
    period: { start: "2026-10-01T00:00:00.000001Z", end: "2026-10-02T00:00:00.000001Z" },
    metricKey: spec.metric,
    unit: spec.unit,
    value: 20,
    sourceSystem: spec.source,
    sourceThrough: "2026-10-03T00:00:00.000123Z",
    observedAt: "2026-10-03T00:00:01.000456Z",
    sampleCount: 2,
    coveredCount: 2,
    eligibleCount: 2,
    review: "inferred",
    evidence: [{ table, id: id(n) }],
    exclusions: [],
  };
  const r = {
    id: m.id,
    tenant_id: m.tenantId,
    subject_id: m.subject.id,
    policy_id: m.policyId,
    policy_revision: 1,
    window_start: m.period.start,
    window_end: m.period.end,
    observed_at: m.observedAt,
    source_system: spec.source,
    metric_key: spec.metric,
    receipt_contract: legacy
      ? kind === "handoffs"
        ? "work-handoffs@1"
        : kind === "residence"
          ? "work-residence@1"
          : "team-work-residence@1"
      : "work-collection@1",
    receipt_value: 20,
    receipt_covered: 2,
    receipt_eligible: 2,
    ...(legacy
      ? { request_subject: m.subject.id }
      : {
          subject_kind: spec.subjectKind,
          unit: spec.unit,
          state: "completed",
          kind,
          snapshot_at: m.sourceThrough,
          population: 3,
          processed: 3,
          receipt_run_id: m.id,
          receipt_kind: kind,
          receipt_population: 3,
          receipt_processed: 3,
          receipt_items: 3,
        }),
  };
  const raw = {
    id: m.id,
    tenant_id: m.tenantId,
    source_system: spec.source,
    metric_key: spec.metric,
    observed_at: m.observedAt,
    proof: {
      contract: r.receipt_contract,
      value: 20,
      coveredItems: 2,
      eligibleItems: 2,
      ...(!legacy ? { kind, runId: m.id, populationCount: 3, processed: 3, itemCount: 3 } : {}),
    },
    ...(legacy
      ? {
          [spec.subjectKind === "team" ? "team_id" : "member_id"]: m.subject.id,
          request: {
            [spec.subjectKind === "team" ? "teamId" : "memberId"]: m.subject.id,
            policyId: m.policyId,
            policyVersion: 1,
            start: m.period.start,
            end: m.period.end,
          },
        }
      : {
          subject_id: m.subject.id,
          subject_kind: spec.subjectKind,
          policy_id: m.policyId,
          policy_revision: 1,
          window_start: m.period.start,
          window_end: m.period.end,
          unit: spec.unit,
          state: "completed",
          kind,
          snapshot_at: m.sourceThrough,
          population: 3,
          processed: 3,
        }),
  };
  return { m, r, raw, table };
}
export const fixtures = [
  ...Object.keys(WORK_COLLECTORS).map((k, i) => fixture(k, false, 10 + i)),
  ...["handoffs", "residence", "teamResidence"].map((k, i) => fixture(k, true, 20 + i)),
];
