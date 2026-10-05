// Reference proof of the COMPLETE Intelligence Loop. Run:
//   node supabase/functions/_shared/intelligence/action_loop.verify.ts
//
// Observation → Decision → Action → Automation Intent → Review → Approval →
// Correction → Versioned Improvement → Improved future decision — for BOTH
// ServiceOS and ProductOS through the SAME functions, config only, no branching.

import { profileValue, resolveEffectiveProfile } from "./profile.ts";
import { evaluatePolicies } from "./policy.ts";
import { automationIntentFor, buildActionDrafts } from "./action.ts";
import { applyImprovement, proposeImprovement } from "./learning.ts";
import type { Correction, IntelligenceObject, Policy, ProfileEntry } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

// ── Configuration (mirrors the seed migration) ──────────────────────────────
const ENTRIES: ProfileEntry[] = [
  {
    scope_kind: "platform",
    scope_ref: null,
    domain: null,
    namespace: "confidence",
    key: "customer_facing_min",
    value: 0.8,
  },
  {
    scope_kind: "platform",
    scope_ref: null,
    domain: null,
    namespace: "sla",
    key: "action_hours",
    value: 48,
  },
  {
    scope_kind: "platform",
    scope_ref: null,
    domain: null,
    namespace: "escalation",
    key: "default_accountable_role",
    value: "ops",
  },
  {
    scope_kind: "industry",
    scope_ref: "hvac",
    domain: null,
    namespace: "sla",
    key: "action_hours",
    value: 24,
  },
];

// Core policy: ownership + SLA + confidence routing (domain-agnostic).
const CORE_POLICY: Policy = {
  id: "p-core",
  domain: "core",
  scope_kind: "platform",
  name: "Observation routing",
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
        set_deadline_hours: { profile: "sla.action_hours" },
      },
    },
    {
      id: "route-low-confidence",
      when: {
        op: "lt",
        left: { field: "confidence" },
        right: { profile: "confidence.customer_facing_min" },
      },
      then: { review_route: "openfolk", reason: "Below customer-facing confidence threshold" },
    },
  ],
};
// Domain packs contribute the intent→Action mapping as DATA (no code branching).
const SERVICEOS_POLICY: Policy = {
  id: "p-svc",
  domain: "serviceos",
  scope_kind: "domain",
  name: "ServiceOS actions",
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
      },
    },
  ],
};
const PRODUCTOS_POLICY: Policy = {
  id: "p-prod",
  domain: "productos",
  scope_kind: "domain",
  name: "ProductOS actions",
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
      },
    },
  ],
};
const POLICIES = [CORE_POLICY, SERVICEOS_POLICY, PRODUCTOS_POLICY];
const NOW = Date.parse("2026-07-17T12:00:00Z");
const TENANT = "00000000-0000-0000-0000-000000000001";

const observe = (over: Partial<IntelligenceObject>): IntelligenceObject => ({
  tenant_id: TENANT,
  domain: "serviceos",
  object_type: "Observation",
  object_class: "observation",
  subject: "Customer requested engineer visit",
  status: "unknown",
  evidence: [{ source: "email", detail: "‘can someone come look at the boiler?’" }],
  attributes: { intent: "engineer_visit_requested" },
  ...over,
});

// ── STEP 1 — email → observation → decision, low confidence ⇒ REVIEW ────────
console.log("ServiceOS — low-confidence observation (0.72):");
const svcProfile = resolveEffectiveProfile(ENTRIES, {
  tenantId: TENANT,
  industry: "hvac",
  domain: "serviceos",
});
const obs = observe({ id: "obs-1", confidence: 0.72 });
const d1 = evaluatePolicies(POLICIES, obs, svcProfile, { now: NOW });
check(
  "routed to OpenFolk review (not the customer)",
  d1.review_route === "openfolk",
  d1.review_route,
);
check(
  "an Action was proposed but NOT yet created",
  d1.action_proposals.length === 1 &&
    d1.action_proposals[0].action_type === "assign_engineer_visit",
);
check(
  "accountable ownership resolved to role 'ops'",
  d1.assignments.some((a) => a.raci_role === "accountable" && a.party_ref === "ops"),
);
check(
  "SLA deadline from hvac industry layer (24h)",
  d1.deadline === new Date(NOW + 24 * 3600_000).toISOString(),
  d1.deadline,
);

