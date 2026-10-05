// Universal Operational Modes Engine (pure).
//
// The Decision Engine decides WHAT should happen. This engine decides HOW MUCH
// AUTONOMY the platform currently has for a tenant — i.e. what is ALLOWED to
// happen. It runs AFTER the DecisionPackage and BEFORE handler execution. It only
// CONSTRAINS execution; it NEVER changes decision logic and NEVER loosens the
// Decision Engine's own human gates. Pure: no DB, no APIs, no events, no clock.
//
// Mode behaviour is entirely data-driven — read from the effective profile, never
// hardcoded here. A missing/malformed mode config fails safe to observe-only.

import { profileValue } from "./profile.ts";
import type {
  DecisionPackage,
  EffectiveProfile,
  MaturityMetrics,
  MaturityRecommendation,
  ModeBehaviour,
  OperationalDecision,
  OperationalMode,
} from "./types.ts";

const RISK_ORDER: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
function riskWithin(level: string, ceiling: string): boolean {
  return (RISK_ORDER[level] ?? 99) <= (RISK_ORDER[ceiling] ?? -1);
}

const MODE_ORDER: OperationalMode[] = [
  "discovery",
  "recommendation",
  "assisted",
  "trusted",
  "optimisation",
];

// Most-restrictive fallback: absent/invalid config must never become permissive.
const FAILSAFE: ModeBehaviour = {
  ordinal: 0,
  observe_only: true,
  allows_execution: false,
  requires_review: false,
  max_risk: "none",
  require_reversible: true,
  require_policy_authorised: true,
  optimisation: false,
};

function behaviourFor(profile: EffectiveProfile, mode: string): ModeBehaviour {
  const map = profileValue(profile, "operational_mode.behaviours");
  if (map && typeof map === "object") {
    const b = (map as Record<string, unknown>)[mode];
    if (b && typeof b === "object") return b as ModeBehaviour;
  }
  return FAILSAFE;
}

/** Decisions whose outcome is automation-class (mode-gated for execution). */
function decisionAuthorisesExecution(pkg: DecisionPackage): boolean {
  return (
    pkg.decision === "AUTOMATION_AUTHORISED" || pkg.decision === "AUTOMATION_REQUIRES_APPROVAL"
  );
}

/**
 * Resolve how much autonomy the platform has for THIS decision, for this tenant.
 * Pure. Modes only constrain — a human gate the Decision Engine required always
 * stands, and the mode can only ever make execution LESS permissive.
 */
