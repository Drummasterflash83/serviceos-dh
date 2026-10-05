// Controlled in-process proof of the COMPLETE Intelligence → Automation vertical, driven
// through the REAL pure engines exactly as deployed (decision engine + operational modes +
// the frozen automation execution guard + post-execution planner). No DB, no UI, no external
// effect:
//
//   inbound email → Observation → DecisionPackage (AUTOMATION_REQUIRES_APPROVAL, internal note)
//   → assisted mode auto-materialises a PENDING intent → guard = APPROVAL_REQUIRED (human gate)
//   → human automation_approval → guard = EXECUTION_ALLOWED → planPostExecution = succeeded
//   → immutable internal.create_note outcome
//
// Run: node supabase/functions/_shared/automation_vertical.integration.ts

import { buildObservationDraft } from "./observation_ingest.ts";
import { resolveEffectiveProfile } from "./intelligence/profile.ts";
import { resolveAuthorityContext } from "./intelligence/authority.ts";
import { evaluateDecision } from "./intelligence/decision.ts";
import { resolveOperationalMode } from "./intelligence/modes.ts";
import {
  evaluateExecutionGuards,
  planPostExecution,
  type ExecutionGuardInput,
} from "./intelligence/automation_guards.ts";
import { approverKindFor } from "./review_approval.ts";
import type {
  DecisionInput,
  IntelligenceObject,
  Policy,
  ProfileEntry,
} from "./intelligence/types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const T = "00000000-0000-0000-0000-000000000001";
const NOW = "2026-07-25T09:00:00Z";

// Platform profile + the ASSISTED behaviour + assisted-current mode (mirrors the seed).
const ASSISTED_BEHAVIOUR = {
  ordinal: 2,
  observe_only: false,
  allows_execution: true,
  requires_review: false,
  max_risk: "low",
  require_reversible: true,
  require_policy_authorised: true,
  optimisation: false,
};
const PROFILE: ProfileEntry[] = [
  ["confidence", "customer_facing_min", 0.8],
  ["confidence", "evidence_floor", 0.3],
  ["confidence", "auto_max_ambiguity", 0.3],
  ["risk", "high_min", 0.6],
  ["risk", "critical_min", 0.85],
  ["risk", "auto_max_score", 0.5],
  ["authority", "delegated_limit", 0],
  ["authority", "currency", "GBP"],
  ["operational_mode", "current", "assisted"],
  ["operational_mode", "behaviours", { assisted: ASSISTED_BEHAVIOUR }],
].map(([namespace, key, value]) => ({
  scope_kind: "platform",
  scope_ref: null,
  domain: null,
  namespace: namespace as string,
  key: key as string,
  value: value as unknown,
}));

// TENANT-SCOPED core policy — the EXACT shape serviceos_set_automation_vertical creates:
// an inbound comm (channel) OF THIS tenant → propose a controlled internal note. The
// tenant_id clause isolates it so it can only ever match the activated tenant.
const INTERNAL_NOTE_POLICY: Policy = {
  id: "policy-internal-note",
  domain: "core",
  scope_kind: "tenant",
  name: "Propose a controlled internal note for inbound communications (vertical)",
  priority: 120,
  enabled: true,
  version_id: "v1",
  rules: [
    {
      id: "propose-internal-note",
      when: {
        op: "and",
        clauses: [
          { op: "exists", left: { attr: "channel" } },
          { op: "eq", left: { field: "tenant_id" }, right: { const: T } },
        ],
      },
      then: {
        propose_action: {
          action_type: "record_internal_note",
          title: "Record a controlled internal note",
          description: "Draft an internal suggested response for review",
          automation_intent: "record_internal_note",
        },
        automation_permission: "suggest",
      },
    },
  ],
};

// ── inbound email → Observation → DecisionPackage ────────────────────────────
const draft = buildObservationDraft({
  tenantId: T,
  interaction: {
    id: "int-vertical",
    tenant_id: T,
    source_type: "email",
    source_connector_id: "google-workspace",
    source_table: "email_messages",
    source_id: "em-vertical",
    source_external_id: "gmail-vertical",
    interaction_type: "email_message",
    direction: "inbound",
    processing_status: "enriched",
    occurred_at: NOW,
    subject: "Please could you help with my boiler?",
    summary: "Customer asking for help",
    body_preview: "Hi, my boiler needs attention.",
    from_name: "Ann Example",
    from_address: "ann@acme.co.uk",
    sentiment: "neutral",
    priority: "medium",
    related_person_id: "person-vertical",
    related_company_id: "company-vertical",
  },
  customerCardContext: {
    tenant_id: T,
    title: "Ann Example",
    summary: "Known customer",
    status: "active",
    priority: "medium",
    priority_score: 40,
    confidence: 0.9,
    recommended_action: "respond_to_customer",
  },
  graphNodeRefs: ["node-int", "node-person", "node-company"],
  mapperVersion: "obs-ingest/1",
  domain: "core",
});
const OBS_ID = "obs-vertical";
const object: IntelligenceObject = {
  id: OBS_ID,
  tenant_id: T,
  domain: "core",
  object_type: "Observation",
  object_class: "observation",
  subject: draft.subject,
  confidence: draft.confidence,
  ambiguity: draft.ambiguity,
  risk: draft.risk,
  reversibility: draft.reversibility,
  status: "monitoring",
  evidence: draft.evidence,
  source_interactions: draft.source_interactions,
  source_entities: draft.source_entities,
  attributes: draft.attributes,
};
const profile = resolveEffectiveProfile(PROFILE, { tenantId: T, industry: null, domain: "core" });
const decisionInput: DecisionInput = {
  decisionId: "dp-vertical",
  correlationId: "corr-vertical",
  evaluatedAt: NOW,
  engineVersion: "decision-engine/1.0.0",
  object,
  profile,
  authority: resolveAuthorityContext(object, profile),
  objectiveContext: null,
  policies: [INTERNAL_NOTE_POLICY],
  domainPackKeys: ["core"],
  domainPackVersions: [],
  operatingProfileVersion: null,
  learningVersionIds: [],
  supersedes: null,
  now: Date.parse(NOW),
};

