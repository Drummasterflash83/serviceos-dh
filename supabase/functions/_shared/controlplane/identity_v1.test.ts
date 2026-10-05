// Run: node --test supabase/functions/_shared/controlplane/identity_v1.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveMappingState,
  unifyCandidates,
  summarise,
  gatherIdentityImpact,
  classifyMailbox,
} from "./identity_v1.ts";
import { decidePlatformAccess } from "./authz.ts";

// ── Mailbox classification (WS1) — precedence: provider > confirmed > role-hint ──
test("mailbox classification precedence: provider metadata is authoritative", () => {
  const grp = classifyMailbox({ rawValue: "team@x.co", providerMailboxType: "group", isSharedEndpoint: false, confirmedPersonLink: false });
  assert.equal(grp.mailboxClass, "group");
  assert.equal(grp.authoritative, true);
  assert.equal(grp.authorMayDiffer, true);
  const usr = classifyMailbox({ rawValue: "jane@x.co", providerMailboxType: "user", isSharedEndpoint: false, confirmedPersonLink: false });
  assert.equal(usr.mailboxClass, "personal");
  assert.equal(usr.authoritative, true);
});
test("role-address hint is evidence-only, and 'user' type does NOT suppress it (role boxes are user-type)", () => {
  const hint = classifyMailbox({ rawValue: "finance@x.co", providerMailboxType: null, isSharedEndpoint: false, confirmedPersonLink: false });
  assert.equal(hint.mailboxClass, "role_hint");
  assert.equal(hint.authoritative, false); // a hint never asserts shared
  assert.equal(hint.authorMayDiffer, true);
  // Google labels role mailboxes as 'user', so 'user' is not a positive personal signal — the
  // role-name hint still applies (still non-authoritative; operator must confirm).
  const userTypeRole = classifyMailbox({ rawValue: "finance@x.co", providerMailboxType: "user", isSharedEndpoint: false, confirmedPersonLink: false });
  assert.equal(userTypeRole.mailboxClass, "role_hint");
  assert.equal(userTypeRole.authoritative, false);
  // A POSITIVE provider signal (group/shared) DOES override the hint (authoritative).
  const overridden = classifyMailbox({ rawValue: "finance@x.co", providerMailboxType: "group", isSharedEndpoint: false, confirmedPersonLink: false });
  assert.equal(overridden.mailboxClass, "group");
  assert.equal(overridden.authoritative, true);
});
test("a confirmed person link classifies personal (authoritative) over a role-name hint", () => {
  const c = classifyMailbox({ rawValue: "info@x.co", providerMailboxType: null, isSharedEndpoint: false, confirmedPersonLink: true });
  assert.equal(c.mailboxClass, "personal");
  assert.equal(c.authoritative, true);
});

const NOW_MS = Date.parse("2026-07-25T12:00:00Z");

// ── Operator-only access (authz decision — pure) ─────────────────────────────
test("operator access: active platform.controlplane grant allows; no grant denies", () => {
  const allow = decidePlatformAccess({
    role: "owner",
    profileExists: true,
    grants: [{ permission: "platform.controlplane.admin" }],
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW_MS,
  });
  assert.equal(allow.allow, true);

  const noGrant = decidePlatformAccess({
    role: "owner",
    profileExists: true,
    grants: [],
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW_MS,
  });
  assert.equal(noGrant.allow, false);

  const noProfile = decidePlatformAccess({
    role: null,
    profileExists: false,
    grants: [{ permission: "platform.controlplane.admin" }],
    requireAdmin: false,
    viewAsActive: false,
    nowMs: NOW_MS,
  });
  assert.equal(noProfile.allow, false);
});

test("confirmation write (admin) blocked while a View-As context is active", () => {
  const d = decidePlatformAccess({
    role: "owner",
    profileExists: true,
    grants: [{ permission: "platform.controlplane.admin" }],
    requireAdmin: true,
    viewAsActive: true,
    nowMs: NOW_MS,
  });
  assert.equal(d.allow, false);
});

// ── Mapping-state derivation ─────────────────────────────────────────────────
test("no auto-confirm: a suggestion never derives to 'confirmed' on its own", () => {
  assert.equal(
    deriveMappingState({
      active: true,
      hasConfirmedLink: false,
      latestDecision: null,
      suggestedMemberId: "m1",
      suggestedKind: "person",
      ambiguityCount: 0,
    }),
    "suggested",
  );
});

test("confirmed only from a verified link or an explicit confirmed_person decision", () => {
  const byLink = deriveMappingState({
    active: true,
    hasConfirmedLink: true,
    latestDecision: null,
    suggestedMemberId: "m1",
    suggestedKind: "person",
    ambiguityCount: 0,
  });
  const byDecision = deriveMappingState({
    active: true,
    hasConfirmedLink: false,
    latestDecision: "confirmed_person",
    suggestedMemberId: "m1",
    suggestedKind: "person",
    ambiguityCount: 0,
  });
  assert.equal(byLink, "confirmed");
  assert.equal(byDecision, "confirmed");
});

