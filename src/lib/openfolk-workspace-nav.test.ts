/**
 * Regression tests for the OpenFolk tenant-workspace navigation logic.
 * Run: node --test src/lib/openfolk-workspace-nav.test.ts
 *
 * These cover the DURABLE-STATE rules behind the ownership-confirmation navigation fix:
 * section persistence (URL round-trips + fail-safe), and the ownership role advance/
 * completeness that keeps the operator on the same endpoint moving to the next role
 * instead of resetting to Overview. DOM-interaction assertions (render/click/scroll)
 * are covered by the live browser verification against /demo/openfolk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OWNERSHIP_ROLES,
  isOwnershipComplete,
  nextMissingRole,
  resolveSection,
  sectionSearchValue,
} from "./openfolk-workspace-nav.ts";

// ── Section persistence (test 12: refreshing ?section=ownership returns to Ownership) ──
test("resolveSection keeps a valid section across a refresh", () => {
  assert.equal(resolveSection("ownership"), "ownership");
  assert.equal(resolveSection("review"), "review");
  assert.equal(resolveSection("audit"), "audit");
});

test("resolveSection fails safely to overview for absent/invalid values", () => {
  assert.equal(resolveSection(undefined), "overview");
  assert.equal(resolveSection(null), "overview");
  assert.equal(resolveSection(""), "overview");
  assert.equal(resolveSection("Ownership"), "overview"); // case-sensitive, unknown key
  assert.equal(resolveSection("../etc/passwd"), "overview");
  assert.equal(resolveSection(42), "overview");
  assert.equal(resolveSection({ section: "ownership" }), "overview");
});

test("sectionSearchValue omits the default so the URL stays clean, but preserves others", () => {
  assert.equal(sectionSearchValue("overview"), undefined);
  assert.equal(sectionSearchValue("bogus"), undefined); // invalid collapses to the omitted default
  assert.equal(sectionSearchValue("ownership"), "ownership");
});

// ── Ownership role advance (tests 3-9: never returns to Overview; advances role-by-role) ──
test("nextMissingRole walks canonical order from empty", () => {
  assert.equal(nextMissingRole([]), "accountable");
});

test("confirming Accountable advances focus to Primary Handler (optimistic)", () => {
  // pre-refresh assignments are still empty; justAssigned reflects the click
  assert.equal(nextMissingRole([], "accountable"), "primary_handler");
});

test("advance walks the full sequence accountable → primary_handler → cover → escalation", () => {
  assert.equal(nextMissingRole(["accountable"], "primary_handler"), "cover");
  assert.equal(nextMissingRole(["accountable", "primary_handler"], "cover"), "escalation");
});

test("after the fourth role there is no next role (endpoint complete)", () => {
  assert.equal(nextMissingRole(["accountable", "primary_handler", "cover"], "escalation"), null);
});

test("nextMissingRole skips roles already held regardless of confirm order", () => {
  // e.g. operator filled cover first; next missing is still accountable
  assert.equal(nextMissingRole(["cover"]), "accountable");
  assert.equal(nextMissingRole(["accountable", "cover"], "escalation"), "primary_handler");
});

// ── No duplicate assignment (test 10) ──
test("re-confirming an already-held role creates no duplicate step and yields the true next gap", () => {
  // justAssigned duplicates an existing role → set is idempotent, advance is unaffected
  const assigned = ["accountable", "primary_handler"];
  assert.equal(nextMissingRole(assigned, "accountable"), "cover");
});

// ── Completeness (tests 8-9) ──
test("isOwnershipComplete only when all four governed roles are present", () => {
  assert.equal(isOwnershipComplete([]), false);
  assert.equal(isOwnershipComplete(["accountable", "primary_handler", "cover"]), false);
  assert.equal(isOwnershipComplete([...OWNERSHIP_ROLES]), true);
  // extra/unknown roles do not break completeness
  assert.equal(isOwnershipComplete([...OWNERSHIP_ROLES, "observer"]), true);
});
