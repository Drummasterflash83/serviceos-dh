/**
 * Marketing permission resolution — unit tests (pure logic, no I/O).
 * Run: node --test src/lib/marketing/permissions.test.ts
 *
 * Mirrors the server-side resolver in supabase/functions/marketing-access.
 * Proves: role defaults (owner/admin full; ops working subset without launch/
 * senders/ads/access-manage; viewer nothing), grant additions, explicit deny
 * overrides, and unknown-permission rejection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MARKETING_PERMISSIONS,
  ROLE_DEFAULTS,
  resolveMarketingPermissions,
  hasMarketingPermission,
} from "./permissions.ts";

test("owner and admin get the full permission set by default", () => {
  for (const role of ["owner", "admin"] as const) {
    const resolved = resolveMarketingPermissions(role);
    assert.equal(resolved.length, MARKETING_PERMISSIONS.length, `${role} full set`);
    assert.ok(hasMarketingPermission(resolved, "marketing.access.manage"));
    assert.ok(hasMarketingPermission(resolved, "marketing.campaigns.launch"));
  }
});

test("ops gets the working subset — no launch, senders, ads or access management", () => {
  const resolved = resolveMarketingPermissions("ops");
  assert.ok(hasMarketingPermission(resolved, "marketing.view"));
  assert.ok(hasMarketingPermission(resolved, "marketing.contacts.manage"));
  assert.ok(hasMarketingPermission(resolved, "marketing.contacts.import"));
  assert.ok(hasMarketingPermission(resolved, "marketing.campaigns.draft"));
  assert.ok(hasMarketingPermission(resolved, "marketing.campaigns.test"));
  assert.ok(!hasMarketingPermission(resolved, "marketing.campaigns.launch"), "ops cannot launch");
  assert.ok(!hasMarketingPermission(resolved, "marketing.senders.manage"), "ops no senders");
  assert.ok(!hasMarketingPermission(resolved, "marketing.ads.manage"), "ops no ads");
  assert.ok(!hasMarketingPermission(resolved, "marketing.access.manage"), "ops no access mgmt");
});

test("viewer has nothing until explicitly granted", () => {
  assert.deepEqual(resolveMarketingPermissions("viewer"), []);
  const granted = resolveMarketingPermissions("viewer", [
    { permission: "marketing.view", granted: true },
    { permission: "marketing.reporting.view", granted: true },
  ]);
  assert.deepEqual(granted, ["marketing.reporting.view", "marketing.view"]);
});

test("explicit deny override removes a role default (admin denied launch)", () => {
  const resolved = resolveMarketingPermissions("admin", [
    { permission: "marketing.campaigns.launch", granted: false },
  ]);
  assert.ok(!hasMarketingPermission(resolved, "marketing.campaigns.launch"));
  assert.ok(hasMarketingPermission(resolved, "marketing.view"), "other defaults intact");
});

test("unknown permission names in overrides are ignored (no privilege injection)", () => {
  const resolved = resolveMarketingPermissions("viewer", [
    { permission: "marketing.everything", granted: true },
    { permission: "platform.controlplane.admin", granted: true },
  ]);
  assert.deepEqual(resolved, []);
});

test("role defaults are internally consistent with the vocabulary", () => {
  for (const [role, defaults] of Object.entries(ROLE_DEFAULTS)) {
    for (const p of defaults) {
      assert.ok(
        (MARKETING_PERMISSIONS as readonly string[]).includes(p),
        `${role} default ${p} must be in the vocabulary`,
      );
    }
  }
});
