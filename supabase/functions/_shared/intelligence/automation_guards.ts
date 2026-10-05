// Universal Automation Engine — pure execution-guard evaluator.
//
// The Automation Engine answers ONE question: "is this exact previously authorised
// intent still safe and valid to execute NOW?" It NEVER re-decides "should the
// business do this?" — that was settled by the Universal Decision Engine and is
// carried, immutable, in the Decision Package. This module holds the PURE,
// deterministic execution-time guards, the deterministic idempotency key, the
// result/retry classification and the lifecycle-transition legality check. No DB,
// no connector calls, no clock (now is injected), no domain literals. It reuses the
// pure Operational-Mode resolver so the mode re-check is the SAME logic the Decision
// Engine used — never a second policy evaluation.

import { resolveOperationalMode } from "./modes.ts";
import { stableHash } from "./policy.ts";
import type { DecisionPackage, EffectiveProfile } from "./types.ts";

/** Bump when the guard/idempotency contract changes — part of the idempotency key. */
export const AUTOMATION_EXECUTOR_VERSION = "auto-exec@1";

/** Decision destinations that authorise automated execution at all. */
export const EXECUTABLE_DESTINATIONS = [
  "AUTOMATION_AUTHORISED",
  "AUTOMATION_REQUIRES_APPROVAL",
] as const;

// ── Controlled reason-code registry (mirrors the seeded automation_reason_codes).
export const AUTOMATION_REASON_CODES = [
  "intent_not_pending",
  "intent_already_claimed",
  "intent_expired",
  "decision_not_authorised",
  "decision_superseded",
  "approval_missing",
  "approval_wrong_authority",
  "operational_mode_blocks_execution",
  "policy_version_revoked",
  "authority_expired",
  "dependency_unmet",
  "connector_missing",
  "connector_disabled",
  "connector_unhealthy",
  "capability_disabled",
  "outcome_contract_missing",
  "intent_type_unsupported",
  "idempotency_already_succeeded",
  "retry_limit_reached",
  "lease_active",
  "payload_invalid",
  "action_missing",
  "cross_tenant_reference",
  "execution_allowed",
  "transient_connector_failure",
  "permanent_connector_failure",
  "external_result_unknown",
] as const;
export type AutomationReasonCode = (typeof AUTOMATION_REASON_CODES)[number];
const REASONS: ReadonlySet<string> = new Set(AUTOMATION_REASON_CODES);
export function areAutomationReasonCodes(codes: string[]): boolean {
  return codes.every((c) => REASONS.has(c));
}

/** Controlled automation event registry (mirrors automation_event_types). */
export const AUTOMATION_EVENT_TYPES = [
  "automation.intent.claimed",
  "automation.execution.started",
  "automation.execution.succeeded",
  "automation.execution.failed",
  "automation.execution.unknown",
  "automation.execution.blocked",
  "automation.execution.waiting",
  "automation.intent.expired",
  "automation.retry.scheduled",
  "automation.outcome.recorded",
] as const;
export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];

// ── Fully-resolved guard input (the impure shell resolves every fact first). ─

export interface GuardIntentFacts {
  id: string;
  tenantId: string;
  status: string; // current intent lifecycle state
  intentType: string;
  capabilityKey: string | null;
  connectorId: string | null;
  actionObjectId: string | null;
  decisionId: string | null;
  expiresAt: string | null;
  attempts: number;
  maxAttempts: number;
  leaseExpiresAt: string | null;
}

export interface GuardIntentTypeFacts {
  intentType: string;
  enabled: boolean;
  requiresApproval: boolean;
  externalSideEffect: boolean;
  supportsIdempotency: boolean;
  supportsStatusLookup: boolean;
  riskCategory: string | null;
  schemaVersion: string | null;
}

export interface GuardApprovalFacts {
  present: boolean;
  approverKind: string | null; // openfolk | tenant_senior | customer | external
  requiredApproverKind: string | null;
  expiresAt: string | null;
  decision: string | null; // approved | rejected
}

export interface GuardConnectorFacts {
  exists: boolean;
  enabled: boolean;
  healthStatus: string; // unknown | healthy | warning | critical
  capabilityEnabled: boolean;
}

export interface ExecutionGuardInput {
  now: string;
  tenantId: string;
  intent: GuardIntentFacts;
  action: { exists: boolean; tenantId: string | null } | null;
  intentType: GuardIntentTypeFacts | null;
  decisionPackage: DecisionPackage | null;
  decisionDestination: string | null;
  decisionTenantId: string | null;
  decisionSuperseded: boolean;
  policyVersionsValid: boolean;
  authorityValid: boolean;
  profile: EffectiveProfile;
  approval: GuardApprovalFacts | null;
  connector: GuardConnectorFacts | null;
  /** A registered, enabled outcome contract for this capability (no execution without one). */
  outcomeContractPresent: boolean;
  dependenciesMet: boolean;
  dependencyRetryAt?: string | null;
  priorSucceededExecutionId?: string | null;
  leaseActiveByOtherWorker: boolean;
}

