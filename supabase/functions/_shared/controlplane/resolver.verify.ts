// Run: node supabase/functions/_shared/controlplane/resolver.verify.ts
// Pure unit tests for the Control Plane ownership resolver. No DB, no network.
import assert from "node:assert/strict";
import { type AssignmentRow, type EndpointRow, resolveEndpointOwnership } from "./resolver.ts";

let failed = 0;
function ok(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
  }
}

const T0 = Date.parse("2026-07-23T12:00:00Z");
const HOUR = 3_600_000;

const endpoints: EndpointRow[] = [
  {
    id: "ep-ddi",
    tenant_id: "t",
    channel: "phone",
    endpoint_kind: "ddi",
    normalized_value: "+441111000123",
    provider: "simwood",
    provider_external_ref: "ddi-1",
    is_shared: false,
    status: "active",
  },
  {
    id: "ep-ext",
    tenant_id: "t",
    channel: "phone",
    endpoint_kind: "extension",
    normalized_value: "103",
    is_shared: false,
    status: "active",
  },
  {
    id: "ep-q",
    tenant_id: "t",
    channel: "phone",
    endpoint_kind: "queue",
    normalized_value: "scheduling",
    is_shared: true,
    status: "active",
  },
  {
    id: "ep-mbx",
    tenant_id: "t",
    channel: "email",
    endpoint_kind: "shared_mailbox",
    normalized_value: "sales@drummonds.example",
    is_shared: true,
    status: "active",
  },
];

function A(over: Partial<AssignmentRow>): AssignmentRow {
  return {
    id: "a1",
    endpoint_id: "ep-ddi",
    owner_kind: "person",
    owner_member_id: "m-alice",
    assignment_role: "accountable",
    effective_from: new Date(T0 - 10 * HOUR).toISOString(),
    effective_to: null,
    review_state: "confirmed",
    ...over,
  };
}

ok("direct DDI → accountable person", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", ddi: "+441111000123" },
    endpoints,
    assignments: [A({})],
    nowMs: T0,
  });
  assert.equal(r.matched, true);
  assert.equal(r.matchStep, "ddi");
  assert.equal(r.accountable?.ref, "m-alice");
  assert.ok(r.confidence >= 0.9);
});

ok("provider external ref matches before value", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", provider: "simwood", providerExternalRef: "ddi-1" },
    endpoints,
    assignments: [A({})],
    nowMs: T0,
  });
  assert.equal(r.matchStep, "provider_ref");
  assert.equal(r.sourceEndpoint?.id, "ep-ddi");
});

ok("extension match", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", extension: "103" },
    endpoints,
    assignments: [A({ id: "a2", endpoint_id: "ep-ext", owner_member_id: "m-bob" })],
    nowMs: T0,
  });
  assert.equal(r.matchStep, "extension");
  assert.equal(r.accountable?.ref, "m-bob");
});

ok("queue → team owner (shared endpoint warning)", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", queue: "scheduling" },
    endpoints,
    assignments: [
      A({
        id: "a3",
        endpoint_id: "ep-q",
        owner_kind: "team",
        owner_member_id: null,
        owner_org_unit_id: "team-sched",
        assignment_role: "accountable",
      }),
    ],
    nowMs: T0,
  });
  assert.equal(r.teamOrRole?.ref, "team-sched");
  assert.ok(r.warnings.includes("shared_endpoint"));
});

ok("cover coexists with accountable", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", ddi: "+441111000123" },
    endpoints,
    assignments: [
      A({ id: "acc", owner_member_id: "m-alice", assignment_role: "accountable" }),
      A({ id: "cov", owner_member_id: "m-carol", assignment_role: "cover" }),
      A({ id: "esc", owner_member_id: "m-dan", assignment_role: "escalation" }),
    ],
    nowMs: T0,
  });
  assert.equal(r.accountable?.ref, "m-alice");
  assert.equal(r.cover?.ref, "m-carol");
  assert.equal(r.escalation?.ref, "m-dan");
});