// ── STEP 2 — consultant approves ⇒ Action created + Automation INTENT ───────
console.log("OpenFolk approves → Action + Automation Intent (never executed):");
const actions = buildActionDrafts(obs, d1);
check("exactly one Action derived", actions.length === 1);
check("Action derived_from the observation", actions[0].derived_from === "obs-1");
check("Action owner resolved (role)", actions[0].owner?.party_ref === "ops");
const intent = automationIntentFor(actions[0]);
check(
  "Automation Intent EMITTED (not executed)",
  intent?.intent_type === "schedule_engineer_visit",
  intent,
);

// ── STEP 3 — consultant correction ⇒ layered, versioned improvement ─────────
console.log("Correction → versioned improvement (industry layer only):");
const correction: Correction = {
  original: { review_route: "openfolk" },
  corrected: { review_route: "auto" },
  why: "For HVAC, engineer-visit requests are safe to auto at ≥0.7",
  layer: "industry",
  operator: "consultant-42",
  policy_version_ids: d1.policy_version_ids,
  confidence: 0.72,
  target: { namespace: "confidence", key: "customer_facing_min", value: 0.7, scope_ref: "hvac" },
};
const improvement = proposeImprovement(correction);
check(
  "improvement lands at the INDUSTRY layer",
  improvement.entry?.scope_kind === "industry",
  improvement.entry?.scope_kind,
);
check(
  "improvement scoped to hvac (not universal, not tenant)",
  improvement.entry?.scope_ref === "hvac",
);

// ── STEP 4 — improved FUTURE decision (the flywheel closes) ─────────────────
console.log("Re-run the SAME observation after learning:");
const improvedProfile = resolveEffectiveProfile(applyImprovement(ENTRIES, improvement), {
  tenantId: TENANT,
  industry: "hvac",
  domain: "serviceos",
});
check(
  "hvac threshold improved to 0.7",
  profileValue(improvedProfile, "confidence.customer_facing_min") === 0.7,
);
const d1b = evaluatePolicies(POLICIES, obs, improvedProfile, { now: NOW });
check(
  "SAME observation now AUTO (improved future decision)",
  d1b.review_route === "auto",
  d1b.review_route,
);
const universal = resolveEffectiveProfile(applyImprovement(ENTRIES, improvement), {
  tenantId: TENANT,
  industry: null,
  domain: "serviceos",
});
check(
  "universal layer UNTOUCHED (still 0.8) — layers never mixed",
  profileValue(universal, "confidence.customer_facing_min") === 0.8,
  profileValue(universal, "confidence.customer_facing_min"),
);

// ── STEP 5 — ProductOS through the SAME functions, config only ──────────────
console.log("ProductOS — identical engine, different pack data:");
const prodProfile = resolveEffectiveProfile(ENTRIES, {
  tenantId: TENANT,
  industry: "hvac",
  domain: "productos",
});
const prodObs = observe({
  id: "obs-2",
  domain: "productos",
  subject: "Stock low on part SKU-4471",
  confidence: 0.95,
  attributes: { intent: "stock_low" },
});
const d2 = evaluatePolicies(POLICIES, prodObs, prodProfile, { now: NOW });
check("high confidence ⇒ automatic (no review)", d2.review_route === "auto", d2.review_route);
const prodActions = buildActionDrafts(prodObs, d2);
check(
  "ProductOS Action derived by the SAME buildActionDrafts",
  prodActions[0]?.action_type === "raise_purchase_order",
  prodActions[0]?.action_type,
);
check(
  "ProductOS Automation Intent emitted",
  automationIntentFor(prodActions[0])?.intent_type === "create_purchase_order",
);

// ── STEP 6 — learning-layer routing is exhaustive & never mixed ─────────────
console.log("Learning layers route to distinct scopes:");
const tenantImp = proposeImprovement({
  ...correction,
  layer: "tenant",
  target: { namespace: "confidence", key: "customer_facing_min", value: 0.75, scope_ref: TENANT },
});
const univImp = proposeImprovement({
  ...correction,
  layer: "universal",
  target: { namespace: "confidence", key: "customer_facing_min", value: 0.85, scope_ref: null },
});
check("tenant correction → tenant scope", tenantImp.entry?.scope_kind === "tenant");
check("universal correction → platform scope", univImp.entry?.scope_kind === "platform");

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED — the loop is proven end-to-end for both domains."
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
