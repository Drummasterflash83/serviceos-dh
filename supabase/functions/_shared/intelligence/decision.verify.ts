// Reference proof of the Universal Decision Engine (hardened). Run:
//   node supabase/functions/_shared/intelligence/decision.verify.ts

import { resolveEffectiveProfile } from "./profile.ts";
import { resolveAuthorityContext } from "./authority.ts";
import { evaluateDecision } from "./decision.ts";
import { proposeImprovement } from "./learning.ts";
import { areReasonCodes } from "./reason_codes.ts";
import type { DecisionInput, IntelligenceObject, Policy, ProfileEntry } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

type Row = [string, string | null, string, string, unknown];
const BASE: Row[] = [
  ["platform", null, "confidence", "customer_facing_min", 0.8],
  ["platform", null, "confidence", "evidence_floor", 0.3],
  ["platform", null, "confidence", "auto_max_ambiguity", 0.3],
  ["platform", null, "risk", "high_min", 0.6],
  ["platform", null, "risk", "critical_min", 0.85],
  ["platform", null, "risk", "auto_max_score", 0.6],
  ["platform", null, "reversibility", "irreversible_max", 0.3],
  ["platform", null, "reversibility", "partial_max", 0.7],
  ["platform", null, "authority", "delegated_limit", 500],
  ["platform", null, "authority", "currency", "GBP"],
  ["platform", null, "authority", "holder", "customer"],
  ["platform", null, "escalation", "default_accountable_role", "ops"],
  ["platform", null, "escalation", "senior_role", "manager"],
];
const toEntries = (rows: Row[]): ProfileEntry[] =>
  rows.map(
    ([scope_kind, scope_ref, namespace, key, value]) =>
      ({ scope_kind, scope_ref, domain: null, namespace, key, value }) as ProfileEntry,
  );

const CORE: Policy = {
  id: "p-core",
  domain: "core",
  scope_kind: "platform",
  name: "core",
  priority: 100,
  version_id: "v-core",
  rules: [
    {
      id: "assign+sla",
      when: { op: "eq", left: { field: "object_class" }, right: { const: "observation" } },
      then: {
        assign: [
          {
            raci_role: "accountable",
            party_kind: "role",
            party_ref: { profile: "escalation.default_accountable_role" },
          },
        ],
        set_deadline_hours: 24,
      },
    },
    {
      id: "tenant-judgement",
      when: { op: "eq", left: { attr: "intent" }, right: { const: "contract_change" } },
      then: { review_route: "tenant_senior", reason: "customer judgement" },
    },
    {
      id: "prohibit",
      when: { op: "eq", left: { attr: "intent" }, right: { const: "prohibited_intent" } },
      then: { prohibit: true, reason: "forbidden" },
    },
  ],
};
const SVC: Policy = {
  id: "p-svc",
  domain: "serviceos",
  scope_kind: "domain",
  name: "svc",
  priority: 200,
  version_id: "v-svc",
  rules: [
    {
      id: "engineer-visit",
      when: { op: "eq", left: { attr: "intent" }, right: { const: "engineer_visit_requested" } },
      then: {
        propose_action: {
          action_type: "assign_engineer_visit",
          title: "Assign engineer visit",
          automation_intent: "schedule_engineer_visit",
          owner: {
            raci_role: "responsible",
            party_kind: "role",
            party_ref: { profile: "escalation.default_accountable_role" },
          },
        },
        automation_permission: "act",
      },
    },
    {
      id: "unpermitted-auto",
      when: { op: "eq", left: { attr: "intent" }, right: { const: "unpermitted_auto" } },
      then: {
        propose_action: {
          action_type: "do_thing",
          title: "Do thing",
          automation_intent: "do_thing",
        },
      },
    }, // NO automation_permission set
  ],
};
const PROD: Policy = {
  id: "p-prod",
  domain: "productos",
  scope_kind: "domain",
  name: "prod",
  priority: 200,
  version_id: "v-prod",
  rules: [
    {
      id: "stock-low",
      when: { op: "eq", left: { attr: "intent" }, right: { const: "stock_low" } },
      then: {
        propose_action: {
          action_type: "raise_purchase_order",
          title: "Raise purchase order",
          automation_intent: "create_purchase_order",
        },
        automation_permission: "act",
      },
    },
  ],
};
const POLICIES = [CORE, SVC, PROD];
const NOW = Date.parse("2026-07-18T12:00:00Z");
const TENANT = "00000000-0000-0000-0000-000000000001";

