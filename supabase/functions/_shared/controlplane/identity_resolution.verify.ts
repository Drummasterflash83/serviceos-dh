// Run: node supabase/functions/_shared/controlplane/identity_resolution.verify.ts
// Pure unit tests for provider mailbox type, operational classification, and identity
// suggestion. No DB, no network.
import assert from "node:assert/strict";
import {
  providerMailboxType,
  classifyOperational,
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

// ── provider mailbox type (raw provider fact) ────────────────────────────────
ok("provider type: user | group | alias | shared | suspended | unknown", () => {
  assert.equal(providerMailboxType({ email: "a@x.co", mailbox_type: "user" }), "user");
  assert.equal(providerMailboxType({ email: "a@x.co", mailbox_type: "group" }), "group");
  assert.equal(providerMailboxType({ email: "a@x.co", mailbox_type: "alias" }), "alias");
  assert.equal(providerMailboxType({ email: "a@x.co", mailbox_type: "shared" }), "shared");
  assert.equal(providerMailboxType({ email: "a@x.co", mailbox_type: "suspended" }), "suspended");
  assert.equal(providerMailboxType({ email: "a@x.co" }), "unknown");
});
ok("provider type: NOT inferred from local part ('marketing@' with type=user is user)", () => {
  assert.equal(providerMailboxType({ email: "marketing@x.co", mailbox_type: "user" }), "user");
  assert.equal(providerMailboxType({ email: "marketing@x.co" }), "unknown");
});

// ── operational classification (SEPARATE from provider type) ─────────────────
ok("SEMANTICS: provider user with NO review → operational UNKNOWN (never 'personal')", () => {
  const c = classifyOperational({ email: "julie@x.co", mailbox_type: "user" });
  assert.equal(c.class, "unknown");
  assert.equal(c.reviewed, false);
});
ok("operational: reviewed evidence is authoritative", () => {
  assert.equal(classifyOperational({ email: "j@x.co", mailbox_type: "user" }, "confirmed_person").class, "personal");
  assert.equal(classifyOperational({ email: "j@x.co", mailbox_type: "user" }, "shared").class, "shared");
  assert.equal(classifyOperational({ email: "j@x.co", mailbox_type: "user" }, "team").class, "team");
  assert.equal(classifyOperational({ email: "j@x.co", mailbox_type: "user" }, "system").class, "service");
  assert.equal(classifyOperational({ email: "j@x.co", mailbox_type: "user" }, "unresolved").class, "unknown");
});
ok("operational: a reviewed personal classification is flagged reviewed=true", () => {
  assert.equal(classifyOperational({ email: "j@x.co", mailbox_type: "user" }, "confirmed_person").reviewed, true);
});
ok("operational: unambiguous provider signal classifies without a review", () => {
  assert.equal(classifyOperational({ email: "accounts@x.co", mailbox_type: "shared" }).class, "shared");
  assert.equal(classifyOperational({ email: "all@x.co", mailbox_type: "group" }).class, "team");
});
ok("operational: suspended status → inactive (wins over type)", () => {
  assert.equal(
    classifyOperational({ email: "x@x.co", mailbox_type: "user", status: "suspended" }).class,
    "inactive",
  );
});

// ── suggestions never auto-confirm ──────────────────────────────────────────
ok("SAFETY: a suggestion is never 'confirmed' — first-name match is only MEDIUM", () => {
  const s = suggestIdentity({ email: "julie@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, []);
  assert.equal(s.suggested_member_id, "m-julie");
  assert.equal(s.confidence, "medium");
  assert.match(s.evidence, /first name/i);
});
ok("suggestion surfaces provider type AND operational class (unknown until reviewed)", () => {
  const s = suggestIdentity({ email: "julie@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, []);
  assert.equal(s.provider_mailbox_type, "user");
  assert.equal(s.operational_class, "unknown");
});
ok("first+last exact match → high", () => {
  const s = suggestIdentity({ email: "mary.smith@drummondheating.co.uk", mailbox_type: "user" }, MEMBERS, []);
  assert.equal(s.suggested_member_id, "m-mary");
  assert.equal(s.confidence, "high");
});
ok("STRONG: verified Workspace display name exact match → high (even for a first-name local part)", () => {
  // 'liz@' alone would be medium, but the provider display name "Liz" is authoritative.
  const s = suggestIdentity(
    { email: "liz@drummondheating.co.uk", mailbox_type: "user", display_name: "Liz" },
    MEMBERS,
    [],
  );
  assert.equal(s.suggested_member_id, "m-liz");
  assert.equal(s.confidence, "high");
  assert.match(s.provenance, /workspace-display-name/);
});
ok("SAFETY: six first-name matches stay MEDIUM, not elevated by name alone", () => {
  for (const [email, id] of [
    ["julie@d.co.uk", "m-julie"],
    ["liz@d.co.uk", "m-liz"],
  ] as const) {
    const s = suggestIdentity({ email, mailbox_type: "user" }, MEMBERS, []);
    assert.equal(s.suggested_member_id, id);
    assert.equal(s.confidence, "medium");
  }
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
  const s = suggestIdentity({ email: "tony@drummondheating.co.uk", mailbox_type: "shared" }, MEMBERS, []);
  assert.equal(s.suggested_kind, "shared");
  assert.equal(s.suggested_member_id, null);
});
ok("suspended mailbox → unresolved, review first", () => {
  const s = suggestIdentity({ email: "olduser@x.co", mailbox_type: "user", status: "suspended" }, MEMBERS, []);
  assert.equal(s.operational_class, "inactive");
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
