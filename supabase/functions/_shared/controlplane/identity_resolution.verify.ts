// Run: node supabase/functions/_shared/controlplane/identity_resolution.verify.ts
// Pure unit tests for identity classification + suggestion. No DB, no network.
import assert from "node:assert/strict";
import {
  classifyMailbox,
  suggestIdentity,
  localPart,
  nameTokens,
  type SuggestMember,
} from "./identity_resolution.ts";

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

const MEMBERS: SuggestMember[] = [
  { id: "m-julie", display_name: "Julie" },
  { id: "m-mary", display_name: "Mary Smith" },
  { id: "m-liz", display_name: "Liz" },
  { id: "m-tony", display_name: "Tony Marsh" },
  { id: "m-john1", display_name: "John Adams" },
  { id: "m-john2", display_name: "John Baker" },
];

// ── classification ──────────────────────────────────────────────────────────
ok("classify: provider mailbox_type=user → personal", () => {
  assert.equal(classifyMailbox({ email: "julie@x.co", mailbox_type: "user" }).class, "personal");
});
ok("classify: shared / group / service by provider metadata", () => {
  assert.equal(classifyMailbox({ email: "accounts@x.co", mailbox_type: "shared" }).class, "shared");
  assert.equal(classifyMailbox({ email: "all@x.co", mailbox_type: "group" }).class, "group");
  assert.equal(classifyMailbox({ email: "noreply@x.co", mailbox_type: "service" }).class, "service");
});
ok("classify: suspended status wins over type", () => {
  assert.equal(
    classifyMailbox({ email: "x@x.co", mailbox_type: "user", status: "suspended" }).class,
    "suspended",
  );
});
ok("classify: NOT from local part — 'marketing@' with type=user is personal-unknown, not service", () => {
  // We must not infer "service" from the word 'marketing'; with no provider type → unknown.
  assert.equal(classifyMailbox({ email: "marketing@x.co" }).class, "unknown");
  assert.equal(classifyMailbox({ email: "mark@x.co", mailbox_type: "user" }).class, "personal");
});

// ── suggestions never auto-confirm ──────────────────────────────────────────
ok("SAFETY: a suggestion is never 'confirmed' — first-name match is only MEDIUM", () => {
  const s = suggestIdentity({ email: "julie@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, []);
  assert.equal(s.suggested_member_id, "m-julie");
  assert.equal(s.confidence, "medium");
  assert.match(s.evidence, /first name/i);
});
ok("first+last exact match → high", () => {
  const s = suggestIdentity({ email: "mary.smith@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, []);
  assert.equal(s.suggested_member_id, "m-mary");
  assert.equal(s.confidence, "high");
});
ok("SAFETY: ambiguous first name (two Johns) → unresolved, no member", () => {
  const s = suggestIdentity({ email: "john@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, []);
  assert.equal(s.suggested_member_id, null);
  assert.equal(s.confidence, "unresolved");
  assert.equal(s.ambiguity.length, 2);
});
ok("SAFETY: shared mailbox is never attributed to an individual", () => {
  const s = suggestIdentity({ email: "accounts@drummondheating.co.uk", mailbox_type: "shared" }, MEMBERS, []);
  assert.equal(s.suggested_kind, "shared");
  assert.equal(s.suggested_member_id, null);
  assert.equal(s.confidence, "unresolved");
});
ok("SAFETY: a shared mailbox whose name looks like a person is still shared", () => {
  // 'tony@' but provider says shared → shared, not linked to Tony.
  const s = suggestIdentity({ email: "tony@drummondheating.co.uk", mailbox_type: "shared" }, MEMBERS, []);
  assert.equal(s.suggested_kind, "shared");
  assert.equal(s.suggested_member_id, null);
});
ok("suspended mailbox → unresolved, review first", () => {
  const s = suggestIdentity({ email: "olduser@x.co", mailbox_type: "user", status: "suspended" }, MEMBERS, []);
  assert.equal(s.mailbox_class, "suspended");
  assert.equal(s.suggested_member_id, null);
});
ok("no match → unresolved", () => {
  const s = suggestIdentity({ email: "zzqq@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, []);
  assert.equal(s.confidence, "unresolved");
  assert.equal(s.suggested_member_id, null);
});
ok("already-confirmed address → high, sourced from the confirmed link", () => {
  const s = suggestIdentity({ email: "liz@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, [
    { team_member_id: "m-liz", primary_login: "liz@drummondheating.co.uk" },
  ]);
  assert.equal(s.suggested_member_id, "m-liz");
  assert.equal(s.confidence, "high");
  assert.match(s.provenance, /member_integration_identities/);
});
ok("SAFETY: no fuzzy match — 'juli@' does NOT match 'Julie'", () => {
  const s = suggestIdentity({ email: "juli@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, []);
  assert.equal(s.suggested_member_id, null);
  assert.equal(s.confidence, "unresolved");
});

// ── helpers ─────────────────────────────────────────────────────────────────
ok("localPart / nameTokens", () => {
  assert.equal(localPart("Mary.Smith@X.CO"), "mary.smith");
  assert.deepEqual(nameTokens("Mary  Smith"), ["mary", "smith"]);
});

console.log(
  failed === 0
    ? "\nidentity_resolution.verify: ALL PASSED"
    : `\nidentity_resolution.verify: ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
