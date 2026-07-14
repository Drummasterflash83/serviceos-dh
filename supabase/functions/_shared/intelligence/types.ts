// Universal Intelligence Foundation — shared types (pure, dependency-free).
//
// These types are the ONLY language the engine speaks. They intentionally carry
// no Supabase / Deno imports so the pure core (profile resolver + policy
// evaluator) is unit-testable with plain `node`.

export type UniversalState =
  | "unknown"
  | "waiting"
  | "blocked"
  | "ready"
  | "monitoring"
  | "escalated"
  | "approved"
  | "rejected"
  | "complete"
  | "cancelled";

export type PartyKind =
  | "user"
  | "role"
  | "department"
  | "team"
  | "customer"
  | "supplier"
  | "engineer"
  | "external"
  | "ai_agent"
  | "automation";

export type RaciRole =
  "responsible" | "accountable" | "consulted" | "informed" | "waiting_on" | "approver" | "observer";

export type ReviewRoute = "auto" | "openfolk" | "tenant_senior" | "manual";

/** A polymorphic party reference. `ref` may be a literal, or resolved from a
 *  profile value at evaluation time (e.g. the default accountable role). */
export interface PartyRef {
  kind: PartyKind;
  ref: string;
}

export interface OwnershipAssignment {
  raci_role: RaciRole;
  party_kind: PartyKind;
  party_ref: string;
}

/** The universal intelligence object (evaluation-relevant subset). */
export interface IntelligenceObject {
  id?: string;
  tenant_id: string;
  domain: string;
  object_type: string;
  /** Sensing vs work vs insight — 'observation' | 'action' | 'insight' | ... */
  object_class?: string;
  subject: string;
  priority?: string | null;
  severity?: string | null;
  confidence?: number | null;
  ambiguity?: number | null;
  risk?: number | null;
  reversibility?: number | null;
  status: UniversalState;
  domain_state?: string | null;
  deadline?: string | null;
  evidence?: unknown[];
  source_interactions?: string[];
  source_entities?: string[];
  created_by?: string | null;
  created_from?: string | null;
  attributes?: Record<string, unknown>;
}

/** Resolved effective profile: namespace → key → value. */
export type EffectiveProfile = Record<string, Record<string, unknown>>;

// ── Policy DSL ──────────────────────────────────────────────────────────────

/** An operand resolves to a value against (object, profile). */
export type Operand =
  | { field: string } // an IntelligenceObject field
  | { attr: string } // a key in object.attributes
  | { profile: string } // "namespace.key" in the effective profile
  | { const: unknown };

