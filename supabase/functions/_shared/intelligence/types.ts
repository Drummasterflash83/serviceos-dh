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
  action_proposals: ActionProposal[];
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