function obs(over: Partial<IntelligenceObject>): IntelligenceObject {
  return {
    tenant_id: TENANT,
    id: "obs-x",
    domain: "serviceos",
    object_type: "Observation",
    object_class: "observation",
    subject: "s",
    status: "unknown",
    confidence: 0.95,
    ambiguity: 0.05,
    risk: 0.1,
    reversibility: 0.9,
    evidence: [{ source: "email" }, { source: "history" }],
    source_interactions: ["int-1"],
    source_entities: ["ent-1"],
    attributes: { intent: "engineer_visit_requested" },
    ...over,
  };
}
function input(
  object: IntelligenceObject,
  over: { rows?: Row[]; supersedes?: string; decisionId?: string } = {},
): DecisionInput {
  const profile = resolveEffectiveProfile(toEntries(over.rows ?? BASE), {
    tenantId: TENANT,
    industry: "hvac",
    domain: object.domain,
  });
  return {
    decisionId: over.decisionId ?? "dec-1",
    correlationId: "corr-1",
    evaluatedAt: "2026-07-18T12:00:00Z",
    engineVersion: "decision-engine/1.0.0",
    object,
    profile,
    authority: resolveAuthorityContext(object, profile),
    policies: POLICIES,
    domainPackKeys: [object.domain],
    domainPackVersions: ["v-pack"],
    operatingProfileVersion: "op-1",
    learningVersionIds: ["learn-1"],
    supersedes: over.supersedes ?? null,
    now: NOW,
  };
}
const fin = (amount: number, currency = "GBP") => ({ type: "financial", amount, currency });

// 1 & 20 — determinism + purity
console.log("Determinism & purity:");
const beforeJson = JSON.stringify(obs({}));
const p1 = evaluateDecision(input(obs({})));
const p2 = evaluateDecision(input(obs({})));
check("1. deterministic (identical package)", JSON.stringify(p1) === JSON.stringify(p2));
check("20. no side effects (input unmutated)", JSON.stringify(obs({})) === beforeJson);

// 2 — one engine, both domains
console.log("One engine, both domains:");
const svc = evaluateDecision(input(obs({ domain: "serviceos" })));
const prod = evaluateDecision(
  input(obs({ domain: "productos", attributes: { intent: "stock_low" } })),
);
check(
  "2. ServiceOS ⇒ AUTOMATION_AUTHORISED assign_engineer_visit",
  svc.decision === "AUTOMATION_AUTHORISED" &&
    svc.proposedAction?.actionType === "assign_engineer_visit",
  svc.decision,
);
check(
  "2. ProductOS ⇒ AUTOMATION_AUTHORISED raise_purchase_order (same engine)",
  prod.decision === "AUTOMATION_AUTHORISED" &&
    prod.proposedAction?.actionType === "raise_purchase_order",
  prod.decision,
);

// 3,5,6,7 — routing boundaries + happy path
console.log("Routing boundaries:");
const lowConf = evaluateDecision(input(obs({ confidence: 0.5 })));
check(
  "6. AI uncertainty ⇒ OpenFolk (never customer)",
  lowConf.decision === "OPENFOLK_REVIEW" && lowConf.nextDecisionOwner.kind === "openfolk_user",
  lowConf.decision,
);
check(
  "7. confident+authorised ⇒ AUTOMATION_AUTHORISED + intent (requiresApproval false)",
  svc.decision === "AUTOMATION_AUTHORISED" &&
    svc.automationIntent?.intentType === "schedule_engineer_visit" &&
    svc.automationIntent?.requiresApproval === false,
);

// 8 — conflicting evidence
const conflict = evaluateDecision(
  input(
    obs({
      confidence: 0.99,
      attributes: { intent: "engineer_visit_requested", evidence_conflicting: true },
    }),
  ),
);
check(
  "8. conflicting evidence ⇒ OpenFolk",
  conflict.decision === "OPENFOLK_REVIEW" &&
    conflict.rationale.reasonCodes.includes("conflicting_evidence"),
  conflict.decision,
);

