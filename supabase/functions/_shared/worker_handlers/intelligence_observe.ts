// ServiceOS — Worker handler: intelligence.observe
//
// The reference Intelligence Loop shell, now driven by the Universal Decision
// Engine. Given an extracted Observation it: resolves the effective profile,
// asks the PURE engine for one immutable Decision Package, persists that package
// to decision_log, and then EXECUTES the single authoritative destination —
// materialising an Action (+ Automation Intent) on AUTOMATION_AUTHORISED, or opening the
// right review queue for OpenFolk / tenant-senior / customer approval. No routing
// is decided here; the engine decides, the handler only persists and executes.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { resolveEffectiveProfile } from "../intelligence/profile.ts";
import { resolveAuthorityContext } from "../intelligence/authority.ts";
import { evaluateDecision } from "../intelligence/decision.ts";
import { automationIntentFor } from "../intelligence/action.ts";
import type {
  DecisionInput,
  DecisionPackage,
  IntelligenceObject,
  OwnershipAssignment,
  Policy,
  ProfileEntry,
} from "../intelligence/types.ts";

const ENGINE_VERSION = "decision-engine/1.0.0";

// Decision destination → the human review queue's route value.
const REVIEW_ROUTE: Record<string, string> = {
  OPENFOLK_REVIEW: "openfolk",
  TENANT_SENIOR_REVIEW: "tenant_senior",
  CUSTOMER_APPROVAL: "customer",
  ESCALATE: "escalate",
};

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

  // 1) resolve inputs (the engine never queries anything itself)
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

  // 2) persist the Observation first so the decision can reference its id
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
  const { data: obsRow, error: obsErr } = await db
    .from("intelligence_objects")
    .insert({
      tenant_id: tenantId,
      domain: draft.domain,
      object_type: "Observation",
      object_class: "observation",
      subject: draft.subject,
      confidence: draft.confidence ?? null,
      ambiguity: draft.ambiguity ?? null,
      risk: draft.risk ?? null,
      reversibility: draft.reversibility ?? null,
      status: "monitoring",
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

  // 3) the ONE decision — pure, deterministic (caller supplies ids/timestamps).
  //    Authority is normalised to a domain-neutral context BEFORE the engine runs.
  const objectForDecision = { ...observation, id: observationId };
  const input: DecisionInput = {
    decisionId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    evaluatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    object: objectForDecision,
    profile,
    authority: resolveAuthorityContext(objectForDecision, profile),
    policies: (policyRows ?? []) as Policy[],
    domainPackKeys: [draft.domain],
    domainPackVersions: [],
    operatingProfileVersion: null,
    learningVersionIds: [],
    supersedes: (payload?.supersedes as string | null) ?? null,
    now: Date.now(),
  };
  const pkg = evaluateDecision(input);

  // 4) reflect the decision on the observation + persist the Decision Package
  const policyVersion = pkg.versions.policyVersionIds[0] ?? null;
  await db
    .from("intelligence_objects")
    .update({
      priority: pkg.proposedAction?.priority ?? null,
      deadline: pkg.proposedAction?.dueAt ?? null,
      accountable_ref: pkg.ownership.accountable
        ? { kind: pkg.ownership.accountable.party_kind, ref: pkg.ownership.accountable.party_ref }
        : null,
      policy_applied: policyVersion,
      decision_id: pkg.id,
    })
    .eq("id", observationId);

  await db.from("decision_log").insert({
    id: pkg.id,
    tenant_id: tenantId,
    object_id: observationId,
    object_snapshot: input.object,
    effective_profile_hash: pkg.audit.inputHash,
    policy_version_ids: pkg.versions.policyVersionIds,
    matched_rules: pkg.rationale.policyMatches,
    outputs: {
      decision: pkg.decision,
      reason_codes: pkg.rationale.reasonCodes,
      next_owner: pkg.nextDecisionOwner,
    },
    input_hash: pkg.audit.inputHash,
    decision: pkg.decision,
    next_owner_kind: pkg.nextDecisionOwner.kind,
    engine_version: pkg.versions.engineVersion,
    operating_profile_version: pkg.versions.operatingProfileVersion,
    learning_version_ids: pkg.versions.learningVersionIds,
    reason_codes: pkg.rationale.reasonCodes,
    correlation_id: pkg.audit.correlationId,
    output_hash: pkg.audit.outputHash,
    supersedes: pkg.supersedes,
    decision_package: pkg,
  });

  await writeOwnership(db, tenantId, observationId, flattenOwnership(pkg));
  await writeHistory(
    db,
    tenantId,
    observationId,
    null,
    "monitoring",
    pkg.id,
    "Observation recorded",
  );
  await publish(
    db,
    tenantId,
    "intelligence.observation.created",
    observationId,
    draft.domain,
    pkg.id,
    {
      decision: pkg.decision,
    },
  );

  // 5) EXECUTE the single authoritative destination
  const actionIds = await execute(db, tenantId, observationId, policyVersion, pkg);

  return {
    success: true,
    recordsProcessed: 1 + actionIds.length,
    result: {
      observation_id: observationId,
      decision_id: pkg.id,
      decision: pkg.decision,
      action_ids: actionIds,
    },
  };
}

// ── execution: the handler acts on the decision; it never re-decides ─────────
async function execute(
  db: Db,
  tenantId: string,
  observationId: string,
  policyVersion: string | null,
  pkg: DecisionPackage,
): Promise<string[]> {
  const d = pkg.decision;
  if (
    (d === "AUTOMATION_AUTHORISED" || d === "AUTOMATION_REQUIRES_APPROVAL") &&
    pkg.proposedAction
  ) {
    const owner = pkg.ownership.responsible ?? pkg.ownership.accountable ?? null;
    const draft = {
      domain: pkg.domainPackKeys[0],
      subject: pkg.proposedAction.title,
      action_type: pkg.proposedAction.actionType,
      description: pkg.proposedAction.description,
      reason: null,
      priority: pkg.proposedAction.priority,
      severity: null,
      confidence: pkg.confidence.score,
      deadline: pkg.proposedAction.dueAt,
      // Provenance travels via the derived_from link + source ids, not a copied
      // evidence array (the Decision Package carries no raw evidence content).
      evidence: [],
      source_interactions: pkg.evidence.interactionIds,
      source_entities: pkg.evidence.entityIds,
      owner,
      automation_intent: pkg.automationIntent?.intentType ?? null,
      derived_from: observationId,
    };
    return await materialiseActions(db, tenantId, observationId, pkg.id, policyVersion, [draft]);
  }

  const route = REVIEW_ROUTE[d];
  if (route) {
    await db.from("review_tasks").insert({
      tenant_id: tenantId,
      object_id: observationId,
      route,
      reason: pkg.rationale.summary,
      decision_id: pkg.id,
    });
    return [];
  }

  if (d === "WAIT_FOR_EVENT") {
    await db.from("intelligence_objects").update({ status: "waiting" }).eq("id", observationId);
    await writeHistory(
      db,
      tenantId,
      observationId,
      "monitoring",
      "waiting",
      pkg.id,
      "Waiting on dependency",
    );
  } else if (d === "REJECT") {
    await db.from("intelligence_objects").update({ status: "cancelled" }).eq("id", observationId);
    await writeHistory(
      db,
      tenantId,
      observationId,
      "monitoring",
      "cancelled",
      pkg.id,
      "Rejected by policy",
    );
  }
  // NO_ACTION: the observation simply stands as recorded.
  return [];
}

function flattenOwnership(pkg: DecisionPackage): OwnershipAssignment[] {
  const o = pkg.ownership;
  return [
    o.responsible,
    o.accountable,
    o.approver,
    o.waitingOn,
    ...o.consulted,
    ...o.informed,
  ].filter((a): a is OwnershipAssignment => a !== null);
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
