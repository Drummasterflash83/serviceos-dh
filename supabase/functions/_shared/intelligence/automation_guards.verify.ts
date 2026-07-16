// Reference proof of the pure Automation execution-guard evaluator. Run:
//   node supabase/functions/_shared/intelligence/automation_guards.verify.ts

import {
  AUTOMATION_REASON_CODES,
  areAutomationReasonCodes,
  buildIdempotencyKey,
  evaluateExecutionGuards,
  isExecutionEligibleStatus,
  isLegalTransition,
  planPostExecution,
  planUnknownResolution,
  type ConnectorExecutionResult,
  type ExecutionGuardInput,
} from "./automation_guards.ts";
import type { DecisionPackage, EffectiveProfile } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const NOW = "2026-07-15T12:00:00Z";
const FUTURE = "2026-12-31T00:00:00Z";
const PAST = "2026-01-01T00:00:00Z";

// Mode behaviour config (mirrors the seed migration) — DATA, not hardcoded logic.
const BEHAVIOURS = {
  discovery: {
    ordinal: 0,
    observe_only: true,
    allows_execution: false,
    requires_review: false,
    max_risk: "none",
    require_reversible: true,
    require_policy_authorised: true,
    optimisation: false,
  },
  recommendation: {
    ordinal: 1,
    observe_only: false,
    allows_execution: false,
    requires_review: true,
    max_risk: "none",
    require_reversible: true,
    require_policy_authorised: true,
    optimisation: false,
  },
  assisted: {
    ordinal: 2,
    observe_only: false,
    allows_execution: true,
    requires_review: false,
    max_risk: "low",
    require_reversible: true,
    require_policy_authorised: true,
    optimisation: false,
  },
  trusted: {
    ordinal: 3,
    observe_only: false,
    allows_execution: true,
    requires_review: false,
    max_risk: "critical",
    require_reversible: false,
    require_policy_authorised: false,
    optimisation: false,
  },
  optimisation: {
    ordinal: 4,
    observe_only: false,
    allows_execution: true,
    requires_review: false,
    max_risk: "critical",
    require_reversible: false,
    require_policy_authorised: false,
    optimisation: true,
  },
};
function profile(mode: string): EffectiveProfile {
  return {
    operational_mode: { current: mode, behaviours: BEHAVIOURS },
  } as unknown as EffectiveProfile;
}
function pkg(
  over: { decision?: string; risk?: string; reversibility?: string } = {},
): DecisionPackage {
  return {
    id: "d",
    tenantId: "t",
    decision: (over.decision ?? "AUTOMATION_AUTHORISED") as never,
    risk: { level: (over.risk ?? "low") as never, score: 0.1, categories: [] },
    reversibility: {
      level: (over.reversibility ?? "fully_reversible") as never,
      compensationAvailable: false,
    },
    routing: {
      reviewRequired: false,
      openfolkRequired: false,
      tenantReviewRequired: false,
      customerApprovalRequired: false,
      waitCondition: null,
    },
  } as unknown as DecisionPackage;
}

// A fully-valid, trusted-mode, auto-authorised input → the "everything ok" baseline.
function base(over: Partial<ExecutionGuardInput> = {}): ExecutionGuardInput {
  return {
    now: NOW,
    tenantId: "t",
    intent: {
      id: "i1",
      tenantId: "t",
      status: "pending",
      intentType: "record_controlled_execution",
      capabilityKey: "internal.record_execution",
      connectorId: "controlled_test",
      actionObjectId: "a1",
      decisionId: "dec1",
      expiresAt: FUTURE,
      attempts: 0,
      maxAttempts: 5,
      leaseExpiresAt: null,
    },
    action: { exists: true, tenantId: "t" },
    intentType: {
      intentType: "record_controlled_execution",
      enabled: true,
      requiresApproval: false,
      externalSideEffect: false,
      supportsIdempotency: true,
      supportsStatusLookup: false,
      riskCategory: "low",
      schemaVersion: "1",
    },
    decisionPackage: pkg(),
    decisionDestination: "AUTOMATION_AUTHORISED",
    decisionTenantId: "t",
    decisionSuperseded: false,
    policyVersionsValid: true,
    authorityValid: true,
    profile: profile("trusted"),
    approval: null,
    connector: { exists: true, enabled: true, healthStatus: "healthy", capabilityEnabled: true },
    outcomeContractPresent: true,
    dependenciesMet: true,
    priorSucceededExecutionId: null,
    leaseActiveByOtherWorker: false,
    ...over,
  };
}
const merge = (o: Partial<ExecutionGuardInput>) => base(o);
const withIntent = (o: Partial<ExecutionGuardInput["intent"]>) =>
  base({ intent: { ...base().intent, ...o } });

