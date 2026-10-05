// Pure-engine conformance self-test. Run: `node supabase/functions/_shared/intelligence/verify.ts`
// Proves the SAME evaluator + resolver drive ServiceOS and ProductOS from data
// alone (acceptance #1), plus confidence routing, ownership and SLA deadlines.

import { resolveEffectiveProfile, profileValue } from "./profile.ts";
import { evaluatePolicies } from "./policy.ts";
import type { IntelligenceObject, Policy, ProfileEntry } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(
    `  [${tag}] ${name}${!cond && detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

// ── Profile entries mirroring 20260716120600_seed_core_and_slice.sql ────────
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
    namespace: "confidence",
    key: "auto_max_ambiguity",
    value: 0.3,
  },
  {
    scope_kind: "platform",
    scope_ref: null,
    domain: null,
    namespace: "risk",
    key: "manual_min_risk",
    value: 0.6,
  },
  {
    scope_kind: "platform",
    scope_ref: null,
    domain: null,
    namespace: "risk",
    key: "irreversible_max",
    value: 0.3,
  },
  {
    scope_kind: "platform",
    scope_ref: null,
    domain: null,
    namespace: "sla",
    key: "commitment_hours",
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
    key: "commitment_hours",
    value: 24,
  },
];

// ── Commitment policy mirroring the seeded policies.rules ────────────────────
const POLICY: Policy = {
  id: "20000000-0000-0000-0000-000000000001",
  domain: "core",
  scope_kind: "platform",
  name: "Commitment routing & ownership",
  priority: 100,
  version_id: "10000000-0000-0000-0000-000000000003",
  rules: [
    {
      id: "assign-accountable",
      when: { op: "eq", left: { field: "object_type" }, right: { const: "Commitment" } },
      then: {
        assign: [
          {
            raci_role: "accountable",
            party_kind: "role",
            party_ref: { profile: "escalation.default_accountable_role" },
          },
        ],
        set_deadline_hours: { profile: "sla.commitment_hours" },
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
    {
      id: "route-ambiguous",
      when: {
        op: "gt",
        left: { field: "ambiguity" },
        right: { profile: "confidence.auto_max_ambiguity" },
      },
      then: { review_route: "openfolk", reason: "Ambiguous extraction" },
    },
    {
      id: "route-irreversible-risk",
      when: {
        op: "and",
        clauses: [
          { op: "gte", left: { field: "risk" }, right: { profile: "risk.manual_min_risk" } },
          {
            op: "lt",
            left: { field: "reversibility" },
            right: { profile: "risk.irreversible_max" },
          },
        ],
      },
      then: {
        review_route: "tenant_senior",
        set_priority: "high",
        reason: "High-risk irreversible commitment",
      },
    },
  ],
};

const NOW = Date.parse("2026-07-16T12:00:00Z");
const baseObj = (over: Partial<IntelligenceObject>): IntelligenceObject => ({
  tenant_id: "00000000-0000-0000-0000-000000000001",
  domain: "serviceos",
  object_type: "Commitment",
  subject: "Call the customer back about the boiler quote",
  status: "unknown",
  ...over,
});

// ── 1. Layered resolution: industry (hvac) overrides platform SLA ───────────
console.log("Profile resolution:");
const svcProfile = resolveEffectiveProfile(ENTRIES, {
  tenantId: "t",
  industry: "hvac",
  domain: "serviceos",
});
const prodProfile = resolveEffectiveProfile(ENTRIES, {
  tenantId: "t",
  industry: "hvac",
  domain: "productos",
});
const noIndustry = resolveEffectiveProfile(ENTRIES, {
  tenantId: "t",
  industry: null,
  domain: "serviceos",
});
check(
  "hvac industry overrides SLA to 24h",
  profileValue(svcProfile, "sla.commitment_hours") === 24,
  profileValue(svcProfile, "sla.commitment_hours"),
);
check(
  "no-industry falls back to platform 48h",
  profileValue(noIndustry, "sla.commitment_hours") === 48,
  profileValue(noIndustry, "sla.commitment_hours"),
);

// ── 2. Same engine, both domains — low-confidence Commitment ────────────────
console.log("ServiceOS — low-confidence commitment:");
const svc = evaluatePolicies(
  [POLICY],
  baseObj({ domain: "serviceos", confidence: 0.5, ambiguity: 0.1, risk: 0.2, reversibility: 0.9 }),
  svcProfile,
  { now: NOW },
);
check(
  "routes to OpenFolk (below customer-facing threshold)",
  svc.review_route === "openfolk",
  svc.review_route,
);
check(
  "accountable resolved to role 'ops'",
  svc.assignments.some((a) => a.raci_role === "accountable" && a.party_ref === "ops"),
);
check(
  "deadline set 24h out (hvac SLA)",
  svc.deadline === new Date(NOW + 24 * 3600_000).toISOString(),
  svc.deadline,
);

console.log("ProductOS — SAME policy, high-risk irreversible commitment:");
const prod = evaluatePolicies(
  [POLICY],
  baseObj({
    domain: "productos",
    subject: "Confirm stock allocation to order #4471",
    confidence: 0.95,
    ambiguity: 0.1,
    risk: 0.8,
    reversibility: 0.1,
  }),
  prodProfile,
  { now: NOW },
);
check(
  "routes to tenant_senior (risky + irreversible)",
  prod.review_route === "tenant_senior",
  prod.review_route,
);
check("priority escalated to high", prod.priority === "high", prod.priority);
check(
  "accountable resolved to role 'ops' (same core rule)",
  prod.assignments.some((a) => a.party_ref === "ops"),
);

// ── 3. Clean, high-confidence case stays automatic ──────────────────────────
console.log("Automatic path (confident, low risk):");
const auto = evaluatePolicies(
  [POLICY],
  baseObj({ confidence: 0.97, ambiguity: 0.05, risk: 0.1, reversibility: 0.95 }),
  svcProfile,
  { now: NOW },
);
check("stays automatic (no human review)", auto.review_route === "auto", auto.review_route);
check("still gets an accountable owner", auto.assignments.length >= 1);

// ── 4. Determinism (same inputs ⇒ same input_hash) ──────────────────────────
const a = evaluatePolicies([POLICY], baseObj({ confidence: 0.5 }), svcProfile, { now: NOW });
const b = evaluatePolicies([POLICY], baseObj({ confidence: 0.5 }), svcProfile, { now: NOW });
console.log("Determinism:");
check("identical inputs ⇒ identical input_hash (replayable)", a.input_hash === b.input_hash);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
