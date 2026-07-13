// Universal Decision Engine — the ONE deterministic routing authority (pure).
//
// Consumes a fully-resolved DecisionInput and returns one immutable
// DecisionPackage: "who or what owns the next decision, and why." It is pure —
// no DB, no events, no Action creation, no automation execution, no notifications,
// no clock except the injected one, and no domain-specific or industry branching.
//
// Hardened: it NEVER silently defaults a decision-critical control. Missing
// configuration that could otherwise authorise action routes to OPENFOLK_REVIEW
// with a stable reason code; authority is compared only from a resolved,
// domain-neutral AuthorityContext (never from arbitrary attributes), and unlike
// currencies are never compared.

import { evaluatePolicies, stableHash } from "./policy.ts";
import { profileValue } from "./profile.ts";
import type {
  DecisionDestination,
  DecisionInput,
  DecisionOwner,
  DecisionPackage,
  ImpactCategory,
  ImpactLevel,
  OwnershipAssignment,
  PolicyDecision,
  ReversibilityLevel,
  RiskLevel,
} from "./types.ts";
import type { ReasonCode } from "./reason_codes.ts";

// ── profile helpers (fallbacks used ONLY where they cannot authorise action) ─
function pnum(
  profile: DecisionInput["profile"],
  path: string,
  fallback: number | null,
): number | null {
  const v = profileValue(profile, path);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}