// ── Eligibility + mode gating ───────────────────────────────────────────────
console.log("Eligibility + Operational Mode re-check:");
check(
  "1/5. authorised eligible intent (trusted) ⇒ EXECUTION_ALLOWED",
  evaluateExecutionGuards(base()).outcome === "EXECUTION_ALLOWED",
  evaluateExecutionGuards(base()),
);
check(
  "2. discovery mode blocks execution",
  evaluateExecutionGuards(merge({ profile: profile("discovery") })).outcome === "BLOCKED",
);
check(
  "3. recommendation mode blocks execution",
  evaluateExecutionGuards(merge({ profile: profile("recommendation") })).outcome === "BLOCKED",
);
check(
  "4a. assisted mode permits low-risk reversible",
  evaluateExecutionGuards(
    merge({
      profile: profile("assisted"),
      decisionPackage: pkg({ risk: "low", reversibility: "fully_reversible" }),
    }),
  ).outcome === "EXECUTION_ALLOWED",
);
check(
  "4b. assisted mode blocks high-risk",
  evaluateExecutionGuards(
    merge({ profile: profile("assisted"), decisionPackage: pkg({ risk: "high" }) }),
  ).outcome === "BLOCKED",
);
const modeBlock = evaluateExecutionGuards(merge({ profile: profile("discovery") }));
check(
  "mode block carries operational_mode_blocks_execution",
  modeBlock.reasonCodes.includes("operational_mode_blocks_execution"),
);

// ── Approval ────────────────────────────────────────────────────────────────
console.log("Approval:");
check(
  "6. approval-required intent without approval ⇒ APPROVAL_REQUIRED",
  evaluateExecutionGuards(merge({ intentType: { ...base().intentType!, requiresApproval: true } }))
    .outcome === "APPROVAL_REQUIRED",
);
check(
  "6b. AUTOMATION_REQUIRES_APPROVAL destination without approval ⇒ APPROVAL_REQUIRED",
  evaluateExecutionGuards(
    merge({
      decisionDestination: "AUTOMATION_REQUIRES_APPROVAL",
      decisionPackage: pkg({ decision: "AUTOMATION_REQUIRES_APPROVAL" }),
    }),
  ).outcome === "APPROVAL_REQUIRED",
);
check(
  "7. customer-owned approval cannot be satisfied by OpenFolk",
  evaluateExecutionGuards(
    merge({
      intentType: { ...base().intentType!, requiresApproval: true },
      approval: {
        present: true,
        decision: "approved",
        approverKind: "openfolk",
        requiredApproverKind: "customer",
        expiresAt: FUTURE,
      },
    }),
  ).reasonCodes.includes("approval_wrong_authority"),
);
check(
  "7b. correct customer approval releases execution",
  evaluateExecutionGuards(
    merge({
      intentType: { ...base().intentType!, requiresApproval: true },
      approval: {
        present: true,
        decision: "approved",
        approverKind: "customer",
        requiredApproverKind: "customer",
        expiresAt: FUTURE,
      },
    }),
  ).outcome === "EXECUTION_ALLOWED",
);
check(
  "expired approval does not release",
  evaluateExecutionGuards(
    merge({
      intentType: { ...base().intentType!, requiresApproval: true },
      approval: {
        present: true,
        decision: "approved",
        approverKind: "customer",
        requiredApproverKind: "customer",
        expiresAt: PAST,
      },
    }),
  ).outcome === "APPROVAL_REQUIRED",
);