export type ExecutionGuardDecision =
  | { outcome: "EXECUTION_ALLOWED"; reasonCodes: AutomationReasonCode[] }
  | { outcome: "WAIT"; reasonCodes: AutomationReasonCode[]; retryAt?: string | null }
  | { outcome: "APPROVAL_REQUIRED"; reasonCodes: AutomationReasonCode[] }
  | { outcome: "BLOCKED"; reasonCodes: AutomationReasonCode[] }
  | { outcome: "EXPIRED"; reasonCodes: AutomationReasonCode[] }
  | {
      outcome: "ALREADY_COMPLETED";
      reasonCodes: AutomationReasonCode[];
      priorExecutionId?: string | null;
    };

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

// Proceedable = a fresh intent OR a failed one within its retry budget (retry path
// is the legal failed→executing transition). Everything else is owned or terminal.
const CLAIMABLE = new Set(["pending", "failed"]);
const TERMINAL_DONE = new Set(["succeeded"]);
const TERMINAL_DEAD = new Set(["cancelled", "rejected", "expired"]);

/**
 * Pure, deterministic execution guard. Confirms CURRENT validity of an already
 * authorised intent; it never performs a new business decision. Fails safe: any
 * missing fact blocks rather than executes. Ordered most-terminal first so the
 * strongest reason wins.
 */