export type Condition =
  | { op: "and"; clauses: Condition[] }
  | { op: "or"; clauses: Condition[] }
  | { op: "not"; clause: Condition }
  | { op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte"; left: Operand; right: Operand }
  | { op: "in"; left: Operand; right: Operand }
  | { op: "exists"; left: Operand };

/** A policy's proposal to create an Action (owner ref may resolve from profile). */
export interface ActionProposalSpec {
  action_type: string;
  title: string;
  description?: string;
  reason?: string;
  automation_intent?: string;
  owner?: { raci_role: RaciRole; party_kind: PartyKind; party_ref: string | Operand };
}

/** A resolved action proposal on a decision (owner concrete). */
export interface ActionProposal {
  action_type: string;
  title: string;
  description: string | null;
  reason: string | null;
  automation_intent: string | null;
  owner: OwnershipAssignment | null;
}

/** A closed, typed set of effects — nothing outside this can happen. */
export interface Effects {
  set_priority?: string;
  set_severity?: string;
  set_deadline_hours?: Operand | number;
  assign?: Array<{ raci_role: RaciRole; party_kind: PartyKind; party_ref: string | Operand }>;
  /** Propose an Action derived from this object (materialised by the shell). */
  propose_action?: ActionProposalSpec;
  review_route?: ReviewRoute;
  recommended_action?: string;
  escalate?: boolean;
  automation_permission?: "none" | "suggest" | "act";
  /** Policy explicitly forbids acting on this object (→ REJECT). */
  prohibit?: boolean;
  reason?: string;
}

export interface Rule {
  id: string;
  when: Condition;
  then: Effects;
}

export interface Policy {
  id: string;
  domain: string;
  scope_kind: string;
  name: string;
  priority: number;
  enabled?: boolean;
  rules: Rule[];
  version_id: string;
}

export interface MatchedRule {
  policy_id: string;
  rule_id: string;
  reason?: string;
}

/** The deterministic output of evaluating an object against the policy set. */
export interface PolicyDecision {
  priority: string | null;
  severity: string | null;
  deadline: string | null; // ISO
  assignments: OwnershipAssignment[];
  review_route: ReviewRoute;
  recommended_action: string | null;
  automation_permission: "none" | "suggest" | "act";
  /** True only when a policy EXPLICITLY set the automation permission. A false
   *  here on an automatable action means the automation policy is missing. */
  automation_permission_set: boolean;
  action_proposals: ActionProposal[];
  prohibited: boolean;
  reasons: string[];
  matched_rules: MatchedRule[];
  policy_version_ids: string[];
  input_hash: string;
}

// ── Profile resolution context ──────────────────────────────────────────────

export interface ProfileEntry {
  scope_kind: "platform" | "industry" | "domain" | "tenant" | "department" | "team" | "user";
  scope_ref: string | null;
  domain: string | null;
  namespace: string;
  key: string;
  value: unknown;
}

export interface ResolveContext {
  tenantId: string;
  industry?: string | null;
  domain: string;
  orgUnitPath?: string[]; // department/team ids applying to the actor/subject
  userId?: string | null;
}

// ── Action loop ─────────────────────────────────────────────────────────────

/** A materialised Action draft, derived from an Observation via policy. */
export interface ActionDraft {
  domain: string;
  object_type: "Action";
  object_class: "action";
  subject: string;
  action_type: string;
  description: string | null;
  reason: string | null;
  priority: string | null;
  severity: string | null;
  confidence: number | null;
  status: UniversalState;
  deadline: string | null;
  evidence: unknown[];
  source_interactions: string[];
  source_entities: string[];
  owner: OwnershipAssignment | null;
  automation_intent: string | null;
  derived_from: string | null; // the Observation object id
}

/** The intelligence layer EMITS this; a separate Automation Engine executes it. */
export interface AutomationIntent {
  intent_type: string;
  parameters: Record<string, unknown>;
}

// ── Learning ────────────────────────────────────────────────────────────────

export type LearningLayer = "universal" | "industry" | "tenant";

/** A human correction. `target` names the profile fact to adjust, if any. */
export interface Correction {
  original: unknown;
  corrected: unknown;
  why: string;
  layer: LearningLayer;
  operator: string;
  confidence?: number | null;
  policy_version_ids?: string[];
  target?: {
    namespace: string;
    key: string;
    value: unknown;
    scope_ref?: string | null; // industry key / tenant id (null for universal)
    domain?: string | null;
  };
}

/** A proposed versioned improvement produced from a correction. */
export interface Improvement {
  layer: LearningLayer;
  entry: ProfileEntry | null; // the profile delta to publish (null = no config change)
  rationale: string;
}

// ── Operational Modes ────────────────────────────────────────────────────────
// The Decision Engine decides WHAT should happen. Operational Modes decide HOW
// MUCH AUTONOMY the platform currently has for this tenant — i.e. what is ALLOWED
// to happen. Modes only CONSTRAIN execution; they never change decision logic.

export type OperationalMode =
  "discovery" | "recommendation" | "assisted" | "trusted" | "optimisation";

/** Data-driven behaviour of a mode. Comes from configuration, never hardcoded. */
export interface ModeBehaviour {
  ordinal: number; // progression order (discovery=0 … optimisation=4)
  observe_only: boolean; // nothing proceeds beyond observation (discovery)
  allows_execution: boolean; // may anything execute automatically at all
  requires_review: boolean; // everything routes to OpenFolk review (recommendation)
  max_risk: RiskLevel; // ceiling for auto-execution
  require_reversible: boolean; // only fully_reversible may auto-execute (assisted)
  require_policy_authorised: boolean; // only policy-authorised decisions may execute
  optimisation: boolean; // continuous-optimisation behaviours active
}

/** How much autonomy the platform currently has for THIS decision, for this
 *  tenant. Produced after the DecisionPackage, before handler execution. */
export interface OperationalDecision {
  mode: string;
  allowed: boolean; // may this decision proceed beyond observation at all
  can_execute: boolean; // may it execute automatically now
  requires_openfolk: boolean;
  requires_customer: boolean;
  requires_tenant: boolean;
  max_risk: RiskLevel;
  optimisation: boolean;
  notes: string;
  blocked_reason: string | null; // stable code when execution is blocked/withheld
}

export interface MaturityMetrics {
  accuracy: number;
  false_positives: number;
  false_negatives: number;
  manual_overrides: number;
  automation_success: number;
  customer_confidence: number;
  openfolk_confidence: number;
}

/** A RECOMMENDATION only — the engine never auto-promotes a tenant's mode. */
export interface MaturityRecommendation {
  current_mode: string;
  recommended_mode: string;
  ready: boolean;
  rationale: string[];
  unmet: string[];
}

// ── Universal Decision Engine ────────────────────────────────────────────────

/** The single authoritative destination for the next step. */
export type DecisionDestination =
  | "AUTOMATION_AUTHORISED"
  | "AUTOMATION_REQUIRES_APPROVAL"
  | "OPENFOLK_REVIEW"
  | "TENANT_SENIOR_REVIEW"
  | "CUSTOMER_APPROVAL"
  | "WAIT_FOR_EVENT"
  | "ESCALATE"
  | "REJECT"
  | "NO_ACTION";

export type OwnerKind =
  | "ai"
  | "automation"
  | "openfolk_user"
  | "tenant_user"
  | "tenant_role"
  | "customer"
  | "supplier"
  | "external_party"
  | "event";

/** A currency-tagged amount. Comparisons across unlike currencies are refused. */
export interface Money {
  amount: number;
  currency: string;
}

/** Domain-neutral authority facts, RESOLVED before the pure engine runs. The
 *  engine compares these; it never reads authority from arbitrary attributes. */
export interface AuthorityContext {
  authorityType:
    | "none"
    | "financial"
    | "commercial"
    | "contractual"
    | "legal"
    | "compliance"
    | "safety"
    | "operational"
    | "policy_exception";
  requestedValue: Money | null;
  delegatedLimit: Money | null;
  requiredAuthorityHolder:
    | "ai"
    | "automation"
    | "openfolk"
    | "tenant_role"
    | "tenant_user"
    | "customer"
    | "external_party";
  resolvedHolderId: string | null;
  /** True when the required authority is already delegated (no approval needed). */
  delegated: boolean;
  explicitCustomerApprovalRequired: boolean;
  sourcePolicyIds: string[];
}

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";
export type ReversibilityLevel = "fully_reversible" | "partially_reversible" | "irreversible";
export type ImpactLevel = "low" | "medium" | "high" | "critical";
export type ImpactCategory =
  | "financial"
  | "customer"
  | "legal"
  | "compliance"
  | "safety"
  | "reputation"
  | "production"
  | "service"
  | "inventory"
  | "supplier";

export interface DecisionOwner {
  kind: OwnerKind;
  id?: string;
  roleKey?: string;
  displayLabel?: string;
}

/** Fully-resolved input — the engine NEVER queries anything itself. */
export interface DecisionInput {
  decisionId: string; // caller-supplied (deterministic replay)
  correlationId: string;
  evaluatedAt: string; // caller-supplied ISO (deterministic replay)
  engineVersion: string;
  object: IntelligenceObject;
  profile: EffectiveProfile;
  policies: Policy[];
  /** Domain-neutral authority facts, resolved by the caller before entry. */
  authority: AuthorityContext;
  domainPackKeys: string[];
  domainPackVersions: string[];
  operatingProfileVersion: string | null;
  learningVersionIds: string[];
  supersedes?: string | null;
  now: number;
}

/** The immutable, complete output — the ONLY downstream decision authority. */
export interface DecisionPackage {
  id: string;
  tenantId: string;
  supersedes: string | null;

  intelligenceObjectId: string;
  intelligenceObjectType: string;
  objectClass: string;
  domainPackKeys: string[];

  decision: DecisionDestination;
  nextDecisionOwner: DecisionOwner;

  rationale: {
    summary: string;
    reasonCodes: string[];
    policyMatches: string[];
    rejectedAlternatives: string[];
    /** Decision-critical config keys that were absent (structured, no content). */
    missingConfiguration: string[];
  };

  confidence: {
    score: number;
    threshold: number;
    ambiguityScore: number;
    evidenceQuality: number;
  };

  authority: {
    requiredAuthority: string | null;
    resolvedAuthorityHolder: string | null;
    delegatedLimit: number | null;
    requestedValue: number | null;
    withinDelegatedAuthority: boolean;
  };

  risk: { level: RiskLevel; score: number; categories: string[] };
  reversibility: { level: ReversibilityLevel; compensationAvailable: boolean };
  impact: { level: ImpactLevel; categories: ImpactCategory[] };

  ownership: {
    responsible: OwnershipAssignment | null;
    accountable: OwnershipAssignment | null;
    approver: OwnershipAssignment | null;
    waitingOn: OwnershipAssignment | null;
    consulted: OwnershipAssignment[];
    informed: OwnershipAssignment[];
  };

  proposedAction: {
    actionType: string;
    title: string;
    description: string | null;
    priority: string | null;
    dueAt: string | null;
  } | null;

  automationIntent: {
    intentType: string;
    payload: Record<string, unknown>;
    requiresApproval: boolean;
  } | null;

  routing: {
    reviewRequired: boolean;
    openfolkRequired: boolean;
    tenantReviewRequired: boolean;
    customerApprovalRequired: boolean;
    waitCondition: Record<string, unknown> | null;
  };

  versions: {
    engineVersion: string;
    operatingProfileVersion: string | null;
    policyVersionIds: string[];
    learningVersionIds: string[];
    domainPackVersions: string[];
  };

  evidence: {
    interactionIds: string[];
    entityIds: string[];
    objectIds: string[];
    evidenceHash: string;
  };

  outcomeContract: {
    expectedOutcomeType: string | null;
    measurableSignals: string[];
    timeoutAt: string | null;
    objectiveId?: string | null;
  };

  audit: {
    inputHash: string;
    outputHash: string;
    evaluatedAt: string;
    correlationId: string;
  };
}