ok("role fallback when no accountable person (lower confidence)", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", queue: "scheduling" },
    endpoints,
    assignments: [
      A({
        id: "role1",
        endpoint_id: "ep-q",
        owner_kind: "role",
        owner_member_id: null,
        owner_role: "coordinator",
        assignment_role: "primary_handler",
      }),
    ],
    nowMs: T0,
  });
  // no accountable, but a role assignment exists → team/role fallback
  assert.equal(r.accountable, null);
  assert.equal(r.teamOrRole?.ref, "coordinator");
  assert.ok(r.confidence <= 0.6);
  assert.ok(r.warnings.includes("team_or_role_fallback"));
});

ok("unknown endpoint → unmapped, unresolved", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", ddi: "+449999999999" },
    endpoints,
    assignments: [A({})],
    nowMs: T0,
  });
  assert.equal(r.matched, false);
  assert.ok(r.unresolvedReason);
  assert.ok(r.warnings.includes("unmapped_endpoint"));
  assert.equal(r.confidence, 0);
});

ok("HISTORICAL lookup uses interaction time, not now", () => {
  // Alice owned it until T0-5h; Bob from T0-5h onward.
  const assignments = [
    A({
      id: "old",
      owner_member_id: "m-alice",
      effective_from: new Date(T0 - 20 * HOUR).toISOString(),
      effective_to: new Date(T0 - 5 * HOUR).toISOString(),
    }),
    A({
      id: "new",
      owner_member_id: "m-bob",
      effective_from: new Date(T0 - 5 * HOUR).toISOString(),
      effective_to: null,
    }),
  ];
  const past = resolveEndpointOwnership({
    evidence: { channel: "phone", ddi: "+441111000123" },
    endpoints,
    assignments,
    nowMs: T0 - 10 * HOUR,
  });
  const now = resolveEndpointOwnership({
    evidence: { channel: "phone", ddi: "+441111000123" },
    endpoints,
    assignments,
    nowMs: T0,
  });
  assert.equal(past.accountable?.ref, "m-alice", "at T-10h Alice owned it");
  assert.equal(now.accountable?.ref, "m-bob", "at now Bob owns it");
});

ok("future-dated assignment ignored before its start", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", ddi: "+441111000123" },
    endpoints,
    assignments: [A({ effective_from: new Date(T0 + 5 * HOUR).toISOString() })],
    nowMs: T0,
  });
  assert.equal(r.accountable, null, "future assignment must not apply yet");
  assert.ok(r.unresolvedReason);
});

ok("observed handoff changes likely handler, NOT accountable", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "phone", ddi: "+441111000123" },
    endpoints,
    assignments: [
      A({ id: "acc", owner_member_id: "m-alice", assignment_role: "accountable" }),
      A({ id: "h", owner_member_id: "m-bob", assignment_role: "primary_handler" }),
    ],
    handoffs: [
      {
        to_party: { kind: "person", ref: "m-carol" },
        occurred_at: new Date(T0 - HOUR).toISOString(),
        observed_state: "confirmed",
      },
    ],
    nowMs: T0,
  });
  assert.equal(r.accountable?.ref, "m-alice", "accountable unchanged by handoff");
  assert.equal(r.likelyCurrentHandler?.ref, "m-carol", "likely handler follows the handoff");
  assert.ok(r.warnings.includes("handler_from_observed_handoff"));
});

ok("email shared mailbox match by normalized value", () => {
  const r = resolveEndpointOwnership({
    evidence: { channel: "email", normalizedValue: "sales@drummonds.example" },
    endpoints,
    assignments: [
      A({
        id: "mbx",
        endpoint_id: "ep-mbx",
        owner_kind: "team",
        owner_member_id: null,
        owner_org_unit_id: "team-sales",
        assignment_role: "accountable",
      }),
    ],
    nowMs: T0,
  });
  assert.equal(r.matchStep, "normalized_value");
  assert.equal(r.teamOrRole?.ref, "team-sales");
});

ok("deterministic", () => {
  const args = {
    evidence: { channel: "phone", ddi: "+441111000123" },
    endpoints,
    assignments: [A({})],
    nowMs: T0,
  } as const;
  assert.deepEqual(resolveEndpointOwnership({ ...args }), resolveEndpointOwnership({ ...args }));
});

console.log(failed === 0 ? "\nresolver.verify: ALL PASSED" : `\nresolver.verify: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