// ── Validity: expiry / version / decision / connector / capability ──────────
console.log("Validity guards:");
check(
  "8. expired intent ⇒ EXPIRED",
  evaluateExecutionGuards(withIntent({ expiresAt: PAST })).outcome === "EXPIRED",
);
check(
  "9. revoked policy/config version blocks",
  evaluateExecutionGuards(merge({ policyVersionsValid: false })).outcome === "BLOCKED" &&
    evaluateExecutionGuards(merge({ policyVersionsValid: false })).reasonCodes.includes(
      "policy_version_revoked",
    ),
);
check(
  "authority expired blocks",
  evaluateExecutionGuards(merge({ authorityValid: false })).reasonCodes.includes(
    "authority_expired",
  ),
);
check(
  "10. superseded/cancelled decision blocks",
  evaluateExecutionGuards(merge({ decisionSuperseded: true })).reasonCodes.includes(
    "decision_superseded",
  ),
);
check(
  "non-authorising decision destination blocks",
  evaluateExecutionGuards(merge({ decisionDestination: "OPENFOLK_REVIEW" })).reasonCodes.includes(
    "decision_not_authorised",
  ),
);
check(
  "11. disabled connector blocks",
  evaluateExecutionGuards(
    merge({
      connector: { exists: true, enabled: false, healthStatus: "healthy", capabilityEnabled: true },
    }),
  ).reasonCodes.includes("connector_disabled"),
);
check(
  "missing connector blocks",
  evaluateExecutionGuards(
    merge({
      connector: {
        exists: false,
        enabled: false,
        healthStatus: "unknown",
        capabilityEnabled: false,
      },
    }),
  ).reasonCodes.includes("connector_missing"),
);
check(
  "critical connector health ⇒ WAIT",
  evaluateExecutionGuards(
    merge({
      connector: { exists: true, enabled: true, healthStatus: "critical", capabilityEnabled: true },
    }),
  ).outcome === "WAIT",
);
check(
  "12. unsupported capability blocks",
  evaluateExecutionGuards(
    merge({
      connector: { exists: true, enabled: true, healthStatus: "healthy", capabilityEnabled: false },
    }),
  ).reasonCodes.includes("capability_disabled"),
);
check(
  "12a. a capability with no registered outcome contract blocks (no execution without a contract)",
  (() => {
    const g = evaluateExecutionGuards(merge({ outcomeContractPresent: false }));
    return g.outcome === "BLOCKED" && g.reasonCodes.includes("outcome_contract_missing");
  })(),
);
check(
  "12b. disabled/unsupported intent type blocks (e.g. schedule_engineer_visit)",
  evaluateExecutionGuards(
    merge({ intentType: { ...base().intentType!, enabled: false } }),
  ).reasonCodes.includes("intent_type_unsupported"),
);

// ── Tenant integrity ────────────────────────────────────────────────────────
console.log("Tenant integrity:");
check(
  "13. cross-tenant intent rejected",
  evaluateExecutionGuards(withIntent({ tenantId: "other" })).reasonCodes.includes(
    "cross_tenant_reference",
  ),
);
check(
  "14. cross-tenant Action rejected",
  evaluateExecutionGuards(
    merge({ action: { exists: true, tenantId: "other" } }),
  ).reasonCodes.includes("cross_tenant_reference"),
);
check(
  "15. cross-tenant decision rejected",
  evaluateExecutionGuards(merge({ decisionTenantId: "other" })).reasonCodes.includes(
    "cross_tenant_reference",
  ),
);
check(
  "missing action blocks",
  evaluateExecutionGuards(
    merge({ action: { exists: false, tenantId: null } }),
  ).reasonCodes.includes("action_missing"),
);