function n(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
function present(profile: DecisionInput["profile"], path: string): boolean {
  return profileValue(profile, path) !== undefined;
}

const IMPACT_CATEGORIES: ReadonlySet<string> = new Set<ImpactCategory>([
  "financial",
  "customer",
  "legal",
  "compliance",
  "safety",
  "reputation",
  "production",
  "service",
  "inventory",
  "supplier",
]);

// ── axes ─────────────────────────────────────────────────────────────────────

function axisConfidence(input: DecisionInput) {
  const a = input.object.attributes ?? {};
  const evFromArray = (() => {
    const len = (input.object.evidence ?? []).length;
    return len >= 3 ? 0.9 : len === 2 ? 0.75 : len === 1 ? 0.5 : 0;
  })();
  return {
    score: input.object.confidence ?? 0,
    threshold: pnum(input.profile, "confidence.customer_facing_min", 1) ?? 1, // conservative if absent
    ambiguityScore: input.object.ambiguity ?? 0,
    evidenceQuality: n(a["evidence_quality"]) ?? evFromArray,
  };
}

function axisRisk(input: DecisionInput) {
  const score = input.object.risk ?? 0;
  const highMin = pnum(input.profile, "risk.high_min", 0.6) ?? 0.6;
  const critMin = pnum(input.profile, "risk.critical_min", 0.85) ?? 0.85;
  const level: RiskLevel =
    score >= critMin
      ? "critical"
      : score >= highMin
        ? "high"
        : score >= 0.3
          ? "medium"
          : score > 0
            ? "low"
            : "none";
  const cats = input.object.attributes?.["risk_categories"];
  return { level, score, categories: Array.isArray(cats) ? (cats as string[]) : [] };
}

function axisReversibility(input: DecisionInput) {
  // Reversibility only ever RESTRICTS, so a conservative default is safe.
  const score = input.object.reversibility ?? 0.5;
  const irrevMax = pnum(input.profile, "reversibility.irreversible_max", 0.3) ?? 0.3;
  const partialMax = pnum(input.profile, "reversibility.partial_max", 0.7) ?? 0.7;
  const level: ReversibilityLevel =
    score <= irrevMax
      ? "irreversible"
      : score <= partialMax
        ? "partially_reversible"
        : "fully_reversible";
  return {
    level,
    compensationAvailable: input.object.attributes?.["compensation_available"] === true,
  };
}

function axisImpact(input: DecisionInput, risk: RiskLevel) {
  const a = input.object.attributes ?? {};
  const rawCats = Array.isArray(a["impact_categories"]) ? (a["impact_categories"] as string[]) : [];
  const categories = rawCats.filter((c): c is ImpactCategory => IMPACT_CATEGORIES.has(c));
  const declared = a["impact_level"];
  const fallback: ImpactLevel =
    risk === "critical"
      ? "critical"
      : risk === "high"
        ? "high"
        : risk === "medium"
          ? "medium"
          : "low";
  const level: ImpactLevel =
    declared === "low" || declared === "medium" || declared === "high" || declared === "critical"
      ? declared
      : fallback;
  return { level, categories };
}

type AuthorityRoute = "customer" | "tenant" | "external" | "openfolk" | null;
function holderRoute(holder: string): AuthorityRoute {
  if (holder === "customer") return "customer";
  if (holder === "tenant_role" || holder === "tenant_user") return "tenant";
  if (holder === "external_party") return "external";
  if (holder === "openfolk") return "openfolk";
  return "customer"; // conservative — an unclear holder never silently auto-authorises
}

/** Authority axis, computed ONLY from the resolved AuthorityContext. */
function axisAuthority(input: DecisionInput) {
  const ac = input.authority;
  const base = {
    requiredAuthority: null as string | null,
    resolvedAuthorityHolder: null as string | null,
    delegatedLimit: ac.delegatedLimit?.amount ?? null,
    requestedValue: ac.requestedValue?.amount ?? null,
    withinDelegatedAuthority: true,
    route: null as AuthorityRoute,
    missingAuthorityPolicy: false,
    currencyMismatch: false,
  };
  if (ac.authorityType === "none") return base;

  if (ac.explicitCustomerApprovalRequired) {
    return {
      ...base,
      requiredAuthority: ac.authorityType,
      resolvedAuthorityHolder: ac.requiredAuthorityHolder,
      withinDelegatedAuthority: false,
      route: holderRoute(ac.requiredAuthorityHolder),
    };
  }
  if (ac.requestedValue) {
    if (!ac.delegatedLimit) {
      return {
        ...base,
        requiredAuthority: ac.authorityType,
        resolvedAuthorityHolder: ac.requiredAuthorityHolder,
        withinDelegatedAuthority: false,
        route: holderRoute(ac.requiredAuthorityHolder),
        missingAuthorityPolicy: true,
      };
    }
    if (ac.requestedValue.currency !== ac.delegatedLimit.currency) {
      return {
        ...base,
        requiredAuthority: ac.authorityType,
        resolvedAuthorityHolder: ac.requiredAuthorityHolder,
        withinDelegatedAuthority: false,
        route: holderRoute(ac.requiredAuthorityHolder),
        currencyMismatch: true,
      };
    }
    const within = ac.requestedValue.amount <= ac.delegatedLimit.amount;
    return {
      ...base,
      requiredAuthority: within ? null : ac.authorityType,
      resolvedAuthorityHolder: within ? null : ac.requiredAuthorityHolder,
      withinDelegatedAuthority: within,
      route: within ? null : holderRoute(ac.requiredAuthorityHolder),
    };
  }
  // authority type set, no value, not explicit → the `delegated` flag decides
  const within = ac.delegated;
  return {
    ...base,
    requiredAuthority: within ? null : ac.authorityType,
    resolvedAuthorityHolder: within ? null : ac.requiredAuthorityHolder,
    withinDelegatedAuthority: within,
    route: within ? null : holderRoute(ac.requiredAuthorityHolder),
  };
}

// ── ownership mapping ────────────────────────────────────────────────────────
function partyToOwner(a: OwnershipAssignment): DecisionOwner {
  switch (a.party_kind) {
    case "user":
    case "engineer":
      return { kind: "tenant_user", id: a.party_ref };
    case "role":
    case "department":
    case "team":
      return { kind: "tenant_role", roleKey: a.party_ref };
    case "customer":
      return { kind: "customer", id: a.party_ref };
    case "supplier":
      return { kind: "supplier", id: a.party_ref };
    case "external":
      return { kind: "external_party", id: a.party_ref };
    case "automation":
      return { kind: "automation", id: a.party_ref };
    default:
      return { kind: "ai" };
  }
}
function pick(assignments: OwnershipAssignment[], role: string): OwnershipAssignment | null {
  return assignments.find((x) => x.raci_role === role) ?? null;
}

/** Evaluate one intelligence object into an immutable Decision Package. */
export function evaluateDecision(input: DecisionInput): DecisionPackage {
  const pd = evaluatePolicies(input.policies, input.object, input.profile, { now: input.now });
  const confidence = axisConfidence(input);
  const risk = axisRisk(input);
  const reversibility = axisReversibility(input);
  const authority = axisAuthority(input);
  const impact = axisImpact(input, risk.level);
  const proposal = pd.action_proposals[0] ?? null;
  const a = input.object.attributes ?? {};

  // ── fail-safe: which decision-critical config is absent? (never default permissively) ─
  const missingKeys: string[] = [];
  const missingCodes: ReasonCode[] = [];
  const requireKey = (ok: boolean, key: string, code: ReasonCode) => {
    if (!ok) {
      missingKeys.push(key);
      if (!missingCodes.includes(code)) missingCodes.push(code);
    }
  };
  requireKey(
    present(input.profile, "confidence.customer_facing_min"),
    "confidence.customer_facing_min",
    "incomplete_configuration",
  );
  requireKey(
    present(input.profile, "confidence.evidence_floor"),
    "confidence.evidence_floor",
    "incomplete_configuration",
  );
  if (confidence.ambiguityScore > 0) {
    requireKey(
      present(input.profile, "confidence.auto_max_ambiguity"),
      "confidence.auto_max_ambiguity",
      "incomplete_configuration",
    );
  }
  if ((input.object.risk ?? 0) > 0) {
    requireKey(
      present(input.profile, "risk.high_min") &&
        present(input.profile, "risk.critical_min") &&
        present(input.profile, "risk.auto_max_score"),
      "risk.high_min|risk.critical_min|risk.auto_max_score",
      "missing_risk_policy",
    );
  }
  if (proposal?.automation_intent && !pd.automation_permission_set) {
    requireKey(false, "automation_permission", "missing_automation_policy");
  }
  if (authority.missingAuthorityPolicy) {
    requireKey(false, "authority.delegated_limit", "missing_authority_policy");
  }

  // ── deterministic routing precedence (ordered; first match wins) ────────────
  const evidenceFloor = pnum(input.profile, "confidence.evidence_floor", 0.3) ?? 0.3;
  const maxAmbiguity = pnum(input.profile, "confidence.auto_max_ambiguity", 0) ?? 0;
  const riskAutoMax = pnum(input.profile, "risk.auto_max_score", 0) ?? 0;

  let destination: DecisionDestination;
  let codes: ReasonCode[];
  if (a["evidence_conflicting"] === true) {
    destination = "OPENFOLK_REVIEW";
    codes = ["conflicting_evidence"];
  } else if (confidence.evidenceQuality < evidenceFloor) {
    destination = "OPENFOLK_REVIEW";
    codes = ["evidence_insufficient"];
  } else if (missingCodes.length > 0) {
    destination = "OPENFOLK_REVIEW";
    codes = missingCodes; // fail safe, never permit
  } else if (authority.currencyMismatch) {
    destination = "OPENFOLK_REVIEW";
    codes = ["authority_currency_mismatch"];
  } else if (pd.matched_rules.length === 0) {
    destination = "OPENFOLK_REVIEW";
    codes = ["missing_policy"];
  } else if (confidence.score < confidence.threshold) {
    destination = "OPENFOLK_REVIEW";
    codes = ["confidence_below_threshold"];
  } else if (confidence.ambiguityScore > maxAmbiguity) {
    destination = "OPENFOLK_REVIEW";
    codes = ["ambiguity_too_high"];
  } else if (!authority.withinDelegatedAuthority && authority.route === "customer") {
    destination = "CUSTOMER_APPROVAL";
    codes = ["customer_approval_required", "authority_required", "outside_delegated_limit"];
  } else if (!authority.withinDelegatedAuthority && authority.route === "tenant") {
    destination = "TENANT_SENIOR_REVIEW";
    codes = ["authority_required", "outside_delegated_limit"];
  } else if (!authority.withinDelegatedAuthority && authority.route === "external") {
    destination = "ESCALATE";
    codes = ["authority_required"];
  } else if (!authority.withinDelegatedAuthority) {
    destination = "OPENFOLK_REVIEW";
    codes = ["authority_required"];
  } else if (pd.review_route === "tenant_senior") {
    destination = "TENANT_SENIOR_REVIEW";
    codes = ["tenant_judgement_required"];
  } else if ((risk.level === "high" || risk.level === "critical") && risk.score > riskAutoMax) {
    destination = "OPENFOLK_REVIEW";
    codes = ["risk_exceeds_policy"];
  } else if (
    reversibility.level === "irreversible" &&
    risk.level !== "none" &&
    risk.level !== "low"
  ) {
    destination = "OPENFOLK_REVIEW";
    codes = ["irreversible_action"];
  } else if (a["wait_for_event"]) {
    destination = "WAIT_FOR_EVENT";
    codes = ["dependency_unmet"];
  } else if (pd.prohibited) {
    destination = "REJECT";
    codes = ["policy_prohibits_action"];
  } else if (proposal) {
    if (proposal.automation_intent && pd.automation_permission === "act") {
      destination = "AUTOMATION_AUTHORISED";
      codes = [
        "automation_authorised",
        "automation_permitted",
        "risk_within_policy",
        "within_delegated_authority",
      ];
    } else if (proposal.automation_intent && pd.automation_permission === "suggest") {
      destination = "AUTOMATION_REQUIRES_APPROVAL";
      codes = ["automation_permitted", "confidence_sufficient"];
    } else {
      destination = "AUTOMATION_AUTHORISED";
      codes = ["confidence_sufficient", "within_delegated_authority"];
    }
  } else {
    destination = "NO_ACTION";
    codes = ["no_action_required"];
  }

  // AUTOMATION_AUTHORISED / AUTOMATION_REQUIRES_APPROVAL: emit the intent (NEVER execute here).
  const emitsAutomation =
    destination === "AUTOMATION_AUTHORISED" || destination === "AUTOMATION_REQUIRES_APPROVAL";
  const automationIntent =
    emitsAutomation && proposal?.automation_intent
      ? {
          intentType: proposal.automation_intent,
          payload: { action_type: proposal.action_type, subject: proposal.title, due: pd.deadline },
          requiresApproval: destination === "AUTOMATION_REQUIRES_APPROVAL",
        }
      : null;

  const responsible = proposal?.owner ?? pick(pd.assignments, "responsible");
  const nextDecisionOwner: DecisionOwner = ((): DecisionOwner => {
    switch (destination) {
      case "AUTOMATION_AUTHORISED":
        return automationIntent
          ? { kind: "automation" }
          : responsible
            ? partyToOwner(responsible)
            : { kind: "ai" };
      case "AUTOMATION_REQUIRES_APPROVAL":
        return { kind: "automation", displayLabel: "pending automation approval" };
      case "OPENFOLK_REVIEW":
      case "ESCALATE":
        return { kind: "openfolk_user" };
      case "TENANT_SENIOR_REVIEW":
        return {
          kind: "tenant_role",
          roleKey: (profileValue(input.profile, "escalation.senior_role") as string) ?? "manager",
        };
      case "CUSTOMER_APPROVAL":
        return { kind: "customer", id: authority.resolvedAuthorityHolder ?? undefined };
      case "WAIT_FOR_EVENT":
        return { kind: "event" };
      default:
        return { kind: "ai" };
    }
  })();

  const reviewRequired =
    destination === "OPENFOLK_REVIEW" ||
    destination === "TENANT_SENIOR_REVIEW" ||
    destination === "CUSTOMER_APPROVAL" ||
    destination === "ESCALATE";
  const rejectedAlternatives =
    proposal &&
    destination !== "AUTOMATION_AUTHORISED" &&
    destination !== "AUTOMATION_REQUIRES_APPROVAL"
      ? ["AUTOMATION_AUTHORISED"]
      : [];

  const pkg: DecisionPackage = {
    id: input.decisionId,
    tenantId: input.object.tenant_id,
    supersedes: input.supersedes ?? null,
    intelligenceObjectId: input.object.id ?? "",
    intelligenceObjectType: input.object.object_type,
    objectClass: input.object.object_class ?? "unknown",
    domainPackKeys: input.domainPackKeys,
    decision: destination,
    nextDecisionOwner,
    rationale: {
      summary: `${destination} — ${codes.join(", ")}`,
      reasonCodes: codes,
      policyMatches: pd.matched_rules.map((m) => `${m.policy_id}:${m.rule_id}`),
      rejectedAlternatives,
      missingConfiguration: missingKeys,
    },
    confidence,
    authority: {
      requiredAuthority: authority.requiredAuthority,
      resolvedAuthorityHolder: authority.resolvedAuthorityHolder,
      delegatedLimit: authority.delegatedLimit,
      requestedValue: authority.requestedValue,
      withinDelegatedAuthority: authority.withinDelegatedAuthority,
    },
    risk,
    reversibility,
    impact,
    ownership: {
      responsible: pick(pd.assignments, "responsible"),
      accountable: pick(pd.assignments, "accountable"),
      approver: pick(pd.assignments, "approver"),
      waitingOn: pick(pd.assignments, "waiting_on"),
      consulted: pd.assignments.filter((x) => x.raci_role === "consulted"),
      informed: pd.assignments.filter((x) => x.raci_role === "informed"),
    },
    proposedAction: proposal
      ? {
          actionType: proposal.action_type,
          title: proposal.title,
          description: proposal.description,
          priority: pd.priority,
          dueAt: pd.deadline,
        }
      : null,
    automationIntent,
    routing: {
      reviewRequired,
      openfolkRequired: destination === "OPENFOLK_REVIEW" || destination === "ESCALATE",
      tenantReviewRequired: destination === "TENANT_SENIOR_REVIEW",
      customerApprovalRequired: destination === "CUSTOMER_APPROVAL",
      waitCondition:
        destination === "WAIT_FOR_EVENT"
          ? ((a["wait_for_event"] as Record<string, unknown>) ?? null)
          : null,
    },
    versions: {
      engineVersion: input.engineVersion,
      operatingProfileVersion: input.operatingProfileVersion,
      policyVersionIds: pd.policy_version_ids,
      learningVersionIds: input.learningVersionIds,
      domainPackVersions: input.domainPackVersions,
    },
    evidence: {
      interactionIds: input.object.source_interactions ?? [],
      entityIds: input.object.source_entities ?? [],
      objectIds: input.object.id ? [input.object.id] : [],
      evidenceHash: stableHash(input.object.evidence ?? []),
    },
    outcomeContract: proposal
      ? {
          expectedOutcomeType: `${proposal.action_type}_completed`,
          measurableSignals: [proposal.action_type],
          timeoutAt: pd.deadline,
          objectiveId: (a["objective_id"] as string) ?? null,
        }
      : { expectedOutcomeType: null, measurableSignals: [], timeoutAt: null, objectiveId: null },
    audit: {
      inputHash: stableHash({
        o: input.object,
        p: input.profile,
        a: input.authority,
        v: pd.policy_version_ids,
        e: input.engineVersion,
      }),
      outputHash: "",
      evaluatedAt: input.evaluatedAt,
      correlationId: input.correlationId,
    },
  };
  pkg.audit.outputHash = stableHash({ ...pkg, audit: { ...pkg.audit, outputHash: "" } });
  return deepFreeze(pkg);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) deepFreeze((o as Record<string, unknown>)[k]);
    Object.freeze(o);
  }
  return o;
}