test("conflicting when more than one candidate member", () => {
  assert.equal(
    deriveMappingState({
      active: true,
      hasConfirmedLink: false,
      latestDecision: null,
      suggestedMemberId: null,
      suggestedKind: "none",
      ambiguityCount: 2,
    }),
    "conflicting",
  );
});

test("rejected candidate stays rejected (does not resurface as 'suggested')", () => {
  assert.equal(
    deriveMappingState({
      active: true,
      hasConfirmedLink: false,
      latestDecision: "rejected",
      suggestedMemberId: "m1",
      suggestedKind: "person",
      ambiguityCount: 0,
    }),
    "rejected",
  );
});

test("deferred and unassigned are honoured; inactive endpoint is historical", () => {
  assert.equal(
    deriveMappingState({
      active: true,
      hasConfirmedLink: false,
      latestDecision: "deferred",
      suggestedMemberId: "m1",
      suggestedKind: "person",
      ambiguityCount: 0,
    }),
    "deferred",
  );
  assert.equal(
    deriveMappingState({
      active: true,
      hasConfirmedLink: false,
      latestDecision: "unassigned",
      suggestedMemberId: null,
      suggestedKind: "none",
      ambiguityCount: 0,
    }),
    "unassigned",
  );
  assert.equal(
    deriveMappingState({
      active: false,
      hasConfirmedLink: true,
      latestDecision: "confirmed_person",
      suggestedMemberId: "m1",
      suggestedKind: "person",
      ambiguityCount: 0,
    }),
    "historical",
  );
});

// ── Unify: email personal vs shared, extension vs DDI ─────────────────────────
const members = new Map([
  ["m1", "Jane Doe"],
  ["m2", "John Roe"],
]);
function unifyFixture() {
  const endpointsById = new Map<string, Record<string, unknown>>([
    [
      "e-personal",
      {
        endpoint_kind: "email",
        provider: "google_workspace",
        is_shared: false,
        normalized_value: "jane@drummonds.co",
        status: "active",
      },
    ],
    [
      "e-shared",
      {
        endpoint_kind: "shared_mailbox",
        provider: "google_workspace",
        is_shared: true,
        normalized_value: "office@drummonds.co",
        status: "active",
      },
    ],
    [
      "e-ext",
      {
        endpoint_kind: "extension",
        provider: "sipcentric",
        is_shared: false,
        normalized_value: "201",
        status: "active",
      },
    ],
    [
      "e-ddi",
      {
        endpoint_kind: "ddi",
        provider: "sipcentric",
        is_shared: false,
        normalized_value: "+441216000000",
        status: "active",
      },
    ],
  ]);
  return unifyCandidates({
    emailRes: {
      classifications: [],
      suggestions: [
        {
          endpoint_id: "e-personal",
          endpoint_email: "jane@drummonds.co",
          provider_mailbox_type: "user",
          operational_class: "unknown",
          suggested_member_id: "m1",
          suggested_kind: "person",
          confidence: "high",
          evidence: "display name exact",
          provenance: "workspace",
          ambiguity: [],
        },
        {
          endpoint_id: "e-shared",
          endpoint_email: "office@drummonds.co",
          provider_mailbox_type: "shared",
          operational_class: "shared",
          suggested_member_id: null,
          suggested_kind: "shared",
          confidence: "unresolved",
          evidence: "provider shared mailbox",
          provenance: "workspace",
          ambiguity: [],
        },
      ],
      reviews: [],
    },
    telephony: {
      candidates: [
        {
          endpoint_id: "e-ext",
          endpoint_extension: "201",
          suggested_member_id: "m1",
          suggested_kind: "person",
          confidence: "high",
          evidence: "label names one member",
          provenance: "call activity",
          ambiguity: [],
          named_members: ["m1"],
          unknown_label_names: [],
          display_value: "Jane",
          observed_labels: ["Jane Doe"],
          call_count: 12,
          last_activity: "2026-07-24T10:00:00Z",
        },
        {
          endpoint_id: "e-ddi",
          endpoint_extension: "+441216000000",
          suggested_member_id: "m2",
          suggested_kind: "person",
          confidence: "medium",
          evidence: "one member + stray name",
          provenance: "call activity",
          ambiguity: [],
          named_members: ["m2"],
          unknown_label_names: ["Reception"],
          display_value: "Main line",
          observed_labels: ["John Roe", "Reception"],
          call_count: 40,
          last_activity: "2026-07-24T16:00:00Z",
        },
      ],
    },
    endpointsById,
    membersById: members,
    confirmedEndpointIds: new Set(),
    mailboxTypeByValue: new Map([
      ["jane@drummonds.co", "user"],
      ["office@drummonds.co", "shared"],
    ]),
  });
}