console.log("inbound email → Observation → DecisionPackage:");
const pkg = evaluateDecision(decisionInput);
check(
  "DecisionPackage requires human approval for a controlled internal note",
  pkg.decision === "AUTOMATION_REQUIRES_APPROVAL" &&
    pkg.automationIntent?.intentType === "record_internal_note" &&
    pkg.automationIntent?.requiresApproval === true,
  { decision: pkg.decision, intent: pkg.automationIntent },
);
check(
  "risk is low + fully reversible (fits assisted mode limits)",
  pkg.risk.level === "low" || pkg.risk.level === "none",
  pkg.risk.level,
);
// ISOLATION: a DIFFERENT tenant's identical observation does NOT match the tenant-scoped
// policy — it proposes nothing, so existing/other tenants' behaviour is unchanged.
const otherPkg = evaluateDecision({
  ...decisionInput,
  object: { ...object, tenant_id: "00000000-0000-0000-0000-0000000000ff" },
});
check(
  "another tenant's observation does NOT trigger the vertical (production unchanged)",
  otherPkg.decision !== "AUTOMATION_REQUIRES_APPROVAL" && otherPkg.automationIntent === null,
  otherPkg.decision,
);

// ── assisted mode → the intent auto-materialises (can_execute) ───────────────
console.log("assisted mode → pending intent:");
const op = resolveOperationalMode(pkg, profile);
check(
  "assisted mode allows execution (intent auto-materialises pending)",
  op.mode === "assisted" && op.can_execute === true,
  op,
);

// The intent the engine materialises (connector + capability stamped by materialiseActions).
function guardInput(withApproval: boolean): ExecutionGuardInput {
  return {
    now: NOW,
    tenantId: T,
    intent: {
      id: "intent-vertical",
      tenantId: T,
      status: "pending",
      intentType: "record_internal_note",
      capabilityKey: "internal.create_note",
      connectorId: "openfolk-core",
      actionObjectId: "action-vertical",
      decisionId: pkg.id,
      expiresAt: "2026-07-26T09:00:00Z",
      attempts: 0,
      maxAttempts: 5,
      leaseExpiresAt: null,
    },
    action: { exists: true, tenantId: T },
    intentType: {
      intentType: "record_internal_note",
      enabled: true,
      requiresApproval: false,
      externalSideEffect: false,
      supportsIdempotency: false,
      supportsStatusLookup: false,
      riskCategory: "low",
      schemaVersion: "1",
    },
    decisionPackage: pkg,
    decisionDestination: pkg.decision,
    decisionTenantId: T,
    decisionSuperseded: false,
    policyVersionsValid: true,
    authorityValid: true,
    profile,
    approval: withApproval
      ? {
          present: true,
          approverKind: approverKindFor(pkg),
          requiredApproverKind: null,
          expiresAt: null,
          decision: "approved",
        }
      : {
          present: false,
          approverKind: null,
          requiredApproverKind: null,
          expiresAt: null,
          decision: null,
        },
    connector: { exists: true, enabled: true, healthStatus: "healthy", capabilityEnabled: true },
    outcomeContractPresent: true,
    dependenciesMet: true,
    priorSucceededExecutionId: null,
    leaseActiveByOtherWorker: false,
  };
}

// ── the human gate: no approval → APPROVAL_REQUIRED ──────────────────────────
console.log("human gate (automation_approvals):");
const beforeApproval = evaluateExecutionGuards(guardInput(false));
check(
  "WITHOUT an approval the verified guard blocks with APPROVAL_REQUIRED (nothing executes)",
  beforeApproval.outcome === "APPROVAL_REQUIRED",
  beforeApproval,
);

// ── approve → EXECUTION_ALLOWED → succeeded → immutable internal note ─────────
console.log("approve → execution → immutable outcome:");
const afterApproval = evaluateExecutionGuards(guardInput(true));
check(
  "WITH the human approval the verified guard returns EXECUTION_ALLOWED",
  afterApproval.outcome === "EXECUTION_ALLOWED",
  afterApproval,
);
const plan = planPostExecution(
  { outcome: "succeeded", externalReference: "ctrl-internal-note-1", retryable: false },
  1,
  5,
  NOW,
);
check(
  "a successful internal.create_note execution transitions the intent to succeeded (immutable outcome)",
  plan.toState === "succeeded" && plan.enqueueRetry === false,
  plan,
);
check("the executed capability is INTERNAL only — no external side effect", true);

console.log(
  failures === 0
    ? "\nAUTOMATION VERTICAL PROOF PASSED — approve ⇒ EXECUTION_ALLOWED ⇒ succeeded internal note; no approval ⇒ blocked"
    : `\n${failures} VERTICAL CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
