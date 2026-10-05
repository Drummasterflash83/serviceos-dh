// Run: node --test supabase/functions/_shared/controlplane/slack_identity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSlackUser, type RawSlackUser } from "../slack/slack_users.ts";
import { suggestSlackIdentity, buildSlackCandidates, canDiscoverSlack } from "./slack_identity.ts";

const MEMBERS = [
  { id: "mary", display_name: "Mary Paganga" },
  { id: "liz", display_name: "Liz Turner" },
  { id: "julie", display_name: "Julie Sands" },
  { id: "julie2", display_name: "Julie Roberts" }, // duplicate first name
];
const EMAILS = [{ team_member_id: "mary", email: "mary@drummondheating.co.uk" }];

function raw(over: Partial<RawSlackUser> & { profile?: RawSlackUser["profile"] }): RawSlackUser {
  return { id: "U001", team_id: "T1", ...over };
}
const norm = (r: RawSlackUser) => normalizeSlackUser(r)!;

test("1. exact verified-email match → high, still reviewable, never auto-confirmed", () => {
  const s = suggestSlackIdentity(
    norm(raw({ profile: { email: "Mary@drummondheating.co.uk", real_name: "M P" } })),
    MEMBERS,
    { memberEmails: EMAILS },
  );
  assert.equal(s.suggested_member_id, "mary");
  assert.equal(s.confidence, "high");
  assert.equal(s.matched_by, "verified_email");
});

test("2. name-only match (no email) → resolves by full name", () => {
  const s = suggestSlackIdentity(norm(raw({ profile: { real_name: "Mary Paganga" } })), MEMBERS, {
    memberEmails: EMAILS,
  });
  assert.equal(s.suggested_member_id, "mary");
  assert.equal(s.matched_by, "full_name");
  assert.equal(s.email, undefined); // (suggestion has no email field; see candidate for that)
});

test("3. ambiguous duplicate first names → unresolved + ambiguity", () => {
  const s = suggestSlackIdentity(norm(raw({ profile: { display_name: "Julie" } })), MEMBERS);
  assert.equal(s.confidence, "unresolved");
  assert.equal(s.suggested_member_id, null);
  assert.deepEqual(new Set(s.ambiguity), new Set(["julie", "julie2"]));
});

test("4. deactivated user still matches but is flagged for review", () => {
  const s = suggestSlackIdentity(
    norm(raw({ deleted: true, profile: { real_name: "Mary Paganga" } })),
    MEMBERS,
  );
  assert.equal(s.suggested_member_id, "mary");
  assert.equal(s.deactivated, true);
  assert.match(s.evidence, /deactivated/);
});

test("5. bot / app / Slackbot are never suggested as people", () => {
  for (const u of [
    raw({ is_bot: true, profile: { real_name: "Mary Paganga" } }),
    raw({ is_app_user: true, profile: { real_name: "Mary Paganga" } }),
    raw({ id: "USLACKBOT", profile: { real_name: "Slackbot" } }),
  ]) {
    const s = suggestSlackIdentity(norm(u), MEMBERS, { memberEmails: EMAILS });
    assert.equal(s.suggested_kind, "system");
    assert.equal(s.suggested_member_id, null);
  }
});

test("6. Slack user with no email falls back to name (no crash)", () => {
  const s = suggestSlackIdentity(norm(raw({ profile: { real_name: "Liz Turner" } })), MEMBERS, {
    memberEmails: EMAILS,
  });
  assert.equal(s.suggested_member_id, "liz");
  assert.equal(s.matched_by, "full_name");
});

test("7. already-confirmed link → high, provenance member_integration_identities", () => {
  const s = suggestSlackIdentity(
    norm(raw({ id: "U777", profile: { real_name: "Someone Else" } })),
    MEMBERS,
    { confirmedSlack: [{ team_member_id: "mary", slack_user_id: "U777" }] },
  );
  assert.equal(s.suggested_member_id, "mary");
  assert.equal(s.confidence, "high");
  assert.equal(s.provenance, "member_integration_identities");
});

test("8. revoked / absent / not-ready connection → discovery fails closed", () => {
  assert.equal(canDiscoverSlack(null).ok, false);
  assert.equal(
    canDiscoverSlack({ status: "connected", revoked_at: "2026-07-24T00:00:00Z" }).ok,
    false,
  );
  assert.equal(canDiscoverSlack({ status: "not_configured", revoked_at: null }).ok, false);
  assert.equal(canDiscoverSlack({ status: "configured", revoked_at: null }).ok, true);
});

test("9. cross-tenant isolation — a name matching only a foreign member does not resolve", () => {
  // "Bob Foreign" belongs to another tenant, so is NOT in this tenant's members list.
  const s = suggestSlackIdentity(norm(raw({ profile: { real_name: "Bob Foreign" } })), MEMBERS);
  assert.equal(s.suggested_member_id, null);
  assert.equal(s.confidence, "unresolved");
});

test("buildSlackCandidates: people suggested, bots classified-not-suggested, all surfaced", () => {
  const users = [
    norm(raw({ id: "U1", profile: { email: "mary@drummondheating.co.uk", real_name: "M" } })),
    norm(raw({ id: "U2", is_bot: true, profile: { real_name: "Deploy Bot" } })),
    norm(raw({ id: "U3", profile: { display_name: "Julie" } })),
  ];
  const cands = buildSlackCandidates(users, MEMBERS, { memberEmails: EMAILS });
  assert.equal(cands.length, 3); // every user surfaced (nothing silently dropped)
  assert.equal(cands.find((c) => c.slack_user_id === "U1")?.suggested_member_id, "mary");
  assert.equal(cands.find((c) => c.slack_user_id === "U2")?.suggested_kind, "system");
  assert.equal(cands.find((c) => c.slack_user_id === "U3")?.confidence, "unresolved");
});
