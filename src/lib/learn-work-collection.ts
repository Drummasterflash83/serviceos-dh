import {
  validateScorecardPolicy,
  type ScorecardPolicy,
  type ScorePeriod,
} from "./learn-scorecards.ts";
export const HANDOFF_METRIC = "work.recorded_handoffs";
export const HANDOFF_SOURCE = "serviceos.work.handoffs@1";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function canCollectWorkHandoffs(policy: ScorecardPolicy) {
  return (
    policy.subjectKind === "member" &&
    !policy.groupId &&
    policy.metrics.some(
      (m) =>
        m.key === HANDOFF_METRIC &&
        m.unit === "handoffs" &&
        m.sourceSystems.includes(HANDOFF_SOURCE),
    )
  );
}
export async function collectWorkHandoffs(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> },
  input: {
    policy: ScorecardPolicy;
    memberId: string;
    period: ScorePeriod;
    requestId: string;
    reason: string;
  },
) {
  const { policy, memberId, period, requestId, reason } = input;
  const start = Date.parse(period.start),
    end = Date.parse(period.end);
  if (
    validateScorecardPolicy(policy).length ||
    !canCollectWorkHandoffs(policy) ||
    !uuid(memberId) ||
    !uuid(requestId) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    end > Date.now() ||
    end - start > 366 * 86400000 ||
    !reason.trim() ||
    reason.length > 1000
  )
    throw Error("Choose a supported policy, completed period and collection reason");
  const { data, error } = await db.rpc("learn_work_handoffs_collect", {
    p_tenant: policy.tenantId,
    p_member: memberId,
    p_policy: policy.id,
    p_revision: policy.version,
    p_start: new Date(start).toISOString(),
    p_end: new Date(end).toISOString(),
    p_request: requestId,
    p_reason: reason.trim(),
  });
  if (error)
    throw Error(
      error.code === "40001"
        ? "An observation or request already exists. Refresh and review it before retrying."
        : error.code === "54000"
          ? "This collection exceeds the supported evidence limit. No partial observation was saved."
          : "Work evidence could not be collected. Check access and capture availability, then retry this request.",
    );
  if (!data || data.measurementId !== requestId || typeof data.reused !== "boolean")
    throw Error(
      "Collection acknowledgement could not be verified. Refresh before retrying this request.",
    );
  return { measurementId: data.measurementId as string, reused: data.reused as boolean };
}
