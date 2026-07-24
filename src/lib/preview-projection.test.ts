// Run: node --test src/lib/preview-projection.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTeamMemberPreview, type PreviewEvidence } from "./preview-projection.ts";

const NOW = "2026-07-24T18:00:00Z";
const MARY = "2d4eb9d1-0f56-472d-8657-1198e5a9d490";

const members = [
  {
    id: MARY,
    display_name: "Mary Paganga",
    formal_role: "Office",
    org_unit_id: null,
    effective_to: null,
  },
  {
    id: "other",
    display_name: "Someone",
    formal_role: null,
    org_unit_id: null,
    effective_to: null,
  },
];

function evidence(over: Partial<PreviewEvidence> = {}): PreviewEvidence {
  return { members, identities: [], ownership: [], ...over };
}

test("a member without profile_id can be previewed (keyed by team_member_id)", () => {
  const r = buildTeamMemberPreview({ tenantId: "t1", teamMemberId: MARY }, evidence(), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.projection?.user.memberId, MARY);
  assert.equal(r.projection?.readOnly, true);
  assert.equal(r.projection?.viewingAs?.kind, "team_member_preview");
});

test("unknown / cross-tenant team member is rejected", () => {
  const r = buildTeamMemberPreview(
    { tenantId: "t1", teamMemberId: "not-in-tenant" },
    evidence(),
    NOW,
  );
  assert.equal(r.ok, false);
  assert.equal(r.projection, null);
  assert.match(r.error ?? "", /not found/);
});

test("confirmed identities contribute; the same-but-unverified do NOT", () => {
  const confirmed = buildTeamMemberPreview(
    { tenantId: "t1", teamMemberId: MARY },
    evidence({
      identities: [
        {
          id: "i1",
          team_member_id: MARY,
          provider: "google_workspace",
          identity_kind: "user",
          external_ref: "mary@x",
          display: null,
          verification_state: "verified",
        },
        {
          id: "i2",
          team_member_id: MARY,
          provider: "voip",
          identity_kind: "user",
          external_ref: "103",
          display: null,
          verification_state: "verified",
        },
      ],
    }),
    NOW,
  );
  assert.ok(confirmed.confirmedSources.includes("email"));
  assert.ok(confirmed.confirmedSources.includes("telephony"));

  const unverified = buildTeamMemberPreview(
    { tenantId: "t1", teamMemberId: MARY },
    evidence({
      identities: [
        {
          id: "i1",
          team_member_id: MARY,
          provider: "google_workspace",
          identity_kind: "user",
          external_ref: "mary@x",
          display: null,
          verification_state: "unverified",
        },
        {
          id: "i2",
          team_member_id: MARY,
          provider: "voip",
          identity_kind: "user",
          external_ref: "103",
          display: null,
          verification_state: "unverified",
        },
      ],
    }),
    NOW,
  );
  assert.ok(!unverified.confirmedSources.includes("email"), "unverified email excluded");
  assert.ok(!unverified.confirmedSources.includes("telephony"), "unverified extension excluded");
});

test("ownership contributes when present", () => {
  const r = buildTeamMemberPreview(
    { tenantId: "t1", teamMemberId: MARY },
    evidence({
      ownership: [
        {
          id: "o1",
          endpoint_id: "e1",
          owner_kind: "person",
          owner_member_id: MARY,
          owner_org_unit_id: null,
          owner_role: null,
          assignment_role: "accountable",
          effective_from: NOW,
          effective_to: null,
          confidence: 0.95,
          review_state: "confirmed",
        },
      ],
    }),
    NOW,
  );
  assert.ok(r.confirmedSources.includes("ownership"));
});

test("no fabricated activity — work lists are empty and attribution is not the actor's login", () => {
  const r = buildTeamMemberPreview({ tenantId: "t1", teamMemberId: MARY }, evidence(), NOW);
  assert.deepEqual(r.projection?.doNext, []);
  assert.deepEqual(r.projection?.all, []);
  assert.equal(r.projection?.position.urgent, 0);
  // userRef is a preview-scoped ref, never the actor's profile/email.
  assert.equal(r.projection?.user.userRef, `team_member_preview:${MARY}`);
  assert.ok(!/@/.test(r.projection?.user.userRef ?? ""));
});

test("honest gaps: unconnected sources report pending / not_connected, not confirmed", () => {
  const r = buildTeamMemberPreview({ tenantId: "t1", teamMemberId: MARY }, evidence(), NOW);
  const bySource = Object.fromEntries(r.coverage.map((c) => [c.source, c.status]));
  assert.equal(bySource.commusoft, "not_connected");
  assert.equal(bySource.email, "pending");
  assert.equal(bySource.slack, "not_connected");
});
