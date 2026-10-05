/**
 * /marketing access-gate derivation proofs.
 * Run: node --test src/lib/marketing/gate.test.ts
 *
 * The corrected contract: disabling Marketing must NOT remove the governed
 * re-enable path — an owner/admin seeing the server's explicit
 * reason='not_enabled' gets the recovery state; ops/viewer do not; ordinary
 * missing permission stays "Requires permission"; an unreachable server stays
 * an error, never a permission verdict.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { deriveMarketingGate } from "./gate.ts";

test("loading until the server has answered", () => {
  assert.deepEqual(deriveMarketingGate(true, null, null), { kind: "loading" });
  assert.deepEqual(deriveMarketingGate(false, null, null), { kind: "loading" });
});

test("an unreachable server is an ERROR, never a permission verdict", () => {
  assert.deepEqual(deriveMarketingGate(false, "network down", null), {
    kind: "error",
    message: "network down",
  });
});

test("disabled + owner/admin role → governed re-enable recovery state", () => {
  for (const role of ["owner", "admin"]) {
    assert.deepEqual(
      deriveMarketingGate(false, null, { can_view: false, reason: "not_enabled", role }),
      { kind: "disabled_admin" },
    );
  }
});

test("disabled + ops/viewer role → disabled, NO administration path", () => {
  for (const role of ["ops", "viewer", undefined]) {
    assert.deepEqual(
      deriveMarketingGate(false, null, { can_view: false, reason: "not_enabled", role }),
      { kind: "disabled" },
    );
  }
});

test("enabled but no marketing.view → Requires permission (any role)", () => {
  for (const role of ["owner", "admin", "ops", "viewer"]) {
    assert.deepEqual(
      deriveMarketingGate(false, null, { can_view: false, reason: "no_permission", role }),
      { kind: "denied" },
    );
  }
});

test("granted view → ok", () => {
  assert.deepEqual(deriveMarketingGate(false, null, { can_view: true }), { kind: "ok" });
});
