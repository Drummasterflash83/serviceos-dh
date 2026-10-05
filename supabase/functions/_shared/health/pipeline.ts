// ServiceOS — Customer Health: pure shadow pipeline.
//
// Ties the pure engines into one deterministic shadow lifecycle step:
//   communication → classify → resolve subject → derive obligation → assess Health →
//   propose commitment → emit a WRITE PLAN (health_* tables only).
//
// It STOPS before any canonical operational work. The write plan names only
// shadow-allowlisted tables and is asserted by the caller (shadow_safety.ts). Nothing
// here touches a DB — the impure handler executes the plan.

import {
  type CallbackClassification,
  type CallbackPolicyConfig,
  type CommunicationInput,
  DEFAULT_CALLBACK_POLICY,
  type HealthReading,
  type OwnershipMaps,
  type OwnershipResolution,
  type OwnershipSourceKind,
  type SubjectResolution,
} from "./types.ts";
import { classifyCallback } from "./classifier.ts";
import { DEFAULT_OWNERSHIP_ORDER, resolveOwnership } from "./ownership.ts";
import { evaluateCallbackHealth, resolveHealthSubject } from "./evaluator.ts";
import { CALLBACK_CLASSIFIER_VERSION, HEALTH_EVALUATOR_VERSION, stableHash } from "./hash.ts";
import { assertShadowSafe, type ShadowSafetyResult } from "./shadow_safety.ts";

const HOUR_MS = 3_600_000;

/** Coarse, deterministic topic token so the SAME obligation folds and DIFFERENT
 * obligations for the same customer stay separate. Derived from content — never used
 * as the sole grouping key (subject is always part of group_key). */
export function topicToken(text: string | null | undefined): string {
  const t = (text ?? "").toLowerCase();
  if (/quote|quotation|estimate|pricing/.test(t)) return "quote";
  if (/book|appointment|schedule|slot|reschedul/.test(t)) return "booking";
  if (/complaint|unhappy|angry|disappoint|not happy/.test(t)) return "complaint";
  if (/invoice|bill|payment|refund|overcharg/.test(t)) return "billing";
  if (/leak|boiler|breakdown|no heat|no hot water|repair|service|fault/.test(t)) return "service";
  return "general";
}

export interface ShadowContext {
  tenantId: string;
  policyVersionId: string | null;
  policyPublished: boolean; // shadow refuses live candidates unless the policy is published
  // Source boundary (DEFAULT-DENY): processing refuses unless the tenant allowlist is
  // explicitly enabled AND the candidate's channel is explicitly listed. Missing
  // configuration is treated as disabled, never as permissive.
  sourceAllowlistEnabled: boolean;
  allowedSources: string[];
  policy: Partial<CallbackPolicyConfig>;
  ownershipMaps: Partial<OwnershipMaps>;
  ownershipOrder?: OwnershipSourceKind[];
  minCompanyConfidence?: number;
  // resolved identity for the communication's subject
  companyId: string | null;
  companyConfidence?: number | null;
  personId: string | null;
  // folding / history context (supplied by the handler after a lookup; all optional)
  priorState?: import("./types.ts").HealthState | null;
  existingRepeatContactCount?: number; // contacts already on this obligation
  resolution?: "none" | "possible" | "verified";
  nowMs: number;
}

export interface DesiredHealthObject {
  tenant_id: string;
  health_type: "customer_health";
  subject_type: "company" | "person";
  subject_id: string;
  active_policy_version_id: string | null;
  accountable_ref: Record<string, unknown> | null;
  mode: "shadow";
}
export interface DesiredAssessment {
  tenant_id: string;
  state: HealthReading["state"];
  trend: HealthReading["trend"];
  drivers: HealthReading["drivers"];
  risks: string[];
  opportunities: string[];
  confidence: number;
  freshness: string;
  evidence: HealthReading["evidence"];
  evaluator_version: string;
  policy_version_id: string | null;
  mode: "shadow";
  input_hash: string;
  triggered_by: string;
  changed: Record<string, unknown>;
}
export interface DesiredProposal {
  tenant_id: string;
  commitment_type: "callback";
  proposed_title: string;
  proposed_outcome: string;
  proposed_done_when: string;
  proposed_due_at: string | null;
  proposed_accountable_ref: Record<string, unknown> | null;
  proposed_handler_ref: Record<string, unknown> | null;
  proposed_waiting_on: Record<string, unknown> | null;
  // 'proposed' = new open shadow work; 'resolved_shadow' = already-satisfied on arrival
  // (captured, but NEVER surfaced as new open work).
  state: "proposed" | "resolved_shadow";
  confidence: number;
  ambiguity: number;
  policy_version_id: string | null;
  classifier_version: string;
  group_key: string;
  mode: "shadow";
  resolution_state: "none" | "possible" | "verified";
}
export interface DesiredSource {
  tenant_id: string;
  source_kind: "interaction" | "recommendation" | "related_evidence" | "resolution_interaction";
  source_ref: string;
  role: "candidate_evidence" | "resolution_possible" | "resolution_verifying" | "related";
  excerpt: string | null;
  confidence: number | null;
  observed_at: string | null;
}

