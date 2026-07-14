// Reference proof of the Operational Modes Engine. Run:
//   node supabase/functions/_shared/intelligence/modes.verify.ts

import { resolveOperationalMode, evaluateMaturity } from "./modes.ts";
import type { DecisionPackage, EffectiveProfile, MaturityMetrics } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

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
const PROMOTION = {
  recommendation: { accuracy: 0.6, openfolk_confidence: 0.6 },
  assisted: {
    accuracy: 0.8,
    false_positives: 0.1,
    manual_overrides: 0.2,
    openfolk_confidence: 0.75,
  },
  trusted: {
    accuracy: 0.9,
    false_positives: 0.05,
    false_negatives: 0.05,
    automation_success: 0.9,
    customer_confidence: 0.8,
    openfolk_confidence: 0.85,
  },
  optimisation: {
    accuracy: 0.95,
    automation_success: 0.95,
    customer_confidence: 0.85,
    openfolk_confidence: 0.9,
  },
};

function profile(mode: string, extra: Record<string, unknown> = {}): EffectiveProfile {
  return {
    operational_mode: { current: mode, behaviours: BEHAVIOURS, promotion: PROMOTION, ...extra },
  } as unknown as EffectiveProfile;
}

function pkg(over: {
  decision?: string;
  risk?: string;
  reversibility?: string;
  openfolk?: boolean;
  customer?: boolean;
  tenant?: boolean;
  reviewRequired?: boolean;
}): DecisionPackage {
  return {
    id: "d",
    tenantId: "t",
    supersedes: null,
    intelligenceObjectId: "o",
    intelligenceObjectType: "Observation",
    objectClass: "observation",
    domainPackKeys: ["serviceos"],
    decision: (over.decision ?? "AUTOMATION_AUTHORISED") as never,
    nextDecisionOwner: { kind: "automation" },
    rationale: {
      summary: "",
      reasonCodes: [],
      policyMatches: [],
      rejectedAlternatives: [],
      missingConfiguration: [],
    },
    confidence: { score: 0.95, threshold: 0.8, ambiguityScore: 0, evidenceQuality: 0.9 },
    authority: {
      requiredAuthority: null,
      resolvedAuthorityHolder: null,
      delegatedLimit: null,
      requestedValue: null,
      withinDelegatedAuthority: true,
    },
    risk: { level: (over.risk ?? "low") as never, score: 0.1, categories: [] },
    reversibility: {
      level: (over.reversibility ?? "fully_reversible") as never,
      compensationAvailable: false,
    },
    impact: { level: "low", categories: [] },
    ownership: {
      responsible: null,
      accountable: null,
      approver: null,
      waitingOn: null,
      consulted: [],
      informed: [],
    },
    proposedAction: { actionType: "x", title: "x", description: null, priority: null, dueAt: null },
    automationIntent: { intentType: "x", payload: {}, requiresApproval: false },
    routing: {
      reviewRequired: over.reviewRequired ?? false,
      openfolkRequired: over.openfolk ?? false,
      tenantReviewRequired: over.tenant ?? false,
      customerApprovalRequired: over.customer ?? false,
      waitCondition: null,
    },
    versions: {
      engineVersion: "v",
      operatingProfileVersion: null,
      policyVersionIds: [],
      learningVersionIds: [],
      domainPackVersions: [],
    },
    evidence: { interactionIds: [], entityIds: [], objectIds: [], evidenceHash: "h" },
    outcomeContract: {
      expectedOutcomeType: null,
      measurableSignals: [],
      timeoutAt: null,
      objectiveId: null,
    },
    audit: { inputHash: "h", outputHash: "h", evaluatedAt: "t", correlationId: "c" },
  } as DecisionPackage;
}

// ── DISCOVERY — blocks everything ───────────────────────────────────────────
console.log("Discovery (observe only):");
const disc = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED", risk: "low" }),
  profile("discovery"),
);
check(
  "Discovery blocks execution even for authorised low-risk work",
  disc.allowed === false &&
    disc.can_execute === false &&
    disc.blocked_reason === "mode_observe_only",
  disc,
);
check(
  "Discovery surfaces nothing to any human (observe only)",
  disc.requires_openfolk === false &&
    disc.requires_customer === false &&
    disc.requires_tenant === false,
);

// ── RECOMMENDATION — reviews everything ─────────────────────────────────────
console.log("Recommendation (review everything):");
const rec = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED", risk: "low" }),
  profile("recommendation"),
);
check(
  "Recommendation never executes; routes to OpenFolk",
  rec.can_execute === false &&
    rec.requires_openfolk === true &&
    rec.blocked_reason === "mode_review_required",
  rec,
);

