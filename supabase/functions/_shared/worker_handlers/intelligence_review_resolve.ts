// ServiceOS — Worker handler: intelligence.review_resolve
//
// The OpenFolk side of the loop. A consultant either APPROVES an uncertain
// observation (materialising the proposed Action + Automation Intent) or CORRECTS
// it (recording an immutable, layered correction and proposing a VERSIONED
// improvement so the next similar decision is better). Uncertainty is resolved by
// a human before anything reaches the customer.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { buildActionDrafts } from "../intelligence/action.ts";
import { proposeImprovement } from "../intelligence/learning.ts";
import type { Correction, IntelligenceObject, PolicyDecision } from "../intelligence/types.ts";
import { materialiseActions, publish } from "./intelligence_observe.ts";

// universal/industry/tenant → the corrections.correction_kind vocabulary
const LAYER_KIND: Record<string, string> = {
  universal: "new_pattern",
  industry: "industry_preference",
  tenant: "tenant_preference",
};

export async function handleIntelligenceReviewResolve(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: db, tenantId, payload } = ctx;
  const reviewTaskId = payload?.review_task_id as string | undefined;
  const resolution = payload?.resolution as "approve" | "correct" | undefined;
  const operator = (payload?.operator as string | undefined) ?? "openfolk";
  if (!reviewTaskId || (resolution !== "approve" && resolution !== "correct")) {
    return {
      success: false,
      error: {
        code: "invalid_payload",
        message: "payload {review_task_id, resolution: approve|correct} required",
        retryable: false,
      },
    };
  }

  // Load the review task + its decision (which carries the proposed actions).
  const { data: task } = await db
    .from("review_tasks")
    .select("id, object_id, decision_id, status")
    .eq("id", reviewTaskId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!task)
    return {
      success: false,
      error: { code: "not_found", message: "review task not found", retryable: false },
    };
  if (task.status !== "pending") {
    return {
      success: false,
      error: {
        code: "already_resolved",
        message: "review task already resolved",
        retryable: false,
      },
    };
  }
  const observationId = task.object_id as string;
  const decisionId = (task.decision_id as string | null) ?? null;

  const { data: dec } = await db
    .from("decision_log")
    .select("outputs, policy_version_ids")
    .eq("id", decisionId)
    .maybeSingle();
  const outputs = (dec?.outputs ?? {}) as Record<string, unknown>;
  const policyVersion = ((dec?.policy_version_ids as string[] | null) ?? [])[0] ?? null;

  const { data: obs } = await db
    .from("intelligence_objects")
    .select("*")
    .eq("id", observationId)
    .maybeSingle();
  const observation = (obs ?? {}) as IntelligenceObject;

  if (resolution === "approve") {
    // Reconstruct just enough of the decision to rebuild the proposed actions.
    const decision = {
      priority: (outputs.priority as string | null) ?? null,
      severity: (outputs.severity as string | null) ?? null,
      deadline: (outputs.deadline as string | null) ?? null,
      assignments: (outputs.assignments as PolicyDecision["assignments"]) ?? [],
      action_proposals: (outputs.action_proposals as PolicyDecision["action_proposals"]) ?? [],
    } as PolicyDecision;

    const drafts = buildActionDrafts({ ...observation, id: observationId }, decision);
    const actionIds = await materialiseActions(
      db,
      tenantId,
      observationId,
      decisionId,
      policyVersion,
      drafts,
    );

    await db
      .from("review_tasks")
      .update({
        status: "resolved",
        resolved_by: operator,
        resolved_at: new Date().toISOString(),
        resolution: { approved: true, action_ids: actionIds },
      })
      .eq("id", reviewTaskId);
    await publish(
      db,
      tenantId,
      "intelligence.review.approved",
      observationId,
      observation.domain,
      decisionId,
      {
        action_ids: actionIds,
        operator,
      },
    );
    return {
      success: true,
      recordsProcessed: actionIds.length,
      result: { approved: true, action_ids: actionIds },
    };
  }

  // resolution === "correct"
  const correctionInput = (payload?.correction ?? {}) as Correction;
  const layer = correctionInput.layer ?? "tenant";
  const improvement = proposeImprovement({ ...correctionInput, layer, operator });

  // Immutable correction (learning), layered — never mixes universal/industry/tenant.
  let proposedVersionId: string | null = null;
  if (improvement.entry) {
    // A VERSIONED improvement: a DRAFT config version. It changes no live config
    // until it is reviewed and published (draft → simulation → review → publish).
    const { data: verRow } = await db
      .from("config_versions")
      .insert({
        tenant_id: layer === "tenant" ? tenantId : null,
        artifact_kind: "operating_profile",
        artifact_key: `learned.${layer}.${improvement.entry.namespace}.${improvement.entry.key}`,
        version: 1,
        status: "draft",
        author: operator,
        note: improvement.rationale,
      })
      .select("id")
      .single();
    proposedVersionId = (verRow?.id as string | undefined) ?? null;
  }

  const { data: corrRow } = await db
    .from("corrections")
    .insert({
      tenant_id: tenantId,
      object_id: observationId,
      decision_id: decisionId,
      before: outputs,
      after: { corrected: correctionInput.corrected, improvement_entry: improvement.entry },
      correction_kind: LAYER_KIND[layer] ?? "tenant_preference",
      scope_hint: layer, // the learning layer, preserved
      actor: operator,
      review_level: "openfolk",
      proposed_version_id: proposedVersionId,
    })
    .select("id")
    .single();

  await db
    .from("review_tasks")
    .update({
      status: "resolved",
      resolved_by: operator,
      resolved_at: new Date().toISOString(),
      resolution: {
        corrected: true,
        correction_id: corrRow?.id ?? null,
        proposed_version_id: proposedVersionId,
      },
    })
    .eq("id", reviewTaskId);
  await publish(
    db,
    tenantId,
    "intelligence.review.corrected",
    observationId,
    observation.domain,
    decisionId,
    {
      layer,
      proposed_version_id: proposedVersionId,
      operator,
    },
  );

  return {
    success: true,
    recordsProcessed: 1,
    result: { corrected: true, learning_layer: layer, proposed_version_id: proposedVersionId },
  };
}
