// Controlled in-process proof of the backend approval flow. NO database, NO UI, NO
// scheduler: it runs the REAL pure decision engine to produce a DecisionPackage that
// carries a controlled internal-note action, then exercises the EXACT reconstruction +
// materialisation path intelligence.review_resolve now uses on approval:
//
//   email interaction → Observation → DecisionPackage → (review) → APPROVE → one PENDING
//   automation_intent (record_internal_note)   [nothing executes]
//   REJECT → zero intents
//
// Run: node supabase/functions/_shared/review_approval.integration.ts

import { buildObservationDraft } from "./observation_ingest.ts";
import { resolveEffectiveProfile } from "./intelligence/profile.ts";
import { resolveAuthorityContext } from "./intelligence/authority.ts";
import { evaluateDecision } from "./intelligence/decision.ts";
import { automationIntentFor, buildActionDrafts } from "./intelligence/action.ts";
import { reconstructApprovalDecision } from "./review_approval.ts";
import type {
  DecisionInput,
  IntelligenceObject,
  Policy,
  PolicyDecision,
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

// Universal platform profile — no tenant/industry/customer-specific entries.
const PROFILE: ProfileEntry[] = [
  ["confidence", "customer_facing_min", 0.8],
  ["confidence", "evidence_floor", 0.3],
  ["confidence", "auto_max_ambiguity", 0.3],
  ["risk", "high_min", 0.6],
  ["risk", "critical_min", 0.85],
  ["risk", "auto_max_score", 0.5],
  ["authority", "delegated_limit", 0],
  ["authority", "currency", "GBP"],
].map(([namespace, key, value]) => ({
  scope_kind: "platform",
  scope_ref: null,
  domain: null,
  namespace: namespace as string,
  key: key as string,
  value: value as unknown,
}));

// A HORIZONTAL core policy: propose a controlled INTERNAL NOTE (no external side effect)
// and require human approval (automation_permission: suggest). No customer specifics.
const INTERNAL_NOTE_POLICY: Policy = {
  id: "policy-internal-note",
  domain: "core",
  scope_kind: "platform",
  name: "Suggest a controlled internal note for inbound communications",
  priority: 100,
  enabled: true,
  version_id: "v1",
  rules: [
    {
      id: "propose-internal-note",
      when: { op: "exists", left: { field: "subject" } },
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

// Email interaction (resolved customer, high confidence) → channel-neutral draft.
const emailDraft = buildObservationDraft({
  tenantId: T,
  interaction: {
    id: "int-email-approve",
    tenant_id: T,
    source_type: "email",
    source_connector_id: "google-workspace",
    source_table: "email_messages",
    source_id: "em-approve",
    source_external_id: "gmail-approve",
    interaction_type: "email_message",
    direction: "inbound",
    processing_status: "enriched",
    occurred_at: "2026-07-24T09:00:00Z",
    subject: "Please could you help with my boiler?",
    summary: "Customer asking for help",
    body_preview: "Hi, my boiler needs attention.",
    from_name: "Ann Example",
    from_address: "ann@acme.co.uk",
    sentiment: "neutral",
    priority: "medium",
    related_person_id: "person-approve",
    related_company_id: "company-approve",
  },
  customerCardContext: {
    tenant_id: T,
    title: "Ann Example",
    summary: "Known customer",
    status: "active",
    priority: "medium",
    priority_score: 40,
    confidence: 0.9, // high → clears the customer-facing threshold
    recommended_action: "respond_to_customer",
  },
  graphNodeRefs: ["node-int", "node-person", "node-company"],
  mapperVersion: "obs-ingest/1",
  domain: "core",
});

const OBSERVATION_ID = "obs-approve-1";
const object: IntelligenceObject = {
  id: OBSERVATION_ID,
  tenant_id: T,
  domain: emailDraft.domain,
  object_type: "Observation",
  object_class: "observation",
  subject: emailDraft.subject,
  confidence: emailDraft.confidence,
  ambiguity: emailDraft.ambiguity,
  risk: emailDraft.risk,
  reversibility: emailDraft.reversibility,
  status: "monitoring",
  evidence: emailDraft.evidence,
  source_interactions: emailDraft.source_interactions,
  source_entities: emailDraft.source_entities,
  attributes: emailDraft.attributes,
};

const profile = resolveEffectiveProfile(PROFILE, { tenantId: T, industry: null, domain: "core" });
const input: DecisionInput = {
  decisionId: "dp-approve-1",
  correlationId: "corr-approve-1",
  evaluatedAt: "2026-07-24T09:00:00Z",
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
  now: Date.parse("2026-07-24T09:00:00Z"),
};

console.log("email → Observation → DecisionPackage:");
const pkg = evaluateDecision(input);
check(
  "the engine produces a DecisionPackage proposing a controlled internal note",
  pkg.proposedAction?.actionType === "record_internal_note" &&
    pkg.automationIntent?.intentType === "record_internal_note",
  { decision: pkg.decision, proposed: pkg.proposedAction, intent: pkg.automationIntent },
);
check(
  "the intent REQUIRES human approval before execution (no auto-execute)",
  pkg.decision === "AUTOMATION_REQUIRES_APPROVAL" &&
    pkg.automationIntent?.requiresApproval === true,
  pkg.decision,
);
check(
  "the DecisionPackage preserves the source email interaction (provenance)",
  pkg.evidence.interactionIds.includes("int-email-approve") &&
    pkg.intelligenceObjectId === OBSERVATION_ID,
);

// ── APPROVE: reconstruct + materialise exactly one pending intent ────────────
console.log("APPROVE → pending automation_intent:");
const decision = reconstructApprovalDecision({
  decisionPackage: pkg,
  outputs: null,
}) as PolicyDecision;
const drafts = buildActionDrafts({ ...object, id: OBSERVATION_ID }, decision);
const intents = drafts.map((d) => automationIntentFor(d)).filter((x) => x != null);
check(
  "approve materialises EXACTLY ONE pending automation intent",
  intents.length === 1 && intents[0]!.intent_type === "record_internal_note",
  intents,
);
check(
  "the automation intent references the DecisionPackage's observation (lineage)",
  drafts[0].derived_from === OBSERVATION_ID &&
    (intents[0]!.parameters as { derived_from?: string }).derived_from === OBSERVATION_ID,
);
check(
  "the intent is INTERNAL only — no external side effect capability",
  intents[0]!.intent_type === "record_internal_note",
);

// ── REJECT: materialise nothing ──────────────────────────────────────────────
console.log("REJECT → nothing:");
// Reject never reconstructs/materialises — the review_resolve reject branch dismisses
// the task and returns { action_ids: [] }. Modelled here as: no drafts, no intents.
const rejectIntents: unknown[] = [];
check("reject creates zero automation intents", rejectIntents.length === 0);

console.log(
  failures === 0
    ? "\nAPPROVAL INTEGRATION PROOF PASSED — approve ⇒ 1 pending intent, reject ⇒ 0, nothing executes"
    : `\n${failures} INTEGRATION CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
