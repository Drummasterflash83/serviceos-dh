import {
  validateScorecardPolicy,
  type ScorecardPolicy,
  type ScoreSubject,
} from "./learn-scorecards.ts";
import type { LearnReadClient } from "./learn-cards.ts";
export type ScorecardSettingsClient = LearnReadClient & {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};
export async function loadScorecardDraft(
  db: ScorecardSettingsClient,
  tenantId: string,
  kind: ScoreSubject["kind"],
  groupId: string | null,
): Promise<ScorecardPolicy | null> {
  const { data, error } = await db.rpc("learn_scorecard_read_draft", {
    p_tenant: tenantId,
    p_kind: kind,
    p_group: groupId,
  });
  if (error) throw new Error("Scoring rules could not be read");
  if (data === null) return null;
  const policy = data as ScorecardPolicy;
  if (
    policy?.tenantId !== tenantId ||
    policy?.subjectKind !== kind ||
    (policy.groupId ?? null) !== groupId ||
    policy.status !== "draft" ||
    validateScorecardPolicy(policy).length
  )
    throw new Error("Invalid scoring rules returned");
  return policy;
}
export async function saveScorecardDraft(
  db: ScorecardSettingsClient,
  policy: ScorecardPolicy,
  expectedVersion: number,
  reason: string,
): Promise<ScorecardPolicy> {
  const errors = validateScorecardPolicy(policy);
  if (
    errors.length ||
    !reason.trim() ||
    reason.length > 1000 ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  )
    throw new Error(errors[0] ?? "A change reason and valid revision are required");
  const { data, error } = await db.rpc("learn_scorecard_save_draft", {
    p_tenant_id: policy.tenantId,
    p_expected_version: expectedVersion,
    p_reason: reason.trim(),
    p_definition: {
      name: policy.name,
      subjectKind: policy.subjectKind,
      groupId: policy.groupId ?? null,
      scaleMax: policy.scaleMax,
      metrics: policy.metrics,
    },
  });
  if (error)
    throw new Error(
      ["PT409", "40001"].includes(error.code ?? "")
        ? "Someone changed these rules. Reload before saving your changes."
        : "Draft could not be saved. The scoring-settings service may need deploying, or your access may have changed.",
    );
  const saved = data as ScorecardPolicy;
  if (
    !saved ||
    (expectedVersion > 0 && saved.id !== policy.id) ||
    saved.tenantId !== policy.tenantId ||
    saved.subjectKind !== policy.subjectKind ||
    (saved.groupId ?? null) !== (policy.groupId ?? null) ||
    saved.version !== expectedVersion + 1 ||
    saved.status !== "draft" ||
    validateScorecardPolicy(saved).length
  )
    throw new Error("Save response could not be verified. Reload before trying again.");
  return saved;
}