export function evaluateExecutionGuards(input: ExecutionGuardInput): ExecutionGuardDecision {
  const nowMs = ms(input.now) ?? 0;
  const i = input.intent;

  // 1) idempotency — a prior success is authoritative, never re-executed.
  if (input.priorSucceededExecutionId || TERMINAL_DONE.has(i.status)) {
    return {
      outcome: "ALREADY_COMPLETED",
      reasonCodes: ["idempotency_already_succeeded"],
      priorExecutionId: input.priorSucceededExecutionId ?? null,
    };
  }

  // 2) tenant integrity (service role bypasses RLS — check every reference).
  if (i.tenantId !== input.tenantId) {
    return { outcome: "BLOCKED", reasonCodes: ["cross_tenant_reference"] };
  }
  if (input.action && input.action.exists && input.action.tenantId !== input.tenantId) {
    return { outcome: "BLOCKED", reasonCodes: ["cross_tenant_reference"] };
  }
  if (input.decisionTenantId && input.decisionTenantId !== input.tenantId) {
    return { outcome: "BLOCKED", reasonCodes: ["cross_tenant_reference"] };
  }

  // 3) lifecycle state — only a pending or (within-budget) failed intent may execute.
  if (!CLAIMABLE.has(i.status)) {
    if (i.status === "expired") return { outcome: "EXPIRED", reasonCodes: ["intent_expired"] };
    if (TERMINAL_DEAD.has(i.status)) {
      return { outcome: "BLOCKED", reasonCodes: ["intent_not_pending"] };
    }
    // 'unknown' = executed, result lost — NEVER blindly re-executed here (status lookup
    // or review reconciles it), so it is not proceedable through the guard.
    if (i.status === "unknown") {
      return { outcome: "BLOCKED", reasonCodes: ["external_result_unknown"] };
    }
    // claimed / executing — someone/something owns the lease.
    const leaseMs = ms(i.leaseExpiresAt);
    if (input.leaseActiveByOtherWorker || (leaseMs !== null && leaseMs > nowMs)) {
      return { outcome: "WAIT", reasonCodes: ["lease_active"], retryAt: i.leaseExpiresAt };
    }
    return { outcome: "BLOCKED", reasonCodes: ["intent_not_pending"] };
  }

  // 4) expiry.
  const exp = ms(i.expiresAt);
  if (exp !== null && nowMs > exp) {
    return { outcome: "EXPIRED", reasonCodes: ["intent_expired"] };
  }

  // 5) linked Action must exist (same-tenant checked above).
  if (!input.action || !input.action.exists) {
    return { outcome: "BLOCKED", reasonCodes: ["action_missing"] };
  }

  // 6) intent type must be registered, enabled and supported (schedule_engineer_visit
  //    stays disabled → unsupported → never executes here).
  if (!input.intentType || !input.intentType.enabled) {
    return { outcome: "BLOCKED", reasonCodes: ["intent_type_unsupported"] };
  }

  // 7) the originating decision must exist and have authorised automation, and must
  //    not have been superseded by a cancelling/changing decision.
  if (!input.decisionPackage || !input.decisionDestination) {
    return { outcome: "BLOCKED", reasonCodes: ["decision_not_authorised"] };
  }
  if (!(EXECUTABLE_DESTINATIONS as readonly string[]).includes(input.decisionDestination)) {
    return { outcome: "BLOCKED", reasonCodes: ["decision_not_authorised"] };
  }
  if (input.decisionSuperseded) {
    return { outcome: "BLOCKED", reasonCodes: ["decision_superseded"] };
  }

  // 8) version + authority validity (a revalidation, NOT a re-evaluation).
  if (!input.policyVersionsValid) {
    return { outcome: "BLOCKED", reasonCodes: ["policy_version_revoked"] };
  }
  if (!input.authorityValid) {
    return { outcome: "BLOCKED", reasonCodes: ["authority_expired"] };
  }

  // 9) approval — required when the decision or intent type demands it. Customer-owned
  //    approval can NEVER be satisfied by OpenFolk (approver kind must match).
  const approvalNeeded =
    input.intentType.requiresApproval ||
    input.decisionDestination === "AUTOMATION_REQUIRES_APPROVAL";
  if (approvalNeeded) {
    const a = input.approval;
    if (!a || !a.present || a.decision !== "approved") {
      return { outcome: "APPROVAL_REQUIRED", reasonCodes: ["approval_missing"] };
    }
    const aExp = ms(a.expiresAt);
    if (aExp !== null && nowMs > aExp) {
      return { outcome: "APPROVAL_REQUIRED", reasonCodes: ["approval_missing"] };
    }
    if (a.requiredApproverKind && a.approverKind !== a.requiredApproverKind) {
      return { outcome: "APPROVAL_REQUIRED", reasonCodes: ["approval_wrong_authority"] };
    }
  }

  // 10) Operational Mode RE-CHECK — the SAME pure resolver the Decision Engine used,
  //     against the CURRENT profile. Mode can only make execution less permissive.
  const modeDecision = resolveOperationalMode(input.decisionPackage, input.profile);
  if (!modeDecision.can_execute) {
    return { outcome: "BLOCKED", reasonCodes: ["operational_mode_blocks_execution"] };
  }

  // 11) connector eligibility.
  const c = input.connector;
  if (!c || !c.exists) return { outcome: "BLOCKED", reasonCodes: ["connector_missing"] };
  if (!c.enabled) return { outcome: "BLOCKED", reasonCodes: ["connector_disabled"] };
  if (!c.capabilityEnabled) return { outcome: "BLOCKED", reasonCodes: ["capability_disabled"] };
  // No executable capability without a registered outcome contract (what it must record).
  if (!input.outcomeContractPresent) {
    return { outcome: "BLOCKED", reasonCodes: ["outcome_contract_missing"] };
  }
  if (c.healthStatus === "critical") {
    return { outcome: "WAIT", reasonCodes: ["connector_unhealthy"], retryAt: null };
  }

  // 12) dependencies — WAIT never consumes an execution attempt.
  if (!input.dependenciesMet) {
    return {
      outcome: "WAIT",
      reasonCodes: ["dependency_unmet"],
      retryAt: input.dependencyRetryAt ?? null,
    };
  }

  // 13) retry budget.
  if (i.attempts >= i.maxAttempts) {
    return { outcome: "BLOCKED", reasonCodes: ["retry_limit_reached"] };
  }

  return { outcome: "EXECUTION_ALLOWED", reasonCodes: ["execution_allowed"] };
}

// ── Deterministic idempotency key ────────────────────────────────────────────

export interface IdempotencyKeyInput {
  tenantId: string;
  intentId: string;
  actionObjectId: string | null;
  decisionId: string | null;
  connectorId: string | null;
  capabilityKey: string | null;
  operationType: string; // the intent_type / connector operation
  parameters: Record<string, unknown>; // the intent's IMMUTABLE parameters
  executionVersion?: string;
}

/**
 * Deterministic idempotency identity for an external execution. Same immutable
 * intent ⇒ same key ⇒ a retry after success is recognised, and two concurrent
 * attempts collide on the same key. NEVER includes now() — that would defeat
 * exactly-once. A changed immutable intent must be a NEW intent, not a re-keyed one.
 */
export function buildIdempotencyKey(input: IdempotencyKeyInput): string {
  return stableHash({
    v: input.executionVersion ?? AUTOMATION_EXECUTOR_VERSION,
    tenantId: input.tenantId,
    intentId: input.intentId,
    actionObjectId: input.actionObjectId ?? null,
    decisionId: input.decisionId ?? null,
    connectorId: input.connectorId ?? null,
    capabilityKey: input.capabilityKey ?? null,
    operationType: input.operationType,
    parameters: canonicalize(input.parameters),
  });
}

