// ServiceOS — Customer Health: impure DB store (Deno, service-role).
//
// The ONLY place that touches the database for Customer Health shadow processing.
// It loads tenant config, executes the PURE pipeline's write plan, and reads/applies
// the Chris-only review — writing to health_* tables (+ append-only corrections for
// correction-class decisions) and NOTHING else. Every persistence path asserts the
// shadow-safety allowlist before writing, so "zero operational side effects" is
// enforced, not assumed.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type CallbackPolicyConfig,
  type CommunicationInput,
  type OwnershipMaps,
  type OwnershipSourceKind,
} from "./types.ts";
import {
  NON_WRITING_OUTCOMES,
  runShadowPipeline,
  type ShadowContext,
  type ShadowResult,
} from "./pipeline.ts";
import { assertShadowSafe, SHADOW_WRITE_ALLOWLIST } from "./shadow_safety.ts";
import { reassessAggregate } from "./aggregate.ts";

// ── Config loading. ─────────────────────────────────────────────────────────
export interface CallbackConfig {
  policyVersionId: string | null;
  published: boolean;
  sourceAllowlistEnabled: boolean;
  allowedSources: string[];
  policy: Partial<CallbackPolicyConfig>;
  ownershipMaps: Partial<OwnershipMaps>;
  ownershipOrder: OwnershipSourceKind[] | undefined;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function loadCallbackConfig(
  db: SupabaseClient,
  tenantId: string,
): Promise<CallbackConfig> {
  const { data: cv } = await db
    .from("config_versions")
    .select("id, status, version")
    .eq("tenant_id", tenantId)
    .eq("artifact_kind", "policy")
    .eq("artifact_key", "customer_health")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const policyVersionId = (cv?.id as string | undefined) ?? null;
  const published = cv?.status === "published";

  // Pinned to scope_kind='tenant' — exactly what the tenant config migration seeds.
  // Without the pin, a duplicate key at another scope would win or lose purely on row
  // order, making the source boundary nondeterministic. Layered scope resolution is a
  // deliberate later feature; until then, only tenant-scope config is read.
  const { data: entries } = await db
    .from("operating_profile_entries")
    .select("key, value")
    .eq("tenant_id", tenantId)
    .eq("scope_kind", "tenant")
    .eq("namespace", "customer_health");

  const byKey = new Map<string, unknown>((entries ?? []).map((e) => [e.key as string, e.value]));
  const def = asObj(byKey.get("callback.definition"));
  const due = asObj(byKey.get("callback.due_expectation"));
  const esc = asObj(byKey.get("callback.escalation"));
  const priv = asObj(byKey.get("privacy"));
  const src = asObj(byKey.get("source.allowlist"));
  const maps = asObj(byKey.get("ownership.maps")) as unknown as Partial<OwnershipMaps>;
  const order = byKey.get("ownership.resolution_order");

  const policy: Partial<CallbackPolicyConfig> = {
    requiresExplicitRequest: def.requires_explicit_request !== false,
    telephoneBased: def.telephone_based !== false,
    includeIntents: Array.isArray(def.include_intents) ? (def.include_intents as string[]) : [],
    excludeIntents: Array.isArray(def.exclude_intents) ? (def.exclude_intents as string[]) : [],
    defaultDueHours: Number(due.default_due_hours ?? 4),
    dueSoonWithinHours: Number(due.due_soon_within_hours ?? 4),
    priorityDueHours: Number(due.priority_due_hours ?? 2),
    criticalOnRepeatCount: Number(esc.critical_on_repeat_count ?? 2),
    redactExcerpts: priv.redact_excerpts !== false,
    maxExcerptChars: Number(priv.max_excerpt_chars ?? 120),
    exposeTranscript: priv.expose_transcript === true,
  };

  return {
    policyVersionId,
    published,
    sourceAllowlistEnabled: src.enabled === true,
    allowedSources: Array.isArray(src.sources) ? (src.sources as string[]) : [],
    policy,
    ownershipMaps: maps ?? {},
    ownershipOrder: Array.isArray(order) ? (order as OwnershipSourceKind[]) : undefined,
  };
}

// ── Helpers to read fold/history context for a subject + obligation. ────────
async function loadPriorContext(
  db: SupabaseClient,
  tenantId: string,
  subjectType: string,
  subjectId: string,
  groupKey: string,
): Promise<{
  priorState: string | null;
  existingRepeatContactCount: number;
  resolution: "none" | "possible" | "verified";
}> {
  const { data: obj } = await db
    .from("health_objects")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("health_type", "customer_health")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .maybeSingle();

  let priorState: string | null = null;
  if (obj?.id) {
    const { data: a } = await db
      .from("health_assessments")
      .select("state")
      .eq("tenant_id", tenantId)
      .eq("health_object_id", obj.id)
      .order("evaluated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    priorState = (a?.state as string | undefined) ?? null;
  }

  const { data: prop } = await db
    .from("health_commitment_proposals")
    .select("id, resolution_state")
    .eq("tenant_id", tenantId)
    .eq("group_key", groupKey)
    .not("state", "in", "(rejected,superseded,resolved_shadow)")
    .maybeSingle();

  let existingRepeatContactCount = 0;
  let resolution: "none" | "possible" | "verified" = "none";
  if (prop?.id) {
    const { count } = await db
      .from("health_proposal_sources")
      .select("id", { count: "exact", head: true })
      .eq("proposal_id", prop.id)
      .eq("source_kind", "interaction")
      .eq("role", "candidate_evidence");
    existingRepeatContactCount = count ?? 0;
    resolution = (prop.resolution_state as "none" | "possible" | "verified") ?? "none";
  }
  return { priorState, existingRepeatContactCount, resolution };
}

// ── Process one candidate communication (shadow). ───────────────────────────
export interface ProcessOutcome {
  interactionId: string;
  outcome: ShadowResult["outcome"];
  reasons: string[];
  healthObjectId: string | null;
  proposalId: string | null;
  assessmentId: string | null;
  folded: boolean;
  shadowSafe: boolean;
}

export async function processCandidate(input: {
  db: SupabaseClient;
  tenantId: string;
  communication: CommunicationInput;
  config: CallbackConfig;
  companyConfidence?: number | null;
  nowMs: number;
  jobId?: string | null;
}): Promise<ProcessOutcome> {
  const { db, tenantId, communication: c, config } = input;

  const baseCtx: ShadowContext = {
    tenantId,
    policyVersionId: config.policyVersionId,
    policyPublished: config.published,
    sourceAllowlistEnabled: config.sourceAllowlistEnabled,
    allowedSources: config.allowedSources,
    policy: config.policy,
    ownershipMaps: config.ownershipMaps,
    ownershipOrder: config.ownershipOrder,
    companyId: c.relatedCompanyId ?? null,
    companyConfidence: input.companyConfidence ?? (c.relatedCompanyId ? 0.9 : null),
    personId: c.relatedPersonId ?? null,
    priorState: null,
    existingRepeatContactCount: 0,
    resolution: "none",
    nowMs: input.nowMs,
  };

  // Pass 1 — resolve subject + group_key.
  const prelim = runShadowPipeline({ communication: c, ctx: baseCtx });
  const done = (r: ShadowResult, extra: Partial<ProcessOutcome> = {}): ProcessOutcome => ({
    interactionId: c.interactionId,
    outcome: r.outcome,
    reasons: r.reasons,
    healthObjectId: null,
    proposalId: null,
    assessmentId: null,
    folded: false,
    shadowSafe: r.shadowSafety.safe,
    ...extra,
  });

  // Non-writing outcomes (unpublished policy, disabled/failing source boundary,
  // excluded) never touch the database.
  if (NON_WRITING_OUTCOMES.has(prelim.outcome)) {
    return done(prelim);
  }
  if (!prelim.subject.resolved || !prelim.subject.subjectId || !prelim.subject.subjectType) {
    return done(prelim); // needs_context, no subject
  }

  // Pass 2 — enrich with prior/fold context, then re-run.
  const prior = await loadPriorContext(
    db,
    tenantId,
    prelim.subject.subjectType,
    prelim.subject.subjectId,
    prelim.groupKey!,
  );
  const folded = prior.existingRepeatContactCount > 0;
  const result = runShadowPipeline({
    communication: c,
    ctx: {
      ...baseCtx,
      priorState: prior.priorState as ShadowContext["priorState"],
      existingRepeatContactCount: prior.existingRepeatContactCount,
      resolution: prior.resolution,
    },
  });

  // SHADOW-SAFETY GATE: refuse anything outside the allowlist.
  const safety = assertShadowSafe(result.writeTables);
  if (!safety.safe) {
    throw new Error(`shadow-safety violation — would write ${safety.offending.join(", ")}`);
  }

  // Persist — health_* tables only.
  const healthObjectId = await upsertHealthObject(db, result);
  let assessmentId: string | null = null;
  let proposalId: string | null = null;

  if (result.proposal && healthObjectId) {
    // Candidate obligation: persist the proposal + sources FIRST, then write ONE
    // AGGREGATE assessment across ALL of this customer's live obligations — so a new
    // callback never overwrites the truth of older open ones.
    proposalId = await upsertProposalAndSources(db, healthObjectId, result);
    const agg = await reassessAggregate(db, tenantId, healthObjectId, {
      policyVersionId: config.policyVersionId,
      policy: config.policy,
      nowMs: input.nowMs,
      triggeredBy: "candidate",
      extraEvidence: result.assessment?.evidence,
      jobId: input.jobId ?? null,
    });
    if (!agg.ok) throw new Error(agg.error);
    assessmentId = agg.assessmentId;
  } else if (result.assessment && healthObjectId) {
    // needs_context (uncertain): NO proposal, NO source row — persist the per-candidate
    // 'unknown' assessment whose evidence explains what could not be established.
    assessmentId = await insertAssessment(db, healthObjectId, result, input.jobId ?? null);
  }

  return done(result, { healthObjectId, assessmentId, proposalId, folded, shadowSafe: true });
}

async function upsertHealthObject(db: SupabaseClient, r: ShadowResult): Promise<string | null> {
  if (!r.healthObject) return null;
  const h = r.healthObject;
  const { data, error } = await db
    .from("health_objects")
    .upsert(
      {
        tenant_id: h.tenant_id,
        health_type: h.health_type,
        subject_type: h.subject_type,
        subject_id: h.subject_id,
        active_policy_version_id: h.active_policy_version_id,
        accountable_ref: h.accountable_ref,
        mode: h.mode,
      },
      { onConflict: "tenant_id,health_type,subject_type,subject_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`health_objects upsert: ${error.message}`);
  return (data?.id as string) ?? null;
}

async function insertAssessment(
  db: SupabaseClient,
  healthObjectId: string,
  r: ShadowResult,
  jobId: string | null,
): Promise<string | null> {
  const a = r.assessment!;
  const { data, error } = await db
    .from("health_assessments")
    .insert({
      tenant_id: a.tenant_id,
      health_object_id: healthObjectId,
      state: a.state,
      trend: a.trend,
      drivers: a.drivers,
      risks: a.risks,
      opportunities: a.opportunities,
      confidence: a.confidence,
      freshness: a.freshness,
      evidence: a.evidence,
      evaluator_version: a.evaluator_version,
      policy_version_id: a.policy_version_id,
      mode: a.mode,
      input_hash: a.input_hash,
      triggered_by: a.triggered_by,
      changed: a.changed,
      job_id: jobId,
    })
    .select("id")
    .single();
  // Idempotent: a duplicate input_hash collapses to the existing snapshot.
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const { data: existing } = await db
        .from("health_assessments")
        .select("id")
        .eq("tenant_id", a.tenant_id)
        .eq("health_object_id", healthObjectId)
        .eq("input_hash", a.input_hash)
        .maybeSingle();
      return (existing?.id as string | undefined) ?? null;
    }
    throw new Error(`health_assessments insert: ${error.message}`);
  }
  return (data?.id as string) ?? null;
}

async function upsertProposalAndSources(
  db: SupabaseClient,
  healthObjectId: string,
  r: ShadowResult,
): Promise<string | null> {
  const p = r.proposal!;
  // Find an existing LIVE proposal for this obligation (fold instead of duplicate).
  const { data: existing } = await db
    .from("health_commitment_proposals")
    .select("id")
    .eq("tenant_id", p.tenant_id)
    .eq("group_key", p.group_key)
    .not("state", "in", "(rejected,superseded,resolved_shadow)")
    .maybeSingle();

  let proposalId: string;
  if (existing?.id) {
    proposalId = existing.id as string;
    // Fold: refresh confidence/ambiguity/due + resolution_state; never duplicate.
    await db
      .from("health_commitment_proposals")
      .update({
        confidence: p.confidence,
        ambiguity: p.ambiguity,
        proposed_due_at: p.proposed_due_at,
        proposed_accountable_ref: p.proposed_accountable_ref,
        resolution_state: p.resolution_state,
      })
      .eq("id", proposalId);
  } else {
    const { data, error } = await db
      .from("health_commitment_proposals")
      .insert({
        tenant_id: p.tenant_id,
        health_object_id: healthObjectId,
        commitment_type: p.commitment_type,
        proposed_title: p.proposed_title,
        proposed_outcome: p.proposed_outcome,
        proposed_done_when: p.proposed_done_when,
        proposed_due_at: p.proposed_due_at,
        proposed_accountable_ref: p.proposed_accountable_ref,
        proposed_handler_ref: p.proposed_handler_ref,
        proposed_waiting_on: p.proposed_waiting_on,
        state: p.state,
        confidence: p.confidence,
        ambiguity: p.ambiguity,
        policy_version_id: p.policy_version_id,
        classifier_version: p.classifier_version,
        group_key: p.group_key,
        mode: p.mode,
        resolution_state: p.resolution_state,
      })
      .select("id")
      .single();
    if (error) throw new Error(`health_commitment_proposals insert: ${error.message}`);
    proposalId = data!.id as string;
  }

  await insertSources(db, proposalId, r);
  return proposalId;
}

async function insertSources(
  db: SupabaseClient,
  proposalId: string,
  r: ShadowResult,
): Promise<void> {
  for (const s of r.sources) {
    const { error } = await db.from("health_proposal_sources").insert({
      tenant_id: s.tenant_id,
      proposal_id: proposalId,
      source_kind: s.source_kind,
      source_ref: s.source_ref,
      role: s.role,
      excerpt: s.excerpt,
      confidence: s.confidence,
      observed_at: s.observed_at,
    });
    // Duplicate (same source already linked) is fine — evidence is append-only.
    if (error && (error as { code?: string }).code !== "23505") {
      throw new Error(`health_proposal_sources insert: ${error.message}`);
    }
  }
}

export { SHADOW_WRITE_ALLOWLIST };