export function resolveOperationalMode(
  pkg: DecisionPackage,
  profile: EffectiveProfile,
): OperationalDecision {
  const mode = (profileValue(profile, "operational_mode.current") as string) ?? "discovery";
  const b = behaviourFor(profile, mode);

  // The Decision Engine's own human gates ALWAYS stand — modes never loosen them.
  let requires_openfolk = pkg.routing.openfolkRequired;
  let requires_customer = pkg.routing.customerApprovalRequired;
  let requires_tenant = pkg.routing.tenantReviewRequired;

  let allowed: boolean;
  let can_execute: boolean;
  let blocked_reason: string | null;
  let notes: string;

  if (b.observe_only) {
    // Discovery: nothing proceeds beyond observation — not even recommendations.
    allowed = false;
    can_execute = false;
    requires_openfolk = false;
    requires_customer = false;
    requires_tenant = false;
    blocked_reason = "mode_observe_only";
    notes = `${mode}: observe only — nothing proceeds beyond learning`;
  } else if (b.requires_review) {
    // Recommendation: recommendations produced, nothing executes, all to OpenFolk.
    allowed = true;
    can_execute = false;
    requires_openfolk = true;
    blocked_reason = "mode_review_required";
    notes = `${mode}: recommendations produced, all routed to OpenFolk review`;
  } else if (!b.allows_execution) {
    allowed = true;
    can_execute = false;
    blocked_reason = "mode_execution_disabled";
    notes = `${mode}: execution disabled by mode`;
  } else if (!decisionAuthorisesExecution(pkg)) {
    // The decision itself did not authorise execution (review/wait/reject/none) —
    // its own routing stands; the mode adds no execution here.
    allowed = true;
    can_execute = false;
    blocked_reason = null;
    notes = `${mode}: no execution authorised by the decision (${pkg.decision})`;
  } else {
    // Execution-capable mode + automation-class decision → apply mode constraints.
    const riskOk = riskWithin(pkg.risk.level, b.max_risk);
    const reversibleOk = !b.require_reversible || pkg.reversibility.level === "fully_reversible";
    // AUTOMATION_AUTHORISED / _REQUIRES_APPROVAL both imply policy authorised.
    const policyOk = !b.require_policy_authorised || decisionAuthorisesExecution(pkg);
    if (riskOk && reversibleOk && policyOk) {
      allowed = true;
      can_execute = true;
      blocked_reason = null;
      notes = `${mode}: execution authorised within mode limits`;
    } else {
      allowed = true;
      can_execute = false;
      requires_openfolk = true; // clamped work routes to OpenFolk
      blocked_reason = !riskOk
        ? "exceeds_mode_max_risk"
        : !reversibleOk
          ? "not_reversible_in_mode"
          : "not_policy_authorised_in_mode";
      notes = `${mode}: decision authorised but withheld by mode (${blocked_reason})`;
    }
  }

  return {
    mode,
    allowed,
    can_execute,
    requires_openfolk,
    requires_customer,
    requires_tenant,
    max_risk: b.max_risk,
    optimisation: b.optimisation,
    notes,
    blocked_reason,
  };
}

const LOWER_IS_BETTER = new Set(["false_positives", "false_negatives", "manual_overrides"]);

/**
 * Recommend (never apply) the next mode for a tenant from its maturity metrics.
 * Thresholds are data-driven (operational_mode.promotion in the profile). The
 * engine NEVER auto-promotes — this is advice for an OpenFolk operator.
 */
export function evaluateMaturity(
  metrics: MaturityMetrics,
  currentMode: string,
  profile: EffectiveProfile,
): MaturityRecommendation {
  const idx = MODE_ORDER.indexOf(currentMode as OperationalMode);
  const nextMode = idx >= 0 && idx < MODE_ORDER.length - 1 ? MODE_ORDER[idx + 1] : null;
  if (!nextMode) {
    return {
      current_mode: currentMode,
      recommended_mode: currentMode,
      ready: false,
      rationale: [
        idx < 0 ? `Unknown current mode '${currentMode}'` : "Already at the highest mode",
      ],
      unmet: [],
    };
  }
  const promo = profileValue(profile, "operational_mode.promotion") as
    Record<string, Record<string, number>> | undefined;
  const thresholds = promo?.[nextMode];
  if (!thresholds) {
    return {
      current_mode: currentMode,
      recommended_mode: currentMode,
      ready: false,
      rationale: [`No promotion thresholds configured for '${nextMode}'`],
      unmet: [`operational_mode.promotion.${nextMode}`],
    };
  }

  const unmet: string[] = [];
  for (const [key, req] of Object.entries(thresholds)) {
    const val = (metrics as unknown as Record<string, number>)[key];
    if (typeof val !== "number") {
      unmet.push(`${key} (metric missing)`);
      continue;
    }
    const ok = LOWER_IS_BETTER.has(key) ? val <= req : val >= req;
    if (!ok) unmet.push(`${key} ${LOWER_IS_BETTER.has(key) ? "≤" : "≥"} ${req} (got ${val})`);
  }
  const ready = unmet.length === 0;
  return {
    current_mode: currentMode,
    recommended_mode: ready ? nextMode : currentMode, // recommend only; never auto-promote
    ready,
    rationale: ready
      ? [`Metrics meet every threshold for '${nextMode}' — recommend promotion (operator decides)`]
      : [`Not yet ready for '${nextMode}'`],
    unmet,
  };
}
