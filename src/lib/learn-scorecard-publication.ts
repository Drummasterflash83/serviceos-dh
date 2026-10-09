import {
  validateScorecardPolicy,
  type ScorecardPolicy,
  type ScorePeriod,
  type ScoreSubject,
} from "./learn-scorecards.ts";
import type { ScorecardSettingsClient } from "./learn-scorecard-settings.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export type PublicationReceipt = {
  publicationId: string;
  policyId: string;
  revision: number;
  effectiveFrom: string;
  reused: boolean;
};
export async function publishScorecard(
  db: ScorecardSettingsClient,
  input: { policy: ScorecardPolicy; requestId: string; reason: string },
): Promise<PublicationReceipt> {
  const { policy, requestId, reason } = input;
  if (
    policy.status !== "draft" ||
    validateScorecardPolicy(policy).length ||
    !uuid(requestId) ||
    !reason.trim() ||
    reason.length > 1000
  )
    throw Error("A valid saved draft and publication reason are required");
  const { data, error } = await db.rpc("learn_scorecard_publish", {
    p_tenant: policy.tenantId,
    p_policy: policy.id,
    p_revision: policy.version,
    p_request: requestId,
    p_reason: reason.trim(),
  });
  if (error)
    throw Error(
      ["PT409", "40001"].includes(error.code ?? "")
        ? "Rules changed or this revision was already published. Reload before publishing."
        : "Rules could not be published. Check access and retry the same request.",
    );
  const r = data as PublicationReceipt;
  if (
    !r ||
    r.publicationId !== requestId ||
    r.policyId !== policy.id ||
    r.revision !== policy.version ||
    !Number.isFinite(Date.parse(r.effectiveFrom)) ||
    typeof r.reused !== "boolean"
  )
    throw Error("Publication receipt could not be verified. Reload before retrying.");
  return r;
}
export async function loadRevisionPublication(
  db: ScorecardSettingsClient,
  policy: ScorecardPolicy,
): Promise<string | null> {
  const { data, error } = await db
    .from("learn_scorecard_publications")
    .select("id,tenant_id,policy_id,revision,effective_from")
    .eq("tenant_id", policy.tenantId)
    .eq("policy_id", policy.id)
    .eq("revision", policy.version)
    .limit(2);
  if (error || !Array.isArray(data) || data.length > 1)
    throw Error("Publication history could not be read");
  if (!data.length) return null;
  const r = data[0];
  if (
    !uuid(r.id) ||
    r.tenant_id !== policy.tenantId ||
    r.policy_id !== policy.id ||
    r.revision !== policy.version ||
    !Number.isFinite(Date.parse(r.effective_from))
  )
    throw Error("Publication history differs from the saved revision");
  return r.effective_from;
}
export async function loadPublishedScorecard(
  db: ScorecardSettingsClient,
  tenantId: string,
  kind: ScoreSubject["kind"],
  groupId: string | null,
  period: ScorePeriod,
): Promise<ScorecardPolicy | null> {
  const start = Date.parse(period.start),
    end = Date.parse(period.end);
  if (
    !uuid(tenantId) ||
    !["member", "team", "job", "customer"].includes(kind) ||
    (groupId !== null && !uuid(groupId)) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    end - start > 366 * 86400000
  )
    throw Error("Invalid published-policy scope");
  const { data, error } = await db.rpc("learn_scorecard_policy_for_period", {
    p_tenant: tenantId,
    p_kind: kind,
    p_group: groupId,
    p_start: new Date(start).toISOString(),
    p_end: new Date(end).toISOString(),
  });
  if (error)
    throw Error(
      error.code === "22023"
        ? "This period crosses a rule change or is invalid. Choose a period covered by one revision."
        : "Published rules could not be read with your current access",
    );
  if (data === null) return null;
  const p = data as ScorecardPolicy;
  if (
    !p ||
    validateScorecardPolicy(p).length ||
    p.tenantId !== tenantId ||
    p.subjectKind !== kind ||
    (p.groupId ?? null) !== groupId ||
    p.status !== "published" ||
    !p.publication ||
    Date.parse(p.publication.effectiveFrom) > start ||
    (p.publication.effectiveUntil !== null && Date.parse(p.publication.effectiveUntil) < end)
  )
    throw Error("Published rules do not cover this exact assessment scope");
  return p;
}
