// ServiceOS — Worker handler: intelligence.evaluate
//
// The impure SHELL around the pure engine (profile resolver + policy evaluator).
// Given a draft intelligence object it: resolves the effective profile, evaluates
// the policy set, persists the object + ownership + decision log, routes for
// review when confidence/risk demand it, records the opening state transition,
// and publishes an event. Domain-agnostic: the identical path serves ServiceOS
// and ProductOS — behaviour comes entirely from profile + policy + pack DATA.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { resolveEffectiveProfile } from "../intelligence/profile.ts";
import { evaluatePolicies, stableHash } from "../intelligence/policy.ts";
import type {
  IntelligenceObject,
  OwnershipAssignment,
  Policy,
  ProfileEntry,
} from "../intelligence/types.ts";

interface Draft {
  domain: string;
  object_type: string;
  subject: string;
  severity?: string | null;
  confidence?: number | null;
  ambiguity?: number | null;
  risk?: number | null;
  reversibility?: number | null;
  source_interactions?: string[];
  source_entities?: string[];
  evidence?: unknown[];
  attributes?: Record<string, unknown>;
  created_from?: string | null;
}

function hotRef(
  assignments: OwnershipAssignment[],
  role: string,
): { kind: string; ref: string } | null {
  const a = assignments.find((x) => x.raci_role === role);
  return a ? { kind: a.party_kind, ref: a.party_ref } : null;
}