export type ShadowOutcome =
  | "candidate_proposed"
  | "excluded"
  | "needs_context"
  | "skipped_unpublished"
  | "skipped_source_boundary_disabled"
  | "skipped_source_not_allowed";

/** Outcomes that write NOTHING — the candidate never crosses the shadow boundary. */
export const NON_WRITING_OUTCOMES: ReadonlySet<ShadowOutcome> = new Set([
  "excluded",
  "skipped_unpublished",
  "skipped_source_boundary_disabled",
  "skipped_source_not_allowed",
]);

export interface ShadowResult {
  outcome: ShadowOutcome;
  reasons: string[];
  classification: CallbackClassification;
  subject: SubjectResolution;
  ownership: OwnershipResolution | null;
  groupKey: string | null;
  healthObject: DesiredHealthObject | null;
  assessment: DesiredAssessment | null;
  proposal: DesiredProposal | null;
  sources: DesiredSource[];
  writeTables: string[]; // the tables the handler will write for this result
  shadowSafety: ShadowSafetyResult;
}

function utcDayBucket(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Run one shadow lifecycle step for one communication. Pure and deterministic.
 */
export function runShadowPipeline(input: {
  communication: CommunicationInput;
  ctx: ShadowContext;
}): ShadowResult {
  const { communication: c, ctx } = input;
  const cfg: CallbackPolicyConfig = { ...DEFAULT_CALLBACK_POLICY, ...(ctx.policy ?? {}) };
  const classification = classifyCallback(c, cfg);
  const empty = (
    outcome: ShadowOutcome,
    subject: SubjectResolution,
    ownership: OwnershipResolution | null,
    reasons: string[],
    tables: string[] = [],
  ): ShadowResult => ({
    outcome,
    reasons,
    classification,
    subject,
    ownership,
    groupKey: null,
    healthObject: null,
    assessment: null,
    proposal: null,
    sources: [],
    writeTables: tables,
    shadowSafety: assertShadowSafe(tables),
  });

  const noSubject: SubjectResolution = {
    resolved: false,
    subjectType: null,
    subjectId: null,
    reason: "n/a",
  };

  // Shadow refuses to process live candidates unless the tenant policy is PUBLISHED
  // (the source boundary is disabled/draft by default).
  if (!ctx.policyPublished) {
    return empty("skipped_unpublished", noSubject, null, [
      "Tenant Customer Health policy is not published — shadow processing is disabled.",
    ]);
  }

  // Source boundary — DEFAULT DENY. The allowlist must be explicitly enabled AND the
  // candidate's channel explicitly listed; missing/blank configuration refuses.
  if (!ctx.sourceAllowlistEnabled) {
    return empty("skipped_source_boundary_disabled", noSubject, null, [
      "The tenant source allowlist is disabled — no source is selected for shadow processing.",
    ]);
  }
  const channel = (c.interactionType ?? "").toLowerCase().trim();
  if (!channel || !ctx.allowedSources.includes(channel)) {
    return empty("skipped_source_not_allowed", noSubject, null, [
      `Source '${channel || "unknown"}' is not in the tenant's allowed sources.`,
    ]);
  }

  // Excluded communications never create a Health Object or proposal.
  if (classification.route === "exclude") {
    return empty("excluded", noSubject, null, [classification.reason]);
  }

  // Resolve subject. Ambiguous/absent → needs_context, NO Health Object.
  const subject = resolveHealthSubject({
    companyId: ctx.companyId,
    companyConfidence: ctx.companyConfidence ?? null,
    personId: ctx.personId,
    minCompanyConfidence: ctx.minCompanyConfidence,
  });
  if (!subject.resolved || !subject.subjectType || !subject.subjectId) {
    return empty("needs_context", subject, null, [subject.reason]);
  }

  // Uncertain intent → needs_context (no proposal). The subject and an 'unknown'
  // assessment ARE recorded — with the uncertainty explained in the assessment's own
  // evidence — so the surface can show "why unknown". No proposal-source row is
  // written (sources attach to proposals; the write plan below states exactly that).
  const isUncertain = classification.route === "uncertain";

  // Ownership proposal (deterministic from tenant config).
  const ownership = resolveOwnership(
    classification.ownershipHint,
    ctx.ownershipMaps,
    ctx.ownershipOrder ?? DEFAULT_OWNERSHIP_ORDER,
  );

  // Derive obligation state.
  const dueHours = classification.suggestedDueHours ?? cfg.defaultDueHours;
  const candidateAt = c.occurredAt ?? new Date(ctx.nowMs).toISOString();
  const dueAt = c.occurredAt
    ? new Date(Date.parse(c.occurredAt) + dueHours * HOUR_MS).toISOString()
    : new Date(ctx.nowMs + dueHours * HOUR_MS).toISOString();
  const resolution = ctx.resolution ?? "none";
  const repeatContactCount = (ctx.existingRepeatContactCount ?? 0) + 1;
  const hasOpenCallback = !isUncertain && resolution !== "verified";

  const reading = evaluateCallbackHealth({
    obligation: {
      hasOpenCallback,
      candidateAt,
      dueAt,
      repeatContactCount,
      resolution,
      newestEvidenceAt: candidateAt,
      ambiguity: classification.ambiguity,
    },
    policy: cfg,
    priorState: ctx.priorState ?? null,
    nowMs: ctx.nowMs,
    extraEvidence: [
      ...(classification.supportingExcerpt
        ? [{ source: c.interactionType ?? "interaction", detail: classification.supportingExcerpt }]
        : []),
      // For uncertain routes, the assessment itself must explain what could not be
      // established (its evidence is the ONLY persisted record — no source row).
      ...(isUncertain ? [{ source: "classifier", detail: classification.reason }] : []),
    ],
  });

  const groupKey = `callback:${subject.subjectType}:${subject.subjectId}:${topicToken(
    [c.subject, c.summary, c.bodyPreview].filter(Boolean).join(" "),
  )}`;

  const healthObject: DesiredHealthObject = {
    tenant_id: ctx.tenantId,
    health_type: "customer_health",
    subject_type: subject.subjectType,
    subject_id: subject.subjectId,
    active_policy_version_id: ctx.policyVersionId,
    accountable_ref: ownership.responsibility
      ? {
          responsibility: ownership.responsibility,
          source: ownership.source,
          label: ownership.label,
        }
      : null,
    mode: "shadow",
  };

  // Idempotency identity for the assessment (day-bucketed so overdue transitions across
  // days append a new snapshot; identical inputs within a day collapse to one).
  const input_hash = stableHash({
    t: ctx.tenantId,
    s: `${subject.subjectType}:${subject.subjectId}`,
    st: reading.state,
    open: hasOpenCallback,
    due: dueAt,
    rep: repeatContactCount,
    res: resolution,
    day: utcDayBucket(ctx.nowMs),
    ev: HEALTH_EVALUATOR_VERSION,
    pv: ctx.policyVersionId,
  });

  const assessment: DesiredAssessment = {
    tenant_id: ctx.tenantId,
    state: reading.state,
    trend: reading.trend,
    drivers: reading.drivers,
    risks: reading.risks,
    opportunities: reading.opportunities,
    confidence: reading.confidence,
    freshness: reading.freshness,
    evidence: reading.evidence,
    evaluator_version: HEALTH_EVALUATOR_VERSION,
    policy_version_id: ctx.policyVersionId,
    mode: "shadow",
    input_hash,
    triggered_by: "candidate",
    changed: reading.changed,
  };

  const sources: DesiredSource[] = [
    {
      tenant_id: ctx.tenantId,
      source_kind: "interaction",
      source_ref: c.interactionId,
      role: "candidate_evidence",
      excerpt: classification.supportingExcerpt,
      confidence: classification.confidence,
      observed_at: c.occurredAt,
    },
  ];

  // Uncertain → subject + 'unknown' assessment recorded, NO proposal and NO
  // proposal-source row (sources attach to proposals). The declared write plan is
  // exactly what the store executes.
  if (isUncertain) {
    return {
      outcome: "needs_context",
      reasons: [classification.reason],
      classification,
      subject,
      ownership,
      groupKey,
      healthObject,
      assessment,
      proposal: null,
      sources: [],
      writeTables: ["health_objects", "health_assessments"],
      shadowSafety: assertShadowSafe(["health_objects", "health_assessments"]),
    };
  }

  const proposal: DesiredProposal = {
    tenant_id: ctx.tenantId,
    commitment_type: "callback",
    proposed_title:
      classification.reasonCode === "explicit_callback_named"
        ? (classification.requestedOutcome ?? "Call the customer back")
        : "Call the customer back",
    proposed_outcome:
      classification.requestedOutcome ?? "The customer receives the return call they asked for.",
    proposed_done_when: "The customer has been called back and the request addressed.",
    proposed_due_at: dueAt,
    proposed_accountable_ref: ownership.responsibility
      ? {
          responsibility: ownership.responsibility,
          source: ownership.source,
          label: ownership.label,
          explanation: ownership.explanation,
        }
      : null,
    proposed_handler_ref: null,
    proposed_waiting_on: null,
    // Already-satisfied on arrival ⇒ captured as resolved_shadow, not new open work.
    state: resolution === "verified" ? "resolved_shadow" : "proposed",
    confidence: classification.confidence,
    ambiguity: classification.ambiguity,
    policy_version_id: ctx.policyVersionId,
    classifier_version: CALLBACK_CLASSIFIER_VERSION,
    group_key: groupKey,
    mode: "shadow",
    resolution_state: resolution,
  };

  const writeTables = [
    "health_objects",
    "health_assessments",
    "health_commitment_proposals",
    "health_proposal_sources",
  ];

  return {
    outcome: "candidate_proposed",
    reasons: [classification.reason, ownership.explanation],
    classification,
    subject,
    ownership,
    groupKey,
    healthObject,
    assessment,
    proposal,
    sources,
    writeTables,
    shadowSafety: assertShadowSafe(writeTables),
  };
}