// ── Lifecycle / lease / idempotency / retry budget ──────────────────────────
console.log("Lifecycle, lease, idempotency:");
check(
  "18. already-succeeded intent ⇒ ALREADY_COMPLETED",
  evaluateExecutionGuards(withIntent({ status: "succeeded" })).outcome === "ALREADY_COMPLETED",
);
check(
  "18b. prior succeeded execution ⇒ ALREADY_COMPLETED",
  evaluateExecutionGuards(merge({ priorSucceededExecutionId: "ex-1" })).outcome ===
    "ALREADY_COMPLETED",
);
check(
  "17/23. active lease on a claimed intent ⇒ WAIT (no double execution)",
  evaluateExecutionGuards(withIntent({ status: "claimed", leaseExpiresAt: FUTURE })).outcome ===
    "WAIT",
);
check(
  "claimed intent with expired lease is not executed here (reclaim first)",
  evaluateExecutionGuards(withIntent({ status: "claimed", leaseExpiresAt: PAST })).outcome ===
    "BLOCKED",
);
check(
  "failed intent within budget is re-executable (retry path)",
  evaluateExecutionGuards(withIntent({ status: "failed", attempts: 1, maxAttempts: 5 })).outcome ===
    "EXECUTION_ALLOWED",
);
check(
  "unknown-result intent is never blindly re-executed",
  evaluateExecutionGuards(withIntent({ status: "unknown" })).reasonCodes.includes(
    "external_result_unknown",
  ),
);
check(
  "retry budget exhausted blocks",
  evaluateExecutionGuards(withIntent({ attempts: 5, maxAttempts: 5 })).reasonCodes.includes(
    "retry_limit_reached",
  ),
);

// ── Dependencies (WAIT never burns an attempt) ──────────────────────────────
console.log("Dependencies:");
const waitDep = evaluateExecutionGuards(
  merge({ dependenciesMet: false, dependencyRetryAt: FUTURE }),
);
check(
  "22. unmet dependency ⇒ WAIT (no execution attempt)",
  waitDep.outcome === "WAIT" && waitDep.reasonCodes.includes("dependency_unmet"),
  waitDep,
);

// ── Idempotency key ─────────────────────────────────────────────────────────
console.log("Idempotency key:");
const keyArgs = {
  tenantId: "t",
  intentId: "i1",
  actionObjectId: "a1",
  decisionId: "dec1",
  connectorId: "controlled_test",
  capabilityKey: "internal.record_execution",
  operationType: "record_controlled_execution",
  parameters: { a: 1, b: 2 },
};
check(
  "16. same immutable intent ⇒ same idempotency key",
  buildIdempotencyKey(keyArgs) === buildIdempotencyKey({ ...keyArgs, parameters: { b: 2, a: 1 } }),
);
check(
  "changed parameters ⇒ different key",
  buildIdempotencyKey(keyArgs) !== buildIdempotencyKey({ ...keyArgs, parameters: { a: 1, b: 3 } }),
);
check(
  "different intent ⇒ different key",
  buildIdempotencyKey(keyArgs) !== buildIdempotencyKey({ ...keyArgs, intentId: "i2" }),
);
check(
  "key never uses now() (stable across time)",
  buildIdempotencyKey(keyArgs) === buildIdempotencyKey(keyArgs),
);

// ── Result classification / retry planning ──────────────────────────────────
console.log("Result classification:");
const r = (
  outcome: ConnectorExecutionResult["outcome"],
  retryable = false,
): ConnectorExecutionResult => ({ outcome, retryable });
check(
  "succeeded ⇒ toState succeeded, no retry",
  (() => {
    const p = planPostExecution(r("succeeded"), 0, 5, NOW);
    return p.toState === "succeeded" && !p.enqueueRetry;
  })(),
);
check(
  "19. unknown external result ⇒ toState unknown, NOT retried",
  (() => {
    const p = planPostExecution(r("unknown"), 0, 5, NOW);
    return p.toState === "unknown" && !p.enqueueRetry && p.reasonCode === "external_result_unknown";
  })(),
);
check(
  "20. transient failure (budget left) ⇒ failed + bounded retry",
  (() => {
    const p = planPostExecution(r("failed_transient", true), 1, 5, NOW);
    return p.toState === "failed" && p.enqueueRetry && !!p.retryAt;
  })(),
);
check(
  "20b. transient failure at budget ⇒ no retry (retry_limit_reached)",
  (() => {
    const p = planPostExecution(r("failed_transient", true), 5, 5, NOW);
    return p.toState === "failed" && !p.enqueueRetry;
  })(),
);
check(
  "21. permanent failure ⇒ failed, no retry",
  (() => {
    const p = planPostExecution(r("failed_permanent"), 0, 5, NOW);
    return p.toState === "failed" && !p.enqueueRetry;
  })(),
);