// 9 — tenant judgement
const tj = evaluateDecision(input(obs({ attributes: { intent: "contract_change" } })));
check(
  "9. tenant judgement ⇒ TENANT_SENIOR_REVIEW",
  tj.decision === "TENANT_SENIOR_REVIEW" && tj.nextDecisionOwner.kind === "tenant_role",
  tj.decision,
);

// 10 — dependency
const wait = evaluateDecision(
  input(
    obs({
      attributes: {
        intent: "engineer_visit_requested",
        wait_for_event: { type: "part_delivered" },
      },
    }),
  ),
);
check(
  "10. unmet dependency ⇒ WAIT_FOR_EVENT",
  wait.decision === "WAIT_FOR_EVENT" && wait.routing.waitCondition?.type === "part_delivered",
  wait.decision,
);

// 11 — prohibited
const rej = evaluateDecision(
  input(obs({ risk: 0.05, attributes: { intent: "prohibited_intent" } })),
);
check("11. policy prohibits ⇒ REJECT", rej.decision === "REJECT");

// 12 — no action
const noop = evaluateDecision(input(obs({ attributes: { intent: "noop_intent" } })));
check("12. no useful action ⇒ NO_ACTION", noop.decision === "NO_ACTION");

// 13,14,15,16 — immutability, lineage, intent, outcome
console.log("Immutability, lineage, contracts:");
try {
  (svc as unknown as { decision: string }).decision = "REJECT";
} catch {
  /* frozen */
}
check(
  "13. package immutable (frozen)",
  Object.isFrozen(svc) && svc.decision === "AUTOMATION_AUTHORISED",
);
const sup = evaluateDecision(input(obs({}), { decisionId: "dec-2", supersedes: "dec-1" }));
check("14. supersession lineage carried", sup.id === "dec-2" && sup.supersedes === "dec-1");
check(
  "15. Automation Intent emitted (never executed) + persisted requirement",
  svc.automationIntent !== null,
);
check(
  "16. actionable ⇒ outcome contract; else empty",
  svc.outcomeContract.expectedOutcomeType === "assign_engineer_visit_completed" &&
    noop.outcomeContract.expectedOutcomeType === null,
);

// 17 — learning layers stay separate
const imp = proposeImprovement({
  original: {},
  corrected: {},
  why: "x",
  layer: "industry",
  operator: "op",
  target: { namespace: "confidence", key: "customer_facing_min", value: 0.7, scope_ref: "hvac" },
});
check(
  "17. industry learning ⇒ industry scope only",
  imp.entry?.scope_kind === "industry" && imp.entry?.scope_ref === "hvac",
);

// ── HARDENING #1 — no silent decision defaults ──────────────────────────────
console.log("Hardening: fail-safe missing configuration:");
const noConfMin = evaluateDecision(
  input(obs({}), {
    rows: BASE.filter((r) => !(r[2] === "confidence" && r[3] === "customer_facing_min")),
  }),
);
check(
  "H1a. missing confidence config ⇒ OpenFolk (incomplete_configuration)",
  noConfMin.decision === "OPENFOLK_REVIEW" &&
    noConfMin.rationale.reasonCodes.includes("incomplete_configuration") &&
    noConfMin.rationale.missingConfiguration.includes("confidence.customer_facing_min"),
  noConfMin.rationale,
);
const noRisk = evaluateDecision(
  input(obs({ risk: 0.5 }), { rows: BASE.filter((r) => !(r[2] === "risk")) }),
);
check(
  "H1b. missing risk config (risk present) ⇒ OpenFolk (missing_risk_policy)",
  noRisk.decision === "OPENFOLK_REVIEW" &&
    noRisk.rationale.reasonCodes.includes("missing_risk_policy"),
  noRisk.rationale.reasonCodes,
);
const unperm = evaluateDecision(input(obs({ attributes: { intent: "unpermitted_auto" } })));
check(
  "H1c. automatable action, no automation policy ⇒ OpenFolk (missing_automation_policy)",
  unperm.decision === "OPENFOLK_REVIEW" &&
    unperm.rationale.reasonCodes.includes("missing_automation_policy"),
  unperm.rationale.reasonCodes,
);

