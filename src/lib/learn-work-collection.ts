import {
  validateScorecardPolicy,
  type ScorecardPolicy,
  type ScorePeriod,
} from "./learn-scorecards.ts";
export const HANDOFF_METRIC = "work.recorded_handoffs";
export const HANDOFF_SOURCE = "serviceos.work.handoffs@1";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export const RESIDENCE_METRIC = "work.owned_item_minutes";
export const RESIDENCE_SOURCE = "serviceos.work.residence@1";
export const WORK_COLLECTORS = {
  handoffs: {
    metric: HANDOFF_METRIC,
    unit: "handoffs",
    source: HANDOFF_SOURCE,
    rpc: "learn_work_handoffs_collect",
    title: "Collect recorded handoff evidence",
    description:
      "Count captured outgoing ownership transfers for this person. This does not measure speed or quality.",
    collected: "Recorded handoff evidence has been collected for this period.",
  },
  residence: {
    metric: RESIDENCE_METRIC,
    unit: "item_minutes",
    source: RESIDENCE_SOURCE,
    rpc: "learn_work_residence_collect",
    title: "Collect elapsed ownership evidence",
    description:
      "Add elapsed minutes for each owned item, including waiting and closed states. Two items held for an hour count as 120 item-minutes. This is not working hours or productivity; no business calendar or delay exclusion is applied.",
    collected: "Elapsed ownership evidence has been collected for this period.",
  },
} as const;
export type WorkCollectionKind = keyof typeof WORK_COLLECTORS;
export function canCollectWork(policy: ScorecardPolicy, kind: WorkCollectionKind) {
  const spec = WORK_COLLECTORS[kind];
  return (
    policy.subjectKind === "member" &&
    !policy.groupId &&
    policy.metrics.some(
      (m) => m.key === spec.metric && m.unit === spec.unit && m.sourceSystems.includes(spec.source),
    )
  );
}
export function canCollectWorkHandoffs(policy: ScorecardPolicy) {
  return canCollectWork(policy, "handoffs");
}
export async function collectWorkEvidence(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> },
  input: {
    kind?: WorkCollectionKind;
    policy: ScorecardPolicy;
    memberId: string;
    period: ScorePeriod;
    requestId: string;
    reason: string;
  },
) {
  const { policy, memberId, period, requestId, reason, kind = "handoffs" } = input;
  const spec = WORK_COLLECTORS[kind];
  const start = Date.parse(period.start),
    end = Date.parse(period.end);
  if (
    validateScorecardPolicy(policy).length ||
    !spec ||
    !canCollectWork(policy, kind) ||
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
  const { data, error } = await db.rpc(spec.rpc, {
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
      ["PT409", "40001"].includes(error.code ?? "")
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

export async function collectWorkHandoffs(
  db: Parameters<typeof collectWorkEvidence>[0],
  input: Omit<Parameters<typeof collectWorkEvidence>[1], "kind">,
) {
  return collectWorkEvidence(db, { ...input, kind: "handoffs" });
}
