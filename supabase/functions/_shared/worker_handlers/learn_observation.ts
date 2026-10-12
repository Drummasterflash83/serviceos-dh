/** Durable LEARN observations. Existing decision engine, observe-only execution. */
import type { WorkerHandlerContext, WorkerHandlerResult } from "../worker_contract.ts";
import { resolveEffectiveProfile } from "../intelligence/profile.ts";
import { resolveAuthorityContext } from "../intelligence/authority.ts";
import { evaluateDecision } from "../intelligence/decision.ts";
import { resolveOperationalMode } from "../intelligence/modes.ts";
import type { ObservationDraft } from "../observation_ingest.ts";
import type { IntelligenceObject, Policy, ProfileEntry } from "../intelligence/types.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export async function handleLearnObservation(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: db, tenantId, jobId, claim } = ctx;
  const draft = ctx.payload.observation as ObservationDraft;
  if (!uuid(jobId) || !claim?.claimedBy || !Number.isSafeInteger(claim.attemptCount))
    return {
      success: false,
      error: {
        code: "learn_observation_requires_claim",
        message: "A claimed analysis job is required.",
        retryable: false,
      },
    };
  const args = { p_tenant: tenantId, p_job: jobId, p_claim: claim };
  const receipt = (data: any): WorkerHandlerResult | null =>
    data?.version === "learn-observation-delivery/1" &&
    data.state === "committed" &&
    data.tenant_id === tenantId &&
    data.job_id === jobId &&
    uuid(data.observation_id) &&
    uuid(data.decision_id) &&
    data.interaction_id === draft.source_interactions?.[0] &&
    data.can_execute === false &&
    Array.isArray(data.action_ids) &&
    data.action_ids.length === 0 &&
    Number.isSafeInteger(data.graph_nodes) &&
    data.graph_nodes >= 1
      ? { success: true, recordsProcessed: 1, result: data }
      : null;
  try {
    const prior = await db.rpc("learn_observation_deliver", { ...args, p_result: null });
    if (prior.error) throw Error("receipt_read_unconfirmed");
    const existing = receipt(prior.data);
    if (existing) return existing;
    if (
      prior.data?.state !== "pending" ||
      prior.data?.job_id !== jobId ||
      prior.data?.tenant_id !== tenantId
    )
      throw Error("receipt_read_unconfirmed");
    const tenant = await db.from("tenants").select("industry").eq("id", tenantId).maybeSingle();
    const entries = await db
      .from("operating_profile_entries")
      .select("scope_kind, scope_ref, domain, namespace, key, value")
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
    const policies = await db
      .from("policies")
      .select("id, domain, scope_kind, name, priority, enabled, rules, version_id")
      .eq("enabled", true)
      .in("domain", ["core", draft.domain]);
    if (
      tenant.error ||
      !tenant.data ||
      entries.error ||
      !Array.isArray(entries.data) ||
      policies.error ||
      !Array.isArray(policies.data)
    )
      throw Error("decision_context_unconfirmed");
    const profile = resolveEffectiveProfile(entries.data as ProfileEntry[], {
      tenantId,
      industry: tenant.data.industry,
      domain: draft.domain,
    });
    const object: IntelligenceObject = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      domain: draft.domain,
      object_type: "Observation",
      object_class: "observation",
      subject: draft.subject,
      status: "unknown",
      severity: draft.severity,
      confidence: draft.confidence,
      ambiguity: draft.ambiguity,
      risk: draft.risk,
      reversibility: draft.reversibility,
      evidence: draft.evidence,
      source_interactions: draft.source_interactions,
      source_entities: draft.source_entities,
      attributes: draft.attributes,
    };
    const pkg = evaluateDecision({
      decisionId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      evaluatedAt: new Date().toISOString(),
      engineVersion: "decision-engine/1.0.0",
      object,
      profile,
      authority: resolveAuthorityContext(object, profile),
      objectiveContext: null,
      policies: policies.data as Policy[],
      domainPackKeys: [draft.domain],
      domainPackVersions: [],
      operatingProfileVersion: null,
      learningVersionIds: [],
      supersedes: null,
      now: Date.now(),
    });
    const operational = resolveOperationalMode(pkg, profile);
    if (operational.blocked_reason !== "mode_observe_only" || operational.can_execute)
      return {
        success: false,
        error: {
          code: "learn_observation_mode_review",
          message:
            "LEARN analysis requires an observe-only operating profile. No actions were executed.",
          retryable: false,
        },
      };
    const publish = await db.rpc("learn_observation_deliver", {
      ...args,
      p_result: { object, package: pkg, operational },
    });
    if (!publish.error) {
      const committed = receipt(publish.data);
      if (committed) return committed;
    }
    // Check the same durable job after response loss; never insert independently.
    const checked = await db.rpc("learn_observation_deliver", { ...args, p_result: null });
    if (!checked.error) {
      const committed = receipt(checked.data);
      if (committed) return committed;
    }
  } catch {
    /* Queue diagnostics deliberately omit database/provider content. */
  }
  return {
    success: false,
    error: {
      code: "learn_observation_unconfirmed",
      message: "The learning observation could not be confirmed. Retained inputs remain available.",
      retryable: true,
    },
  };
}
