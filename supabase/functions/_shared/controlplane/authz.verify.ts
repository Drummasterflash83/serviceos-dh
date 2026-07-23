// Run: node supabase/functions/_shared/controlplane/authz.verify.ts
// Pure unit tests for the platform-operator access decision. No DB, no network.
//
// MODEL (since 20260822120000_platform_authority_decoupled_from_role):
//   platform access = authenticated + EXISTING PROFILE + ACTIVE platform.controlplane
//   grant (admin implies view). `profiles.role` is tenant-facing ONLY and never decides
//   platform access — so a tenant `owner` can be a platform operator without
//   surrendering their tenant role.
import assert from "node:assert/strict";
import { decidePlatformAccess } from "./authz.ts";

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
const NOW = Date.parse("2026-07-23T12:00:00Z");
const HOUR = 3_600_000;
const activeView = [
  { permission: "platform.controlplane.view", effective_from: new Date(NOW - HOUR).toISOString() },
];
const activeAdmin = [
  { permission: "platform.controlplane.admin", effective_from: new Date(NOW - HOUR).toISOString() },
];
const expiredAdmin = [
  {
    permission: "platform.controlplane.admin",
    effective_from: new Date(NOW - 10 * HOUR).toISOString(),
    effective_to: new Date(NOW - HOUR).toISOString(),
  },
];
const futureAdmin = [
  { permission: "platform.controlplane.admin", effective_from: new Date(NOW + HOUR).toISOString() },
];

type Input = Parameters<typeof decidePlatformAccess>[0];
const decide = (o: Partial<Input>) =>
  decidePlatformAccess({
    role: "owner",
    profileExists: true,
    grants: [],
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW,
    ...o,
  });

// ── Regression suite for the authority-model correction. ────────────────────
ok("REGRESSION: tenant owner WITHOUT a platform grant is denied", () => {
  const d = decide({ role: "owner", grants: [] });
  assert.equal(d.allow, false);
  assert.equal((d as { code: string }).code, "forbidden");
});
ok("REGRESSION: tenant superadmin WITHOUT a platform grant is denied", () => {
  // tenant.superadmin is a TENANT grant; it must never satisfy the platform gate.
  const d = decide({ role: "owner", grants: [{ permission: "tenant.superadmin" }] });
  assert.equal(d.allow, false);
});
ok("REGRESSION: tenant owner WITH an active platform grant IS allowed (bootstrap case)", () => {
  const read = decide({ role: "owner", grants: activeAdmin, requireAdmin: false });
  const write = decide({ role: "owner", grants: activeAdmin, requireAdmin: true });
  assert.equal(read.allow, true);
  assert.equal(write.allow, true);
});
ok("REGRESSION: expired grant fails closed", () => {
  assert.equal(decide({ role: "owner", grants: expiredAdmin }).allow, false);
});
ok("REGRESSION: revoked (effective_to in the past) grant fails closed", () => {
  const revoked = [
    {
      permission: "platform.controlplane.admin",
      effective_from: new Date(NOW - 5 * HOUR).toISOString(),
      effective_to: new Date(NOW - 1).toISOString(),
    },
  ];
  assert.equal(decide({ role: "owner", grants: revoked }).allow, false);
});
ok("REGRESSION: ordinary tenant roles denied without a grant", () => {
  for (const role of ["admin", "ops", "viewer"]) {
    assert.equal(decide({ role, grants: [] }).allow, false, `${role} must be denied`);
  }
});
ok("REGRESSION: role is irrelevant — same grant yields the same decision for every role", () => {
  for (const role of ["owner", "admin", "ops", "viewer", "openfolk"]) {
    assert.equal(decide({ role, grants: activeAdmin }).allow, true, `${role} + grant must allow`);
    assert.equal(decide({ role, grants: [] }).allow, false, `${role} without grant must deny`);
  }
});
ok("no profile denied even with an active grant", () => {
  const d = decide({ profileExists: false, grants: activeAdmin });
  assert.equal(d.allow, false);
  assert.equal((d as { code: string }).code, "forbidden");
});

// ── Behavioural invariants (unchanged by the correction). ───────────────────
ok("VIEWER grant may read", () => {
  assert.equal(decide({ grants: activeView }).allow, true);
});
ok("VIEWER grant may NOT write", () => {
  const d = decide({ grants: activeView, requireAdmin: true });
  assert.equal(d.allow, false);
  assert.equal((d as { code: string }).code, "forbidden");
});
ok("ADMIN grant may write (admin implies view)", () => {
  assert.equal(decide({ grants: activeAdmin, requireAdmin: true }).allow, true);
  assert.equal(decide({ grants: activeAdmin, requireAdmin: false }).allow, true);
});
ok("ADMIN with active View-As may NOT write (409)", () => {
  const d = decide({ grants: activeAdmin, requireAdmin: true, viewAsActive: true });
  assert.equal(d.allow, false);
  assert.equal((d as { code: string }).code, "read_only_view_active");
  assert.equal((d as { httpStatus: number }).httpStatus, 409);
});
ok("ADMIN with active View-As MAY still read", () => {
  assert.equal(decide({ grants: activeAdmin, viewAsActive: true }).allow, true);
});
ok("future-dated grant not yet active", () => {
  assert.equal(decide({ grants: futureAdmin }).allow, false);
});

console.log(failed === 0 ? "\nauthz.verify: ALL PASSED" : `\nauthz.verify: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
