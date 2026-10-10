import {
  canCollectWork,
  WORK_COLLECTORS,
  type WorkCollectionKind,
} from "./learn-work-collection.ts";
import {
  validateScorecardPolicy,
  type ScorecardPolicy,
  type ScorePeriod,
} from "./learn-scorecards.ts";
export type WorkCollectionRequest = {
  tenantId: string;
  actorId: string;
  requestId: string;
  kind: WorkCollectionKind;
  subjectId: string;
  policyId: string;
  policyVersion: number;
  period: ScorePeriod;
  reason: string;
};
export type WorkCollectionProgress = {
  contract: "work-collection@1";
  tenantId: string;
  actorId: string;
  requestId: string;
  kind: WorkCollectionKind;
  subjectId: string;
  policyId: string;
  policyVersion: number;
  period: ScorePeriod;
  state: "collecting" | "completed" | "abandoned" | "superseded";
  population: number;
  processed: number;
  eligible: number;
  covered: number;
  snapshotAt: string;
  measurementId: string | null;
  endReason: string | null;
};
export type WorkCollectionClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const integer = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const instant = (v: unknown): v is string =>
  typeof v === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const sameTime = (a: unknown, b: string) => instant(a) && Date.parse(a) === Date.parse(b);
export function validateWorkCollectionRequest(r: WorkCollectionRequest) {
  if (
    !r ||
    ![r.tenantId, r.actorId, r.requestId, r.subjectId, r.policyId].every(uuid) ||
    !Object.hasOwn(WORK_COLLECTORS, r.kind) ||
    !integer(r.policyVersion) ||
    r.policyVersion < 1 ||
    !instant(r.period?.start) ||
    !instant(r.period?.end) ||
    Date.parse(r.period.start) >= Date.parse(r.period.end) ||
    Date.parse(r.period.end) > Date.now() ||
    Date.parse(r.period.end) - Date.parse(r.period.start) > 366 * 86400000 ||
    typeof r.reason !== "string" ||
    !r.reason.trim() ||
    r.reason.length > 1000
  )
    throw Error("Invalid collection request");
}
export function createWorkCollectionRequest(input: {
  policy: ScorecardPolicy;
  actorId: string;
  subjectId: string;
  kind: WorkCollectionKind;
  period: ScorePeriod;
  requestId: string;
  reason: string;
}): WorkCollectionRequest {
  const { policy, kind } = input;
  if (
    validateScorecardPolicy(policy).length ||
    !canCollectWork(policy, kind) ||
    (policy.subjectKind === "team" && policy.groupId !== null && policy.groupId !== input.subjectId)
  )
    throw Error("Choose saved rules covering this collection");
  const r = {
    tenantId: policy.tenantId,
    actorId: input.actorId,
    requestId: input.requestId,
    kind,
    subjectId: input.subjectId,
    policyId: policy.id,
    policyVersion: policy.version,
    period: { start: input.period.start, end: input.period.end },
    reason: input.reason.trim(),
  };
  validateWorkCollectionRequest(r);
  return r;
}
export function parseWorkCollectionProgress(
  data: unknown,
  r: WorkCollectionRequest,
  previous?: WorkCollectionProgress,
): WorkCollectionProgress {
  validateWorkCollectionRequest(r);
  const d = data as WorkCollectionProgress;
  if (
    !d ||
    d.contract !== "work-collection@1" ||
    ["tenantId", "actorId", "requestId", "kind", "subjectId", "policyId", "policyVersion"].some(
      (k) => (d as any)[k] !== (r as any)[k],
    ) ||
    !sameTime(d.period?.start, r.period.start) ||
    !sameTime(d.period?.end, r.period.end) ||
    !instant(d.snapshotAt) ||
    Date.parse(d.snapshotAt) < Date.parse(r.period.end) ||
    !["collecting", "completed", "abandoned", "superseded"].includes(d.state) ||
    ![d.population, d.processed, d.eligible, d.covered].every(integer) ||
    d.processed > d.population ||
    d.eligible > d.processed ||
    d.covered > d.eligible ||
    (d.state === "completed"
      ? d.measurementId !== r.requestId || d.processed !== d.population
      : d.measurementId !== null) ||
    (["abandoned", "superseded"].includes(d.state)
      ? typeof d.endReason !== "string" || !d.endReason.trim()
      : d.endReason !== null)
  )
    throw Error(
      "Collection response could not be verified. Keep this request and check its status.",
    );
  if (previous) {
    parseWorkCollectionProgress(previous, r);
    if (
      d.population !== previous.population ||
      !sameTime(d.snapshotAt, previous.snapshotAt) ||
      d.processed < previous.processed ||
      d.eligible < previous.eligible ||
      d.covered < previous.covered ||
      (previous.state !== "collecting" &&
        ["state", "processed", "eligible", "covered", "measurementId", "endReason"].some(
          (key) => (d as any)[key] !== (previous as any)[key],
        ))
    )
      throw Error("Collection checkpoint changed. Keep this request and check its status.");
  }
  return d;
}
function rpcError(error: any): Error {
  return Error(
    error?.code === "42501"
      ? "Your access does not allow this collection. The retained request has not been replaced."
      : ["PT409", "40001"].includes(error?.code)
        ? "A collection or observation already exists, or its checkpoint changed. Refresh its status before continuing."
        : error?.code === "54000"
          ? "An individual source history exceeds the supported evidence limit. No partial observation was saved."
          : "Collection could not be confirmed. Keep this request and check its status before continuing.",
  );
}
export async function beginWorkCollection(db: WorkCollectionClient, r: WorkCollectionRequest) {
  validateWorkCollectionRequest(r);
  const { data, error } = await db.rpc("learn_work_collection_begin", {
    p_tenant: r.tenantId,
    p_kind: r.kind,
    p_subject: r.subjectId,
    p_policy: r.policyId,
    p_revision: r.policyVersion,
    p_start: r.period.start,
    p_end: r.period.end,
    p_request: r.requestId,
    p_reason: r.reason,
  });
  if (error) throw rpcError(error);
  return parseWorkCollectionProgress(data, r);
}
export async function readWorkCollectionProgress(
  db: WorkCollectionClient,
  r: WorkCollectionRequest,
  previous?: WorkCollectionProgress,
) {
  validateWorkCollectionRequest(r);
  const { data, error } = await db.rpc("learn_work_collection_status", {
    p_tenant: r.tenantId,
    p_request: r.requestId,
  });
  if (error) throw rpcError(error);
  return parseWorkCollectionProgress(data, r, previous);
}
export async function advanceWorkCollection(
  db: WorkCollectionClient,
  r: WorkCollectionRequest,
  previous: WorkCollectionProgress,
) {
  parseWorkCollectionProgress(previous, r);
  if (previous.state !== "collecting") return previous;
  const { data, error } = await db.rpc("learn_work_collection_step", {
    p_tenant: r.tenantId,
    p_request: r.requestId,
    p_after: previous.processed,
  });
  if (error) throw rpcError(error);
  return parseWorkCollectionProgress(data, r, previous);
}
export async function abandonWorkCollection(
  db: WorkCollectionClient,
  r: WorkCollectionRequest,
  reason: string,
  previous?: WorkCollectionProgress,
) {
  validateWorkCollectionRequest(r);
  if (typeof reason !== "string" || !reason.trim() || reason.length > 1000)
    throw Error("Add a reason for ending this collection");
  const { data, error } = await db.rpc("learn_work_collection_abandon", {
    p_tenant: r.tenantId,
    p_kind: r.kind,
    p_subject: r.subjectId,
    p_policy: r.policyId,
    p_revision: r.policyVersion,
    p_start: r.period.start,
    p_end: r.period.end,
    p_request: r.requestId,
    p_reason: r.reason,
    p_end_reason: reason.trim(),
  });
  if (error) throw rpcError(error);
  const result = parseWorkCollectionProgress(data, r, previous);
  if (
    result.state === "collecting" ||
    (result.state === "abandoned" && result.endReason !== reason.trim())
  )
    throw Error("Ending this collection could not be confirmed");
  return result;
}
export type WorkEvidencePart = "overview" | "membership" | "teams" | "items";
export async function readWorkCollectionEvidence(
  db: WorkCollectionClient,
  tenantId: string,
  requestId: string,
  part: WorkEvidencePart,
  after = 0,
) {
  if (
    !uuid(tenantId) ||
    !uuid(requestId) ||
    !["overview", "membership", "teams", "items"].includes(part) ||
    !integer(after) ||
    (part !== "items" && after !== 0)
  )
    throw Error("Invalid evidence page");
  const { data: d, error } = await db.rpc("learn_work_collection_evidence", {
    p_tenant: tenantId,
    p_request: requestId,
    p_part: part,
    p_after: after,
  });
  if (error) throw Error("Retained collection evidence is unavailable with your current access");
  if (
    !d ||
    d.contract !== "work-collection-evidence@1" ||
    d.tenantId !== tenantId ||
    d.runId !== requestId ||
    d.part !== part
  )
    throw Error("Evidence scope could not be verified");
  if (part === "items") {
    if (
      !integer(d.population) ||
      after > d.population ||
      d.after !== after ||
      !Array.isArray(d.items) ||
      d.items.length > 100 ||
      (!d.items.length && after < d.population)
    )
      throw Error("Evidence page is incomplete");
    for (let n = 0; n < d.items.length; n++) {
      const item = d.items[n],
        proof = item?.result;
      if (
        item?.ordinal !== after + n + 1 ||
        !uuid(item?.object_id) ||
        typeof item.head_reconciled !== "boolean" ||
        !(
          item.head_sequence === null ||
          (typeof item.head_sequence === "string" && /^\d+$/.test(item.head_sequence))
        ) ||
        !proof ||
        proof.objectId !== item.object_id ||
        typeof proof.eligible !== "boolean" ||
        typeof proof.complete !== "boolean" ||
        typeof proof.knownValue !== "number" ||
        !Number.isFinite(proof.knownValue) ||
        proof.knownValue < 0 ||
        !Array.isArray(proof.eventIds) ||
        !proof.eventIds.every(uuid) ||
        !Array.isArray(proof.credited)
      )
        throw Error("Retained item proof could not be verified");
    }
    const end = after + d.items.length;
    if (end > d.population || (end === d.population ? d.next !== null : d.next !== end))
      throw Error("Evidence continuation could not be verified");
  } else if (part === "overview") {
    if (
      !d.policy ||
      validateScorecardPolicy(d.policy).length > 0 ||
      d.policy.tenantId !== tenantId ||
      !uuid(d.subject?.id) ||
      d.subject.kind !== d.policy.subjectKind ||
      !instant(d.period?.start) ||
      !instant(d.period?.end) ||
      Date.parse(d.period.start) >= Date.parse(d.period.end) ||
      !Object.hasOwn(WORK_COLLECTORS, d.proof?.kind ?? "") ||
      d.sourceSystem !== WORK_COLLECTORS[d.proof.kind as WorkCollectionKind]?.source ||
      d.metricKey !== WORK_COLLECTORS[d.proof.kind as WorkCollectionKind]?.metric ||
      d.subject.kind !== WORK_COLLECTORS[d.proof.kind as WorkCollectionKind]?.subjectKind ||
      d.proof?.contract !== "work-collection@1" ||
      d.proof.runId !== requestId ||
      !integer(d.proof.itemCount) ||
      d.proof.itemCount !== d.proof.populationCount ||
      d.proof.processed !== d.proof.populationCount ||
      !instant(d.observedAt) ||
      typeof d.explanation !== "string" ||
      typeof d.sourceSystem !== "string" ||
      typeof d.metricKey !== "string"
    )
      throw Error("Completed evidence overview could not be verified");
  } else if (
    !instant(d.snapshotAt) ||
    (part === "membership"
      ? d.data?.contract !== "member-capture@1" ||
        d.data.tenantId !== tenantId ||
        !Array.isArray(d.data.members)
      : !Array.isArray(d.data))
  )
    throw Error("Frozen identity evidence could not be verified");
  return d;
}
