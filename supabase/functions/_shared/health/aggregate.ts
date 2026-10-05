// ServiceOS — Customer Health: aggregate reassessment (impure, service-role).
//
// The single-obligation evaluator answers "how is THIS callback?"; the live Command
// Centre needs "how is this CUSTOMER?". This module loads EVERY live obligation for a
// Health Object and writes ONE aggregate `health_assessments` row — so a newly-processed
// obligation never overwrites the truth of older open ones, and a customer is never
// marked recovering while another callback is still open. It writes ONLY
// health_assessments (shadow-safe) and is hash-idempotent.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { type AggregateObligation, evaluateAggregateCustomerHealth } from "./evaluator.ts";
import { HEALTH_EVALUATOR_VERSION, stableHash } from "./hash.ts";
import type { CallbackPolicyConfig, EvidenceItem, HealthState } from "./types.ts";

/** Build the aggregate obligation set for a Health Object from its stored proposals. */
export async function loadObjectObligations(
  db: SupabaseClient,
  tenantId: string,
  healthObjectId: string,
): Promise<AggregateObligation[]> {
  // Rejected/superseded proposals are NOT obligations and are excluded entirely.
  const { data: props } = await db
    .from("health_commitment_proposals")
    .select("id, state, resolution_state, proposed_due_at, ambiguity, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("health_object_id", healthObjectId)
    .not("state", "in", "(rejected,superseded)");
  if (!props?.length) return [];

  const ids = props.map((p) => p.id as string);
  const { data: srcs } = await db
    .from("health_proposal_sources")
    .select("proposal_id, role, observed_at")
    .in("proposal_id", ids)
    .eq("source_kind", "interaction");

  const agg = new Map<string, { count: number; newest: string | null; oldest: string | null }>();
  for (const s of srcs ?? []) {
    if (s.role !== "candidate_evidence") continue;
    const e = agg.get(s.proposal_id as string) ?? { count: 0, newest: null, oldest: null };
    e.count++;
    const at = s.observed_at as string | null;
    if (at) {
      if (!e.newest || at > e.newest) e.newest = at;
      if (!e.oldest || at < e.oldest) e.oldest = at;
    }
    agg.set(s.proposal_id as string, e);
  }

  return props.map((p) => {
    const a = agg.get(p.id as string) ?? { count: 0, newest: null, oldest: null };
    const resolved =
      (p.resolution_state as string) === "verified" || (p.state as string) === "resolved_shadow";
    return {
      ref: p.id as string,
      open: !resolved,
      resolution: (p.resolution_state as AggregateObligation["resolution"]) ?? "none",
      candidateAt: a.oldest ?? (p.created_at as string | null),
      dueAt: p.proposed_due_at as string | null,
      repeatContactCount: Math.max(1, a.count),
      // For an OPEN obligation, the call time drives staleness; for a RESOLVED one, the
      // resolution time (proposal.updated_at) drives the recovery window.
      newestEvidenceAt: resolved
        ? ((p.updated_at as string | null) ?? a.newest)
        : (a.newest ?? (p.created_at as string | null)),
      ambiguity: Number(p.ambiguity ?? 0.1),
    };
  });
}

/**
 * Recompute + persist ONE aggregate Customer Health assessment for a Health Object.
 * Hash-idempotent: identical obligation set + state + day collapses to one row; any
 * change (new obligation, due crossing, resolution) yields a new snapshot. Returns the
 * assessment id, or an error message string on a non-idempotent failure.
 */
export async function reassessAggregate(
  db: SupabaseClient,
  tenantId: string,
  healthObjectId: string,
  opts: {
    policyVersionId: string | null;
    policy?: Partial<CallbackPolicyConfig>;
    nowMs: number;
    triggeredBy: string;
    extraEvidence?: EvidenceItem[];
    jobId?: string | null;
  },
): Promise<{ ok: true; assessmentId: string | null } | { ok: false; error: string }> {
  const obligations = await loadObjectObligations(db, tenantId, healthObjectId);

  const { data: prior } = await db
    .from("health_assessments")
    .select("state")
    .eq("tenant_id", tenantId)
    .eq("health_object_id", healthObjectId)
    .order("evaluated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorState = (prior?.state as HealthState | undefined) ?? null;

  const reading = evaluateAggregateCustomerHealth({
    obligations,
    policy: opts.policy,
    priorState,
    nowMs: opts.nowMs,
    extraEvidence: opts.extraEvidence,
  });

  const sig = obligations
    .map((o) => `${o.ref}:${o.open ? 1 : 0}:${o.resolution}:${o.dueAt}:${o.repeatContactCount}`)
    .sort();
  const inputHash = stableHash({
    t: tenantId,
    o: healthObjectId,
    kind: "aggregate",
    st: reading.state,
    sig,
    day: new Date(opts.nowMs).toISOString().slice(0, 10),
    ev: HEALTH_EVALUATOR_VERSION,
    pv: opts.policyVersionId,
  });

  const { data, error } = await db
    .from("health_assessments")
    .insert({
      tenant_id: tenantId,
      health_object_id: healthObjectId,
      state: reading.state,
      trend: reading.trend,
      drivers: reading.drivers,
      risks: reading.risks,
      opportunities: reading.opportunities,
      confidence: reading.confidence,
      freshness: reading.freshness,
      evidence: reading.evidence,
      evaluator_version: HEALTH_EVALUATOR_VERSION,
      policy_version_id: opts.policyVersionId,
      mode: "shadow",
      input_hash: inputHash,
      triggered_by: opts.triggeredBy,
      changed: reading.changed,
      job_id: opts.jobId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const { data: existing } = await db
        .from("health_assessments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("health_object_id", healthObjectId)
        .eq("input_hash", inputHash)
        .maybeSingle();
      return { ok: true, assessmentId: (existing?.id as string | undefined) ?? null };
    }
    return { ok: false, error: `aggregate assessment insert: ${error.message}` };
  }
  return { ok: true, assessmentId: (data?.id as string) ?? null };
}
