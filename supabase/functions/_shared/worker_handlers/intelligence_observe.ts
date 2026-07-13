// ServiceOS — Worker handler: intelligence.observe
//
// The reference Intelligence Loop shell. Given an extracted Observation it:
// resolves the effective profile, evaluates the policy set (Decision), persists
// the Observation, and then either — when confidence is high enough — materialises
// the proposed Action(s) with ownership + Automation INTENT, or routes to the
// OpenFolk review queue when uncertain. Domain-agnostic: the identical path
// serves ServiceOS and ProductOS; behaviour is entirely profile + policy data.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { resolveEffectiveProfile } from "../intelligence/profile.ts";
import { evaluatePolicies, stableHash } from "../intelligence/policy.ts";
import { automationIntentFor, buildActionDrafts } from "../intelligence/action.ts";
import type { IntelligenceObject, Policy, ProfileEntry } from "../intelligence/types.ts";

interface ObservationDraft {
  domain: string;
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

export async function handleIntelligenceObserve(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: db, tenantId, payload } = ctx;
  const draft = (payload?.observation ?? null) as ObservationDraft | null;
  if (!draft || typeof draft.domain !== "string" || typeof draft.subject !== "string") {
    return {
      success: false,
      error: {
        code: "invalid_payload",
        message: "payload.observation {domain, subject} required",
        retryable: false,
      },
    };
  }

  // 1) effective profile (industry is a data layer, resolved — never branched on)
  const { data: tenantRow } = await db
    .from("tenants")
    .select("industry")
    .eq("id", tenantId)
    .maybeSingle();
  const industry = (tenantRow?.industry as string | null) ?? null;
  const { data: entryRows, error: entryErr } = await db
    .from("operating_profile_entries")
    .select("scope_kind, scope_ref, domain, namespace, key, value")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  if (entryErr)
    return {
      success: false,
      error: { code: "profile_read_failed", message: entryErr.message, retryable: true },
    };
  const profile = resolveEffectiveProfile((entryRows ?? []) as ProfileEntry[], {
    tenantId,
    industry,
    domain: draft.domain,
  });

  // 2) policy set (core + this domain's pack)
  const { data: policyRows, error: polErr } = await db
    .from("policies")
    .select("id, domain, scope_kind, name, priority, enabled, rules, version_id")
    .eq("enabled", true)
    .in("domain", ["core", draft.domain]);
  if (polErr)
    return {
      success: false,
      error: { code: "policy_read_failed", message: polErr.message, retryable: true },
    };

  // 3) Decision — PURE
  const observation: IntelligenceObject = {
    tenant_id: tenantId,
    domain: draft.domain,
    object_type: "Observation",
    object_class: "observation",
    subject: draft.subject,
    severity: draft.severity ?? null,
    confidence: draft.confidence ?? null,
    ambiguity: draft.ambiguity ?? null,
    risk: draft.risk ?? null,
    reversibility: draft.reversibility ?? null,
    status: "unknown",
    evidence: draft.evidence ?? [],
    source_interactions: draft.source_interactions ?? [],
    source_entities: draft.source_entities ?? [],
    attributes: draft.attributes ?? {},
  };
  const decision = evaluatePolicies((policyRows ?? []) as Policy[], observation, profile, {
    now: Date.now(),
  });

  // 4) persist the Observation
  const { data: obsRow, error: obsErr } = await db
    .from("intelligence_objects")
    .insert({
      tenant_id: tenantId,
      domain: draft.domain,
      object_type: "Observation",
      object_class: "observation",
      subject: draft.subject,
      accountable_ref: hotRef(decision.assignments, "accountable"),
      priority: decision.priority,
      severity: decision.severity,
      confidence: draft.confidence ?? null,
      ambiguity: draft.ambiguity ?? null,
      risk: draft.risk ?? null,
      reversibility: draft.reversibility ?? null,
      status: "monitoring",
      deadline: decision.deadline,
      evidence: draft.evidence ?? [],
      source_interactions: draft.source_interactions ?? [],
      source_entities: draft.source_entities ?? [],
      created_by: "system",
      created_from: draft.created_from ?? "intelligence.observe",
      attributes: draft.attributes ?? {},
    })
    .select("id")
    .single();
  if (obsErr || !obsRow) {
    return {
      success: false,
      error: {
        code: "observation_insert_failed",
        message: obsErr?.message ?? "no id",
        retryable: true,
      },
    };
  }
  const observationId = obsRow.id as string;

  // 5) decision log (outputs include action_proposals so approval can materialise later)
  const { data: decRow } = await db
    .from("decision_log")
    .insert({
      tenant_id: tenantId,
      object_id: observationId,
      object_snapshot: observation,
      effective_profile_hash: stableHash(profile),
      policy_version_ids: decision.policy_version_ids,
      matched_rules: decision.matched_rules,
      outputs: {
        priority: decision.priority,
        severity: decision.severity,
        deadline: decision.deadline,
        review_route: decision.review_route,
        assignments: decision.assignments,
        action_proposals: decision.action_proposals,
        reasons: decision.reasons,
      },
      input_hash: decision.input_hash,
    })
    .select("id")
    .single();
  const decisionId = (decRow?.id as string | undefined) ?? null;