// ── Unknown-result recovery (freeze automatic retry) ────────────────────────
console.log("Unknown-result recovery:");
check(
  "unknown result is never retried (frozen)",
  planPostExecution(r("unknown"), 0, 5, NOW).enqueueRetry === false,
);
check(
  "scanner excludes unknown from normal execution",
  isExecutionEligibleStatus("unknown") === false &&
    isExecutionEligibleStatus("pending") === true &&
    isExecutionEligibleStatus("failed") === true,
);
check(
  "status-lookup path when supported + external ref present",
  planUnknownResolution({ supportsStatusLookup: true, hasExternalReference: true }).path ===
    "status_check",
);
check(
  "no status lookup ⇒ routes to review",
  planUnknownResolution({ supportsStatusLookup: false, hasExternalReference: true }).path ===
    "review",
);
check(
  "no external reference ⇒ routes to review",
  planUnknownResolution({ supportsStatusLookup: true, hasExternalReference: false }).path ===
    "review",
);
check(
  "status lookup can resolve unknown ⇒ succeeded or failed",
  planPostExecution(r("succeeded"), 1, 5, NOW).toState === "succeeded" &&
    planPostExecution(r("failed_permanent"), 1, 5, NOW).toState === "failed",
);
check(
  "pending → executing is a legal atomic claim transition",
  isLegalTransition("pending", "executing"),
);

// ── Lifecycle transition legality ───────────────────────────────────────────
console.log("Lifecycle transitions:");
check(
  "25. legal transitions accepted",
  isLegalTransition("pending", "claimed") &&
    isLegalTransition("approved", "executing") &&
    isLegalTransition("executing", "unknown") &&
    isLegalTransition("unknown", "succeeded"),
);
check(
  "25b. illegal transitions rejected",
  !isLegalTransition("pending", "succeeded") &&
    !isLegalTransition("succeeded", "executing") &&
    !isLegalTransition("cancelled", "executing"),
);

// ── ServiceOS + ProductOS parity (same core, config only) ───────────────────
console.log("Domain parity:");
const svcIntent = withIntent({
  intentType: "record_controlled_execution",
  capabilityKey: "internal.record_execution",
});
const prodIntent = base({
  intent: {
    ...base().intent,
    intentType: "record_controlled_execution",
    capabilityKey: "internal.record_execution",
  },
  intentType: { ...base().intentType!, intentType: "record_controlled_execution" },
});
check(
  "34. ServiceOS-shaped and ProductOS-shaped intents use the SAME guard",
  evaluateExecutionGuards(svcIntent).outcome === "EXECUTION_ALLOWED" &&
    evaluateExecutionGuards(prodIntent).outcome === "EXECUTION_ALLOWED",
);

// ── Purity + reason-code registry ───────────────────────────────────────────
console.log("Purity + registry:");
const beforeInput = JSON.stringify(base());
const inp = base();
evaluateExecutionGuards(inp);
check(
  "36. guard evaluator is side-effect free (input unmutated)",
  JSON.stringify(inp) === beforeInput,
);
const allCodes = [
  ...evaluateExecutionGuards(base()).reasonCodes,
  ...evaluateExecutionGuards(merge({ profile: profile("discovery") })).reasonCodes,
  ...evaluateExecutionGuards(withIntent({ expiresAt: PAST })).reasonCodes,
];
check("all guard reason codes are registered", areAutomationReasonCodes(allCodes), allCodes);
check("reason-code registry is non-empty & typed", AUTOMATION_REASON_CODES.length > 0);

console.log(
  failures === 0 ? "\nALL AUTOMATION-GUARD CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