/** Stable, order-independent canonical form so stableHash (JSON) is deterministic. */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalize((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}

// ── Result classification + post-execution lifecycle planning ────────────────

export type ConnectorOutcome = "succeeded" | "failed_transient" | "failed_permanent" | "unknown";

/** The universal shape a connector adapter returns. Data only — no I/O here. */
export interface ConnectorExecutionResult {
  outcome: ConnectorOutcome;
  externalReference?: string | null;
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable: boolean;
  retryAt?: string | null;
  evidenceRefs?: string[];
}

export interface PostExecutionPlan {
  toState: "succeeded" | "failed" | "unknown";
  enqueueRetry: boolean;
  retryAt: string | null;
  reasonCode: AutomationReasonCode;
}

const RETRY_BACKOFF_SECONDS: Record<number, number> = { 1: 60, 2: 300, 3: 900, 4: 3600 };

/**
 * Map a connector result + attempt state to the intent lifecycle move and whether a
 * bounded retry should be scheduled. An UNKNOWN external result is NEVER blindly
 * retried (the request may have succeeded remotely) — it parks in `unknown` for a
 * status lookup or review. Deterministic: retryAt is derived from an injected `now`.
 */
export function planPostExecution(
  result: ConnectorExecutionResult,
  attempts: number,
  maxAttempts: number,
  now: string,
): PostExecutionPlan {
  if (result.outcome === "succeeded") {
    return {
      toState: "succeeded",
      enqueueRetry: false,
      retryAt: null,
      reasonCode: "execution_allowed",
    };
  }
  if (result.outcome === "unknown") {
    return {
      toState: "unknown",
      enqueueRetry: false,
      retryAt: null,
      reasonCode: "external_result_unknown",
    };
  }
  if (result.outcome === "failed_permanent") {
    return {
      toState: "failed",
      enqueueRetry: false,
      retryAt: null,
      reasonCode: "permanent_connector_failure",
    };
  }
  // failed_transient
  if (attempts >= maxAttempts) {
    return {
      toState: "failed",
      enqueueRetry: false,
      retryAt: null,
      reasonCode: "retry_limit_reached",
    };
  }
  const retryAt =
    result.retryAt ??
    new Date((ms(now) ?? 0) + (RETRY_BACKOFF_SECONDS[attempts] ?? 3600) * 1000).toISOString();
  return {
    toState: "failed",
    enqueueRetry: true,
    retryAt,
    reasonCode: "transient_connector_failure",
  };
}

// ── Lifecycle transition legality (mirrors automation_intent_transitions) ────

export const AUTOMATION_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ["pending", "claimed"],
  ["pending", "cancelled"],
  ["pending", "expired"],
  ["pending", "executing"], // atomic claim-and-start (RPC): claim + durable attempt in one txn
  ["claimed", "pending"], // release an abandoned pre-execution claim (lease recovery)
  ["claimed", "approved"],
  ["claimed", "rejected"],
  ["claimed", "cancelled"],
  ["approved", "executing"],
  ["approved", "cancelled"],
  ["executing", "succeeded"],
  ["executing", "failed"],
  ["executing", "unknown"],
  ["unknown", "succeeded"],
  ["unknown", "failed"],
  ["unknown", "cancelled"],
  ["failed", "executing"],
  ["failed", "cancelled"],
  ["failed", "expired"],
];
const TRANSITION_SET: ReadonlySet<string> = new Set(
  AUTOMATION_TRANSITIONS.map(([f, t]) => `${f}→${t}`),
);

/** True iff from→to is a legal automation-intent transition. */
export function isLegalTransition(from: string, to: string): boolean {
  return from === to || TRANSITION_SET.has(`${from}→${to}`);
}

/** Only a pending or (within-budget) failed intent is eligible for NORMAL execution.
 *  In particular `unknown` is NEVER normally executed — the repair scanner excludes it. */
export function isExecutionEligibleStatus(status: string): boolean {
  return CLAIMABLE.has(status);
}

// ── Unknown-external-result recovery (freeze automatic retry) ────────────────

export type UnknownResolutionPath =
  | { path: "status_check"; reasonCodes: AutomationReasonCode[] }
  | { path: "review"; reasonCodes: AutomationReasonCode[] };

/**
 * Decide how an `unknown` (lost-response) intent is reconciled — NEVER by a blind
 * retry. If the connector supports status lookup and we hold an external reference,
 * a status-check path resolves it; otherwise it routes to a human review owner. The
 * resolution APPENDS a superseding attempt/outcome; it never rewrites history.
 */
export function planUnknownResolution(input: {
  supportsStatusLookup: boolean;
  hasExternalReference: boolean;
}): UnknownResolutionPath {
  if (input.supportsStatusLookup && input.hasExternalReference) {
    return { path: "status_check", reasonCodes: ["external_result_unknown"] };
  }
  return { path: "review", reasonCodes: ["external_result_unknown"] };
}