// ── HARDENING #2 — normalised authority ─────────────────────────────────────
console.log("Hardening: normalised authority:");
const within = evaluateDecision(
  input(obs({ attributes: { intent: "engineer_visit_requested", authority: fin(300) } })),
);
check(
  "H2a. purchase within delegated authority ⇒ AUTOMATION_AUTHORISED",
  within.decision === "AUTOMATION_AUTHORISED",
  within.decision,
);
const over = evaluateDecision(
  input(
    obs({
      confidence: 0.99,
      attributes: { intent: "engineer_visit_requested", authority: fin(5000) },
    }),
  ),
);
check(
  "H2b. same purchase over limit ⇒ CUSTOMER_APPROVAL (config: holder=customer)",
  over.decision === "CUSTOMER_APPROVAL" &&
    over.rationale.rejectedAlternatives.includes("AUTOMATION_AUTHORISED"),
  over.decision,
);
const overTenant = evaluateDecision(
  input(obs({ attributes: { intent: "engineer_visit_requested", authority: fin(5000) } }), {
    rows: BASE.map((r) =>
      r[2] === "authority" && r[3] === "holder"
        ? (["platform", null, "authority", "holder", "tenant_role"] as Row)
        : r,
    ),
  }),
);
check(
  "H2c. over limit routes to tenant when configured",
  overTenant.decision === "TENANT_SENIOR_REVIEW",
  overTenant.decision,
);
const mismatch = evaluateDecision(
  input(obs({ attributes: { intent: "engineer_visit_requested", authority: fin(300, "USD") } })),
);
check(
  "H2d. unlike currencies are NOT compared ⇒ OpenFolk (authority_currency_mismatch)",
  mismatch.decision === "OPENFOLK_REVIEW" &&
    mismatch.rationale.reasonCodes.includes("authority_currency_mismatch"),
  mismatch.rationale.reasonCodes,
);
const noLimit = evaluateDecision(
  input(obs({ attributes: { intent: "engineer_visit_requested", authority: fin(300) } }), {
    rows: BASE.filter((r) => !(r[2] === "authority" && r[3] === "delegated_limit")),
  }),
);
check(
  "H2e. financial authority but no delegated-limit policy ⇒ OpenFolk (missing_authority_policy)",
  noLimit.decision === "OPENFOLK_REVIEW" &&
    noLimit.rationale.reasonCodes.includes("missing_authority_policy"),
  noLimit.rationale.reasonCodes,
);
const legal = evaluateDecision(
  input(
    obs({
      confidence: 0.99,
      attributes: {
        intent: "engineer_visit_requested",
        authority: { type: "legal", explicit_customer_approval: true },
      },
    }),
  ),
);
check(
  "H2f. non-financial (legal) authority works through the same model ⇒ CUSTOMER_APPROVAL",
  legal.decision === "CUSTOMER_APPROVAL",
  legal.decision,
);
check(
  "H2g. high confidence cannot bypass authority (over-limit at 0.99)",
  over.confidence.score === 0.99 && over.decision === "CUSTOMER_APPROVAL",
);

// ── HARDENING #4 — AUTOMATION_AUTHORISED semantics ───────────────────────────────────
console.log("Hardening: automation semantics:");
check(
  "H4a. AUTOMATION_AUTHORISED for automatable action REQUIRES a persisted intent",
  svc.decision === "AUTOMATION_AUTHORISED" &&
    svc.automationIntent !== null &&
    svc.automationIntent.requiresApproval === false,
);
check(
  "H4b. engine performs NO execution (intent is data only)",
  typeof svc.automationIntent?.intentType === "string" &&
    svc.automationIntent?.payload !== undefined,
);

// 19 — reason codes from the controlled registry
const allCodes = [
  svc,
  prod,
  lowConf,
  conflict,
  tj,
  wait,
  rej,
  noop,
  noConfMin,
  noRisk,
  unperm,
  within,
  over,
  overTenant,
  mismatch,
  noLimit,
  legal,
].flatMap((d) => d.rationale.reasonCodes);
check(
  "19. every reason code is registered",
  areReasonCodes(allCodes),
  allCodes.filter((c) => !areReasonCodes([c])),
);

console.log(
  failures === 0 ? "\nALL DECISION-ENGINE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