export async function handleIntelligenceEvaluate(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: db, tenantId, payload } = ctx;
  const draft = (payload?.draft ?? null) as Draft | null;
  if (!draft || typeof draft.domain !== "string" || typeof draft.object_type !== "string") {
    return {
      success: false,
      error: {
        code: "invalid_payload",
        message: "payload.draft {domain, object_type, subject} required",
        retryable: false,
      },
    };
  }

  // 1) tenant industry (a data layer for profile resolution — never a code path)
  const { data: tenantRow } = await db
    .from("tenants")
    .select("industry")
    .eq("id", tenantId)
    .maybeSingle();
  const industry = (tenantRow?.industry as string | null) ?? null;

  // 2) resolve the effective profile from the layered entries (platform + tenant)
  const { data: entryRows, error: entryErr } = await db
    .from("operating_profile_entries")
    .select("scope_kind, scope_ref, domain, namespace, key, value")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  if (entryErr) {
    return {
      success: false,
      error: { code: "profile_read_failed", message: entryErr.message, retryable: true },
    };
  }
  const profile = resolveEffectiveProfile((entryRows ?? []) as ProfileEntry[], {
    tenantId,
    industry,
    domain: draft.domain,
  });

  // 3) load the enabled policy set (core + this domain)
  const { data: policyRows, error: polErr } = await db
    .from("policies")
    .select("id, domain, scope_kind, name, priority, enabled, rules, version_id")
    .eq("enabled", true)
    .in("domain", ["core", draft.domain]);
  if (polErr) {
    return {
      success: false,
      error: { code: "policy_read_failed", message: polErr.message, retryable: true },
    };
  }

  // 4) evaluate — PURE, deterministic, no I/O
  const objForEval: IntelligenceObject = {
    tenant_id: tenantId,
    domain: draft.domain,
    object_type: draft.object_type,
    subject: draft.subject,
    severity: draft.severity ?? null,
    confidence: draft.confidence ?? null,
    ambiguity: draft.ambiguity ?? null,
    risk: draft.risk ?? null,
    reversibility: draft.reversibility ?? null,
    status: "unknown",
    attributes: draft.attributes ?? {},
  };
  const decision = evaluatePolicies((policyRows ?? []) as Policy[], objForEval, profile, {
    now: Date.now(),
  });

  const profileHash = stableHash(profile);
  const initialState = "ready";

  // 5) persist the object (hot ownership cache from the decision)
  const { data: inserted, error: insErr } = await db
    .from("intelligence_objects")
    .insert({
      tenant_id: tenantId,
      domain: draft.domain,
      object_type: draft.object_type,
      subject: draft.subject,
      responsible_ref: hotRef(decision.assignments, "responsible"),
      accountable_ref: hotRef(decision.assignments, "accountable"),
      waiting_on_ref: hotRef(decision.assignments, "waiting_on"),
      priority: decision.priority,
      severity: decision.severity,
      confidence: draft.confidence ?? null,
      ambiguity: draft.ambiguity ?? null,
      risk: draft.risk ?? null,
      reversibility: draft.reversibility ?? null,
      status: initialState,
      deadline: decision.deadline,
      evidence: draft.evidence ?? [],
      source_interactions: draft.source_interactions ?? [],
      source_entities: draft.source_entities ?? [],
      created_by: "system",
      created_from: draft.created_from ?? "intelligence.evaluate",
      attributes: draft.attributes ?? {},
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return {
      success: false,
      error: { code: "object_insert_failed", message: insErr?.message ?? "no id", retryable: true },
    };
  }
  const objectId = inserted.id as string;

  // 6) decision log (replayable) — snapshot inputs AS THEY WERE
  const { data: decRow } = await db
    .from("decision_log")
    .insert({
      tenant_id: tenantId,
      object_id: objectId,
      object_snapshot: objForEval,
      effective_profile_hash: profileHash,
      policy_version_ids: decision.policy_version_ids,
      matched_rules: decision.matched_rules,
      outputs: {
        priority: decision.priority,
        severity: decision.severity,
        deadline: decision.deadline,
        review_route: decision.review_route,
        recommended_action: decision.recommended_action,
        automation_permission: decision.automation_permission,
        assignments: decision.assignments,
        reasons: decision.reasons,
      },
      input_hash: decision.input_hash,
    })
    .select("id")
    .single();
  const decisionId = (decRow?.id as string | undefined) ?? null;

  // link the object back to the policy version + decision for provenance
  await db
    .from("intelligence_objects")
    .update({ policy_applied: decision.policy_version_ids[0] ?? null, decision_id: decisionId })
    .eq("id", objectId);

  // 7) full RACI assignments
  if (decision.assignments.length > 0) {
    await db.from("ownership_assignments").insert(
      decision.assignments.map((a) => ({
        tenant_id: tenantId,
        object_id: objectId,
        raci_role: a.raci_role,
        party_kind: a.party_kind,
        party_ref: a.party_ref,
        assigned_by: "policy",
      })),
    );
  }

  // 8) confidence routing → human review queue (the customer-facing gate)
  if (decision.review_route !== "auto") {
    await db.from("review_tasks").insert({
      tenant_id: tenantId,
      object_id: objectId,
      route: decision.review_route,
      reason: decision.reasons.join("; ") || null,
      decision_id: decisionId,
    });
  }

  // 9) opening state transition (append-only history)
  await db.from("object_state_history").insert({
    tenant_id: tenantId,
    object_id: objectId,
    from_state: null,
    to_state: initialState,
    actor: { kind: "automation", ref: "intelligence.evaluate" },
    reason: "Object created and evaluated",
    decision_id: decisionId,
  });

  // 10) publish the event (hardened envelope: actor / occurred_at / domain)
  const nowIso = new Date().toISOString();
  await db.from("platform_events").insert({
    tenant_id: tenantId,
    event_type: "intelligence.object.created",
    subject_type: "intelligence_object",
    subject_id: objectId,
    source: "intelligence.evaluate",
    domain: draft.domain,
    actor: { kind: "automation", ref: "intelligence.evaluate" },
    occurred_at: nowIso,
    payload: { object_type: draft.object_type, review_route: decision.review_route },
    metadata: { decision_id: decisionId },
  });

  return {
    success: true,
    recordsProcessed: 1,
    result: {
      object_id: objectId,
      decision_id: decisionId,
      review_route: decision.review_route,
      priority: decision.priority,
      deadline: decision.deadline,
      matched_rules: decision.matched_rules.map((m) => m.rule_id),
    },
  };
}