  await db
    .from("intelligence_objects")
    .update({ policy_applied: decision.policy_version_ids[0] ?? null, decision_id: decisionId })
    .eq("id", observationId);
  await writeOwnership(db, tenantId, observationId, decision.assignments);
  await writeHistory(
    db,
    tenantId,
    observationId,
    null,
    "monitoring",
    decisionId,
    "Observation recorded",
  );
  await publish(
    db,
    tenantId,
    "intelligence.observation.created",
    observationId,
    draft.domain,
    decisionId,
    {
      review_route: decision.review_route,
    },
  );

  // 6) the confidence gate
  if (decision.review_route !== "auto") {
    // Uncertain ⇒ OpenFolk review. Actions are NOT created and nothing reaches
    // the customer until a consultant resolves the review (intelligence.review_resolve).
    await db.from("review_tasks").insert({
      tenant_id: tenantId,
      object_id: observationId,
      route: decision.review_route,
      reason: decision.reasons.join("; ") || null,
      decision_id: decisionId,
    });
    return {
      success: true,
      recordsProcessed: 1,
      result: {
        observation_id: observationId,
        decision_id: decisionId,
        review_route: decision.review_route,
        actions_created: 0,
      },
    };
  }

  // 7) high confidence ⇒ materialise the Action(s) + Automation Intent(s)
  const drafts = buildActionDrafts({ ...observation, id: observationId }, decision);
  const actionIds = await materialiseActions(
    db,
    tenantId,
    observationId,
    decisionId,
    decision.policy_version_ids[0] ?? null,
    drafts,
  );

  return {
    success: true,
    recordsProcessed: 1 + actionIds.length,
    result: {
      observation_id: observationId,
      decision_id: decisionId,
      review_route: "auto",
      action_ids: actionIds,
    },
  };
}

// ── shared persistence helpers (also used by intelligence.review_resolve) ────

export function hotRef(
  assignments: { raci_role: string; party_kind: string; party_ref: string }[],
  role: string,
): { kind: string; ref: string } | null {
  const a = assignments.find((x) => x.raci_role === role);
  return a ? { kind: a.party_kind, ref: a.party_ref } : null;
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function writeOwnership(
  db: Db,
  tenantId: string,
  objectId: string,
  assignments: { raci_role: string; party_kind: string; party_ref: string }[],
): Promise<void> {
  if (assignments.length === 0) return;
  await db.from("ownership_assignments").insert(
    assignments.map((a) => ({
      tenant_id: tenantId,
      object_id: objectId,
      raci_role: a.raci_role,
      party_kind: a.party_kind,
      party_ref: a.party_ref,
      assigned_by: "policy",
    })),
  );
}

export async function writeHistory(
  db: Db,
  tenantId: string,
  objectId: string,
  from: string | null,
  to: string,
  decisionId: string | null,
  reason: string,
): Promise<void> {
  await db.from("object_state_history").insert({
    tenant_id: tenantId,
    object_id: objectId,
    from_state: from,
    to_state: to,
    actor: { kind: "automation", ref: "intelligence.observe" },
    reason,
    decision_id: decisionId,
  });
}

export async function publish(
  db: Db,
  tenantId: string,
  eventType: string,
  subjectId: string,
  domain: string,
  decisionId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.from("platform_events").insert({
    tenant_id: tenantId,
    event_type: eventType,
    subject_type: "intelligence_object",
    subject_id: subjectId,
    source: "intelligence.observe",
    domain,
    actor: { kind: "automation", ref: "intelligence.observe" },
    occurred_at: new Date().toISOString(),
    payload,
    metadata: { decision_id: decisionId },
  });
}

/** Persist Action drafts + derived_from links + ownership + Automation Intents. */
export async function materialiseActions(
  db: Db,
  tenantId: string,
  observationId: string,
  decisionId: string | null,
  policyVersion: string | null,
  // deno-lint-ignore no-explicit-any
  drafts: any[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const a of drafts) {
    const { data: row } = await db
      .from("intelligence_objects")
      .insert({
        tenant_id: tenantId,
        domain: a.domain,
        object_type: "Action",
        object_class: "action",
        subject: a.subject,
        responsible_ref: a.owner ? { kind: a.owner.party_kind, ref: a.owner.party_ref } : null,
        priority: a.priority,
        severity: a.severity,
        confidence: a.confidence,
        status: "ready",
        deadline: a.deadline,
        evidence: a.evidence,
        source_interactions: a.source_interactions,
        source_entities: a.source_entities,
        created_by: "system",
        created_from: "intelligence.observe",
        policy_applied: policyVersion,
        decision_id: decisionId,
        attributes: {
          action_type: a.action_type,
          description: a.description,
          reason: a.reason,
          automation_intent: a.automation_intent,
        },
      })
      .select("id")
      .single();
    if (!row) continue;
    const actionId = row.id as string;
    ids.push(actionId);

    await db.from("object_links").insert({
      tenant_id: tenantId,
      from_object_id: actionId,
      to_object_id: observationId,
      relation: "derived_from",
    });
    if (a.owner) await writeOwnership(db, tenantId, actionId, [a.owner]);
    await writeHistory(
      db,
      tenantId,
      actionId,
      null,
      "ready",
      decisionId,
      "Action created from observation",
    );

    const intent = automationIntentFor(a);
    if (intent) {
      // EMIT intent only — the Automation Engine decides execution.
      await db.from("automation_intents").insert({
        tenant_id: tenantId,
        action_object_id: actionId,
        intent_type: intent.intent_type,
        parameters: intent.parameters,
      });
    }
    await publish(db, tenantId, "intelligence.action.created", actionId, a.domain, decisionId, {
      action_type: a.action_type,
      automation_intent: a.automation_intent,
    });
  }
  return ids;
}
