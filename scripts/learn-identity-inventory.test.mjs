import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./verify/operator-inventory-fixture.mjs";
import {
  loadIdentityInventory,
  buildEmailIdentityResolution,
  buildPhoneIdentityResolution,
} from "../supabase/functions/_shared/controlplane/identity_inventory.ts";
import { suggestIdentity } from "../supabase/functions/_shared/controlplane/identity_resolution.ts";
import { suggestTelephonyIdentity } from "../supabase/functions/_shared/controlplane/telephony_identity.ts";
const tenant = "10000000-0000-4000-8000-000000000001",
  foreign = "20000000-0000-4000-8000-000000000001";
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-11T00:00:00Z");
const row = (n, fields = {}) => ({
  id: id(n),
  tenant_id: tenant,
  effective_from: "2026-01-01T00:00:00Z",
  effective_to: null,
  ...fields,
});
function fixture() {
  return {
    team_members: [row(1, { display_name: "Alice Jones" }), row(2, { display_name: "Bob Smith" })],
    communication_endpoints: [
      row(11, {
        channel: "email",
        endpoint_kind: "email",
        normalized_value: "opaque@example.invalid",
        provider: "google_workspace",
        provider_external_ref: id(41),
        status: "active",
      }),
      row(12, {
        channel: "phone",
        endpoint_kind: "extension",
        normalized_value: "101",
        provider: "sipcentric",
        status: "active",
        metadata: { observed_labels: [], call_count: 3 },
      }),
    ],
    member_integration_identities: [
      row(21, {
        team_member_id: id(1),
        provider: "slack",
        identity_kind: "user",
        primary_login: "opaque@example.invalid",
        external_ref: "U123",
        verification_state: "verified",
      }),
      row(22, {
        team_member_id: id(2),
        provider: "simwood",
        identity_kind: "user",
        external_ref: "101",
        verification_state: "verified",
      }),
    ],
    google_workspace_mailboxes: [
      row(41, {
        email_address: "opaque@example.invalid",
        mailbox_type: "user",
        status: "active",
        display_name: null,
      }),
    ],
    endpoint_identity_reviews: [],
  };
}
async function read(f = fixture(), cap = 2) {
  return loadIdentityInventory(database(f, undefined, cap), tenant, now);
}
test("email and same-number extension links require the endpoint provider, never just a matching login/ref", async () => {
  const h = await read();
  assert.equal(buildEmailIdentityResolution(h).suggestions[0].suggested_member_id, null);
  assert.equal(buildPhoneIdentityResolution(h).candidates[0].suggested_member_id, null);
  const f = fixture();
  f.member_integration_identities[0].provider = "google_workspace";
  f.member_integration_identities[1].provider = "sipcentric";
  const exact = await read(f);
  assert.equal(buildEmailIdentityResolution(exact).suggestions[0].suggested_member_id, id(1));
  assert.equal(buildPhoneIdentityResolution(exact).candidates[0].suggested_member_id, id(2));
});
test("ended/future links and inactive people cannot contribute confirmed suggestions", async () => {
  const f = fixture();
  f.member_integration_identities[0].provider = "google_workspace";
  f.member_integration_identities[1].provider = "sipcentric";
  for (const [table, index, change] of [
    ["member_integration_identities", 0, { effective_to: "2026-10-11T00:00:00Z" }],
    ["member_integration_identities", 0, { effective_from: "2027-01-01T00:00:00Z" }],
    ["team_members", 0, { effective_to: "2026-09-01T00:00:00Z" }],
  ]) {
    const copy = structuredClone(f);
    Object.assign(copy[table][index], change);
    assert.equal(
      buildEmailIdentityResolution(await read(copy)).suggestions[0].suggested_member_id,
      null,
    );
  }
});
test("provider mailbox metadata stays on its own endpoint and ambiguous duplicate mailboxes remain unresolved", async () => {
  const f = fixture();
  f.google_workspace_mailboxes[0].display_name = "Alice Jones";
  f.communication_endpoints[0].provider = "microsoft365";
  assert.equal(
    buildEmailIdentityResolution(await read(f)).suggestions[0].suggested_member_id,
    null,
  );
  f.communication_endpoints[0].provider = "google_workspace";
  f.communication_endpoints[0].provider_external_ref = null;
  f.google_workspace_mailboxes.push({
    ...f.google_workspace_mailboxes[0],
    id: id(42),
    display_name: "Bob Smith",
  });
  const s = buildEmailIdentityResolution(await read(f)).suggestions[0];
  assert.equal(s.suggested_member_id, null);
  assert.match(s.evidence, /Multiple provider mailbox/);
});
test("shared/suspended provider evidence wins over a stored personal link; conflicts never use a first-row winner", async () => {
  const members = [
    { id: id(1), display_name: "Alice Jones" },
    { id: id(2), display_name: "Bob Smith" },
  ];
  const confirmed = members.map((m) => ({
    team_member_id: m.id,
    external_ref: "a@example.invalid",
    primary_login: "a@example.invalid",
  }));
  const s = suggestIdentity({ email: "a@example.invalid" }, members, confirmed);
  assert.equal(s.suggested_member_id, null);
  assert.equal(s.ambiguity.length, 2);
  for (const meta of [
    { mailbox_type: "shared" },
    { status: "suspended" },
    { mailbox_type: "suspended" },
  ])
    assert.equal(
      suggestIdentity({ email: "a@example.invalid", ...meta }, members, [confirmed[0]])
        .suggested_member_id,
      null,
    );
  const phone = confirmed.map((i) => ({ ...i, external_ref: "101", primary_login: null }));
  assert.equal(
    suggestTelephonyIdentity({ extension: "101", observed_labels: [] }, members, phone).ambiguity
      .length,
    2,
  );
  assert.equal(
    suggestTelephonyIdentity({ extension: "101", observed_labels: ["IVR"] }, members, [phone[0]])
      .suggested_member_id,
    null,
  );
  assert.equal(
    suggestTelephonyIdentity({ extension: "101", observed_labels: [] }, members, [
      { team_member_id: id(1), external_ref: "customer101" },
    ]).suggested_member_id,
    null,
  );
});
test("latest decisions retain review intent, include deferred/unassigned and never write or restore a rejected suggestion", async () => {
  for (const decision of [
    "shared",
    "team",
    "system",
    "rejected",
    "unresolved",
    "deferred",
    "unassigned",
  ]) {
    const f = fixture();
    f.member_integration_identities[0].provider = "google_workspace";
    f.member_integration_identities[1].provider = "sipcentric";
    f.endpoint_identity_reviews = [
      row(51, {
        endpoint_id: id(11),
        decision: "confirmed_person",
        team_member_id: id(1),
        created_at: "2026-01-01T00:00:00Z",
      }),
      row(52, { endpoint_id: id(11), decision, created_at: "2026-02-01T00:00:00Z" }),
      row(53, { endpoint_id: id(12), decision, created_at: "2026-02-01T00:00:00Z" }),
    ];
    const h = await read(f);
    const email = buildEmailIdentityResolution(h),
      phone = buildPhoneIdentityResolution(h);
    assert.equal(email.suggestions[0].suggested_member_id, null);
    assert.equal(phone.candidates[0].suggested_member_id, null);
    assert.equal(email.classifications[0].operational_reviewed, true);
    assert.equal(email.reviews.at(-1).decision, "confirmed_person");
  }
});
test("all five inventories pass a small server cap; distant matching names remain ambiguous and distant reviews are retained", async () => {
  const f = {
    team_members: [],
    communication_endpoints: [],
    member_integration_identities: [],
    google_workspace_mailboxes: [],
    endpoint_identity_reviews: [],
  };
  for (let n = 1; n <= 2503; n++) {
    f.team_members.push(
      row(n, {
        display_name: n === 1 ? "Morgan Alpha" : n === 2503 ? "Morgan Beta" : `Synthetic ${n}`,
      }),
    );
    f.communication_endpoints.push(
      row(n, {
        channel: "email",
        endpoint_kind: "email",
        normalized_value: `person${n}@example.invalid`,
        provider: "email",
        status: "active",
      }),
    );
    f.member_integration_identities.push(
      row(n, {
        team_member_id: id(n),
        provider: "email",
        identity_kind: "user",
        external_ref: `person${n}@example.invalid`,
        verification_state: "verified",
      }),
    );
    f.google_workspace_mailboxes.push(
      row(n, { email_address: `person${n}@example.invalid`, status: "active" }),
    );
    f.endpoint_identity_reviews.push(
      row(n, {
        endpoint_id: id(n),
        decision: n === 2503 ? "unassigned" : "confirmed_person",
        team_member_id: id(n),
        created_at: "2026-02-01T00:00:00Z",
      }),
    );
  }
  f.communication_endpoints.push(
    row(6000, {
      channel: "email",
      endpoint_kind: "email",
      normalized_value: "morgan@example.invalid",
      provider: "email",
      status: "active",
    }),
  );
  for (const table of Object.keys(f)) f[table].push(row(9999, { tenant_id: foreign }));
  const db = database(f),
    h = await loadIdentityInventory(db, tenant, now),
    r = buildEmailIdentityResolution(h);
  assert.equal(h.members.length, 2503);
  assert.equal(r.suggestions.length, 2504);
  assert.equal(r.reviews.length, 2503);
  const ambiguous = r.suggestions.find((s) => s.endpoint_id === id(6000));
  assert.equal(ambiguous.suggested_member_id, null);
  assert.equal(ambiguous.ambiguity.length, 2);
  assert.equal(r.suggestions.find((s) => s.endpoint_id === id(2503)).suggested_member_id, null);
  assert.equal(db.calls.length, 110);
  assert.equal(db.calls.filter((c) => c.head).length, 10);
});
test("every source read fails explicitly on outages, missing counts, truncation and foreign rows", async () => {
  for (const table of Object.keys(fixture())) {
    const f = fixture();
    if (!f[table].length)
      f[table] = [
        row(51, { endpoint_id: id(11), decision: "deferred", created_at: "2026-01-01T00:00:00Z" }),
      ];
    for (const transform of [
      (r, c) => (c.table === table ? { data: null, error: "offline" } : r),
      (r, c) => (c.table === table && c.head ? { ...r, count: null } : r),
      (r, c) => (c.table === table && !c.head ? { ...r, data: [] } : r),
      (r, c) =>
        c.table === table && !c.head && r.data.length
          ? { ...r, data: [{ ...r.data[0], tenant_id: foreign }] }
          : r,
    ])
      await assert.rejects(
        loadIdentityInventory(database(f, transform), tenant, now),
        /Complete identity evidence/,
      );
  }
});

test("opaque mailbox references can prove a link, but stale references to a different address cannot", async () => {
  const f = fixture();
  Object.assign(f.member_integration_identities[0], {
    provider: "google_workspace",
    primary_login: "provider-login",
    external_ref: id(41),
  });
  assert.equal(
    buildEmailIdentityResolution(await read(f)).suggestions[0].suggested_member_id,
    id(1),
  );
  f.google_workspace_mailboxes[0].email_address = "someone-else@example.invalid";
  const result = buildEmailIdentityResolution(await read(f)).suggestions[0];
  assert.equal(result.suggested_member_id, null);
  assert.match(result.evidence, /different address/);
});
