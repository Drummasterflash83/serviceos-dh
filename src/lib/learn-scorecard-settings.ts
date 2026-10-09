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
  db: LearnReadClient,
  tenantId: string,
  kind: ScoreSubject["kind"],
  groupId: string | null,
): Promise<ScorecardPolicy | null> {
  const { data, error } = await db
    .from("operating_profile_entries")
    .select("tenant_id,value,version_id")
    .eq("tenant_id", tenantId)
    .eq("scope_kind", "tenant")
    .eq("scope_ref", `${kind}:${groupId ?? "all"}`)
    .eq("namespace", "learn_scorecards")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data)) throw new Error("Scoring rules could not be read");
  if (!data.length) return null;
  const policy = data[0].value as ScorecardPolicy;
  if (
    data[0].tenant_id !== tenantId ||
    policy?.tenantId !== tenantId ||
    policy?.subjectKind !== kind ||
    (policy.groupId ?? null) !== groupId ||
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
      error.code === "40001"
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