// ── ASSISTED — only low-risk, fully-reversible, policy-authorised ───────────
console.log("Assisted (safe work only):");
const aSafe = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED", risk: "low", reversibility: "fully_reversible" }),
  profile("assisted"),
);
check(
  "Assisted executes low-risk, fully-reversible authorised work",
  aSafe.can_execute === true,
  aSafe,
);
const aRisk = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED", risk: "medium", reversibility: "fully_reversible" }),
  profile("assisted"),
);
check(
  "Assisted withholds medium-risk work (exceeds mode ceiling)",
  aRisk.can_execute === false &&
    aRisk.blocked_reason === "exceeds_mode_max_risk" &&
    aRisk.requires_openfolk === true,
  aRisk,
);
const aIrr = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED", risk: "low", reversibility: "partially_reversible" }),
  profile("assisted"),
);
check(
  "Assisted withholds non-fully-reversible work",
  aIrr.can_execute === false && aIrr.blocked_reason === "not_reversible_in_mode",
  aIrr,
);

// ── TRUSTED — honours the Decision Engine ───────────────────────────────────
console.log("Trusted (honours the Decision Engine):");
const tHigh = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED", risk: "high", reversibility: "irreversible" }),
  profile("trusted"),
);
check(
  "Trusted executes anything the Decision Engine authorised",
  tHigh.can_execute === true,
  tHigh,
);
const tCust = resolveOperationalMode(
  pkg({ decision: "CUSTOMER_APPROVAL", customer: true, reviewRequired: true }),
  profile("trusted"),
);
check(
  "Trusted NEVER loosens a customer-authority gate",
  tCust.can_execute === false && tCust.requires_customer === true,
  tCust,
);
const tTen = resolveOperationalMode(
  pkg({ decision: "TENANT_SENIOR_REVIEW", tenant: true, reviewRequired: true }),
  profile("trusted"),
);
check(
  "Trusted preserves a tenant-review gate",
  tTen.can_execute === false && tTen.requires_tenant === true,
  tTen,
);

// ── OPTIMISATION — same execution as Trusted + optimisation flag ────────────
console.log("Optimisation (Trusted + optimisation flag):");
const opt = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED", risk: "high" }),
  profile("optimisation"),
);
check("Optimisation executes like Trusted", opt.can_execute === true);
check(
  "Optimisation raises the optimisation flag",
  opt.optimisation === true && BEHAVIOURS.trusted.optimisation === false,
);

// ── Modes never change decision logic (pure, and never loosen) ──────────────
console.log("Modes only constrain — never change/loosen decisions:");
const before = JSON.stringify(pkg({ decision: "AUTOMATION_AUTHORISED" }));
const inPkg = pkg({ decision: "AUTOMATION_AUTHORISED" });
resolveOperationalMode(inPkg, profile("trusted"));
check("resolver does not mutate the DecisionPackage", JSON.stringify(inPkg) === before);

// ── Fail-safe: missing/absent config → observe-only ─────────────────────────
console.log("Fail-safe on missing configuration:");
const noBeh = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED", risk: "low", reversibility: "fully_reversible" }),
  { operational_mode: { current: "assisted" } } as unknown as EffectiveProfile,
);
check(
  "Missing behaviour config fails safe to observe-only",
  noBeh.can_execute === false && noBeh.blocked_reason === "mode_observe_only",
  noBeh,
);
const noMode = resolveOperationalMode(
  pkg({ decision: "AUTOMATION_AUTHORISED" }),
  {} as EffectiveProfile,
);
check(
  "Absent current mode defaults to Discovery (blocks)",
  noMode.mode === "discovery" && noMode.can_execute === false,
  noMode,
);

// ── MATURITY — recommend only, never auto-promote ───────────────────────────
console.log("Maturity recommendations:");
const low: MaturityMetrics = {
  accuracy: 0.5,
  false_positives: 0.3,
  false_negatives: 0.3,
  manual_overrides: 0.5,
  automation_success: 0.5,
  customer_confidence: 0.5,
  openfolk_confidence: 0.5,
};
const notReady = evaluateMaturity(low, "discovery", profile("discovery"));
check(
  "Immature tenant is NOT recommended for promotion",
  notReady.ready === false &&
    notReady.recommended_mode === "discovery" &&
    notReady.unmet.length > 0,
  notReady,
);
const good: MaturityMetrics = {
  accuracy: 0.7,
  false_positives: 0.05,
  false_negatives: 0.05,
  manual_overrides: 0.1,
  automation_success: 0.7,
  customer_confidence: 0.7,
  openfolk_confidence: 0.7,
};
const prof = profile("discovery");
const ready = evaluateMaturity(good, "discovery", prof);
check(
  "Ready tenant is RECOMMENDED the next mode",
  ready.ready === true && ready.recommended_mode === "recommendation",
  ready,
);
check(
  "Recommendation NEVER auto-promotes (current mode unchanged)",
  (prof as unknown as Record<string, Record<string, unknown>>).operational_mode.current ===
    "discovery",
);
const top = evaluateMaturity(good, "optimisation", profile("optimisation"));
check(
  "Highest mode has no further promotion",
  top.recommended_mode === "optimisation" && top.ready === false,
);

console.log(
  failures === 0 ? "\nALL OPERATIONAL-MODE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
