// Run: node supabase/functions/_shared/controlplane/authz.verify.ts
// Pure unit tests for the platform-operator access decision. No DB, no network.
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

ok("non-openfolk role denied even with a grant", () => {
  const d = decidePlatformAccess({
    role: "owner",
    grants: activeAdmin,
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW,
  });
  assert.equal(d.allow, false);
});
ok("openfolk without grant denied", () => {
  const d = decidePlatformAccess({
    role: "openfolk",
    grants: [],
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW,
  });
  assert.equal(d.allow, false);
});
ok("openfolk VIEWER may read", () => {
  const d = decidePlatformAccess({
    role: "openfolk",
    grants: activeView,
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW,
  });
  assert.equal(d.allow, true);
});
ok("openfolk VIEWER may NOT write", () => {
  const d = decidePlatformAccess({
    role: "openfolk",
    grants: activeView,
    requireAdmin: true,
    viewAsActive: false,
    nowMs: NOW,
  });
  assert.equal(d.allow, false);
  assert.equal((d as { code: string }).code, "forbidden");
});
ok("openfolk ADMIN may write (admin implies view)", () => {
  const w = decidePlatformAccess({
    role: "openfolk",
    grants: activeAdmin,
    requireAdmin: true,
    viewAsActive: false,
    nowMs: NOW,
  });
  const r = decidePlatformAccess({
    role: "openfolk",
    grants: activeAdmin,
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW,
  });
  assert.equal(w.allow, true);
  assert.equal(r.allow, true);
});
ok("ADMIN with active View-As may NOT write (409)", () => {
  const d = decidePlatformAccess({
    role: "openfolk",
    grants: activeAdmin,
    requireAdmin: true,
    viewAsActive: true,
    nowMs: NOW,
  });
  assert.equal(d.allow, false);
  assert.equal((d as { code: string }).code, "read_only_view_active");
  assert.equal((d as { httpStatus: number }).httpStatus, 409);
});
ok("ADMIN with active View-As MAY still read", () => {
  const d = decidePlatformAccess({
    role: "openfolk",
    grants: activeAdmin,
    requireAdmin: false,
    viewAsActive: true,
    nowMs: NOW,
  });
  assert.equal(d.allow, true);
});
ok("expired grant denied", () => {
  const expired = [
    {
      permission: "platform.controlplane.admin",
      effective_from: new Date(NOW - 10 * HOUR).toISOString(),
      effective_to: new Date(NOW - HOUR).toISOString(),
    },
  ];
  const d = decidePlatformAccess({
    role: "openfolk",
    grants: expired,
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW,
  });
  assert.equal(d.allow, false);
});
ok("future-dated grant not yet active", () => {
  const future = [
    {
      permission: "platform.controlplane.admin",
      effective_from: new Date(NOW + HOUR).toISOString(),
    },
  ];
  const d = decidePlatformAccess({
    role: "openfolk",
    grants: future,
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW,
  });
  assert.equal(d.allow, false);
});

console.log(failed === 0 ? "\nauthz.verify: ALL PASSED" : `\nauthz.verify: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
