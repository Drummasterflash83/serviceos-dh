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
  evaluateConcentration,
  isOwnershipComplete,
  nextMissingRole,
  resolveSection,
  sectionSearchValue,
} from "./openfolk-workspace-nav.ts";

const A = "member-a";
const B = "member-b";
const C = "member-c";
const D = "member-d";

// ── Section persistence (test 12: refreshing ?section=ownership returns to Ownership) ──
test("resolveSection keeps a valid section across a refresh", () => {
  assert.equal(resolveSection("ownership"), "ownership");
  assert.equal(resolveSection("connections"), "connections");
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

test("new managed-service sections resolve directly", () => {
  for (const s of [
    "company",
    "connections",
    "communications",
    "agents",
    "automations",
    "health",
    "security",
  ])
    assert.equal(resolveSection(s), s);
});

test("legacy section URLs re-home to their new section (no broken bookmarks)", () => {
  assert.equal(resolveSection("email"), "communications");
  assert.equal(resolveSection("phone"), "communications");
  assert.equal(resolveSection("slack"), "communications");
  assert.equal(resolveSection("review"), "people");
  // and writing back normalises the legacy value to its canonical section
  assert.equal(sectionSearchValue("email"), "communications");
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

// ── Concentration semantics (separation of duties) ──
test("accountable + primary_handler (same person) does NOT warn — the Heidi case", () => {
  const f = evaluateConcentration({ accountable: A, primary_handler: A });
  assert.deepEqual(f, []);
});

test("accountable + primary + escalation held by one person warns", () => {
  const f = evaluateConcentration({ accountable: A, primary_handler: A, escalation: A });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "warning");
  assert.equal(f[0].code, "holds_three_roles");
  assert.equal(f[0].member_id, A);
});

test("primary_handler == cover warns (no handling fallback)", () => {
  const f = evaluateConcentration({ accountable: A, primary_handler: B, cover: B, escalation: C });
  assert.ok(f.some((x) => x.code === "primary_equals_cover" && x.member_id === B));
});

test("cover == escalation warns (no independent escalation fallback)", () => {
  const f = evaluateConcentration({ accountable: A, primary_handler: B, cover: C, escalation: C });
  assert.ok(f.some((x) => x.code === "cover_equals_escalation" && x.member_id === C));
});

test("all four roles one person → single critical finding, no redundant pair noise", () => {
  const f = evaluateConcentration({
    accountable: A,
    primary_handler: A,
    cover: A,
    escalation: A,
  });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "critical");
  assert.equal(f[0].code, "single_person_all");
  assert.equal(f[0].roles.length, 4);
});

test("separate primary, cover and escalation → no warning", () => {
  const f = evaluateConcentration({
    accountable: A,
    primary_handler: B,
    cover: C,
    escalation: D,
  });
  assert.deepEqual(f, []);
});

test("team-owned / unassigned roles (null) never count toward concentration", () => {
  // accountable is a team (null owner), only primary+cover assigned to one person → still
  // catches primary==cover but the null role is ignored.
  const f = evaluateConcentration({ accountable: null, primary_handler: A, cover: A });
  assert.ok(f.some((x) => x.code === "primary_equals_cover"));
  assert.ok(!f.some((x) => x.code === "single_person_all"));
});

test("explicit stricter policy threshold flags a 2-role holder", () => {
  const f = evaluateConcentration(
    { accountable: A, primary_handler: A, cover: B, escalation: C },
    { maxRolesPerPerson: 1 },
  );
  assert.ok(f.some((x) => x.code === "threshold_exceeded" && x.member_id === A));
});