test("email: personal address vs shared mailbox are distinguished (shared never an individual)", () => {
  const c = unifyFixture();
  const personal = c.find((x) => x.key === "e-personal")!;
  const shared = c.find((x) => x.key === "e-shared")!;
  assert.equal(personal.candidateKind, "email_address");
  assert.equal(personal.isShared, false);
  assert.equal(personal.mailboxClass, "personal"); // provider:user → authoritative personal
  assert.equal(personal.authoritative, true);
  assert.equal(personal.authorMayDiffer, false);
  assert.equal(personal.suggestedMemberName, "Jane Doe");
  assert.equal(personal.mappingState, "suggested");
  assert.equal(shared.candidateKind, "mailbox");
  assert.equal(shared.isShared, true);
  assert.equal(shared.mailboxClass, "shared"); // provider:shared → authoritative
  assert.equal(shared.authorMayDiffer, true); // author may differ from mailbox owner
  assert.equal(shared.suggestedKind, "shared");
  assert.equal(shared.suggestedMemberId, null); // never assigned to one person
  assert.equal(shared.mappingState, "shared");
});

test("telephony: extension and DDI are separate candidates and can map to different people", () => {
  const c = unifyFixture();
  const ext = c.find((x) => x.key === "e-ext")!;
  const ddi = c.find((x) => x.key === "e-ddi")!;
  assert.equal(ext.candidateKind, "extension");
  assert.equal(ddi.candidateKind, "ddi");
  assert.notEqual(ext.suggestedMemberId, ddi.suggestedMemberId); // m1 vs m2
  assert.equal(ext.activityCount, 12);
  assert.equal(ddi.lastObservedAt, "2026-07-24T16:00:00Z");
  // provider labels appear as evidence only, never as an inferred answered-by identity
  assert.ok(ext.supportingEvidence.some((e) => /label:/.test(e)));
  assert.ok(ddi.conflictingEvidence.some((e) => /unrecognised label/i.test(e)));
});

test("summary counts by state and channel", () => {
  const s = summarise(unifyFixture());
  assert.equal(s.total, 4);
  assert.equal(s.byChannel.email, 2);
  assert.equal(s.byChannel.phone, 2);
  assert.equal(s.confirmed, 0);
});

// ── Impact preview (read-only) with a chainable Supabase mock ────────────────
function mockDb(tables: Record<string, unknown[]>, seen: string[]) {
  const make = (table: string) => {
    const rows = tables[table] ?? [];
    const b: Record<string, unknown> = {};
    const result = { data: rows, error: null };
    b.select = () => b;
    b.eq = (col: string, val: string) => {
      if (col === "tenant_id") seen.push(val);
      return b;
    };
    b.or = () => b;
    b.overlaps = () => b;
    b.is = () => b;
    b.limit = () => Promise.resolve(result);
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.then = (r: (x: typeof result) => void) => r(result);
    return b;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => make(t) } as any;
}

test("impact preview: X interactions, Y intelligence objects, Z unresolved actions (tenant-scoped)", async () => {
  const seen: string[] = [];
  const db = mockDb(
    {
      communication_endpoints: [
        { id: "e1", channel: "email", normalized_value: "jane@drummonds.co" },
      ],
      interactions: [{ id: "i1" }, { id: "i2" }, { id: "i3" }],
      intelligence_objects: [
        { id: "o1", object_type: "Action", accountable_ref: null },
        { id: "o2", object_type: "Action", accountable_ref: { kind: "person", ref: "m1" } },
        { id: "o3", object_type: "Observation", accountable_ref: null },
      ],
    },
    seen,
  );
  const imp = await gatherIdentityImpact(db, "tenant-1", "e1");
  assert.equal(imp.interactions, 3);
  assert.equal(imp.intelligenceObjects, 3);
  assert.equal(imp.unresolvedActions, 1); // only the Action with null accountable_ref
  assert.ok(imp.sampleInteractionIds.length <= 5);
  assert.ok(seen.length >= 3 && seen.every((t) => t === "tenant-1"));
});

test("impact preview: telephony channel is honest about missing linkage (no fabrication)", async () => {
  const seen: string[] = [];
  const db = mockDb(
    { communication_endpoints: [{ id: "e2", channel: "phone", normalized_value: "201" }] },
    seen,
  );
  const imp = await gatherIdentityImpact(db, "tenant-1", "e2");
  assert.equal(imp.interactions, 0);
  assert.ok(imp.note && /not yet derivable/i.test(imp.note));
});
