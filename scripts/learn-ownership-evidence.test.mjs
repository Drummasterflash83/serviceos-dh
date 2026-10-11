import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./verify/operator-inventory-fixture.mjs";
import { resolveEndpointOwnership } from "../supabase/functions/_shared/controlplane/resolver.ts";
import { resolveCheckedOwnership } from "../supabase/functions/_shared/controlplane/ownership_inventory.ts";
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
const ep = () =>
  row(11, {
    channel: "phone",
    endpoint_kind: "extension",
    normalized_value: "101",
    provider: "sipcentric",
    provider_external_ref: "seat-101",
    status: "active",
    is_shared: false,
  });
const assignment = (n, fields = {}) =>
  row(n, {
    endpoint_id: id(11),
    owner_kind: "person",
    owner_member_id: id(1),
    assignment_role: "accountable",
    review_state: "confirmed",
    confidence: 0.9,
    ...fields,
  });
const handoff = (n, fields = {}) =>
  row(n, {
    subject_type: "interaction",
    subject_ref: "call-1",
    to_party: { kind: "person", ref: id(2) },
    occurred_at: "2026-10-10T23:00:00Z",
    observed_state: "confirmed",
    ...fields,
  });
const resolve = (over = {}) =>
  resolveEndpointOwnership({
    evidence: { channel: "phone", provider: "sipcentric", extension: "101" },
    endpoints: [ep()],
    assignments: [assignment(21)],
    nowMs: now,
    ...over,
  });
function fixture() {
  return {
    communication_endpoints: [ep()],
    endpoint_ownership_assignments: [
      assignment(21),
      assignment(22, { assignment_role: "primary_handler", owner_member_id: id(3) }),
    ],
    responsibility_handoffs: [handoff(31)],
    team_members: [row(1), row(2), row(3)],
    org_units: [],
  };
}
test("every endpoint match step stays within channel/provider; ambiguous matches have no first-row owner", () => {
  const f = ep();
  const cases = [
    ["providerExternalRef", "seat-101", "provider_ref"],
    ["extension", "101", "extension"],
    ["normalizedValue", "101", "normalized_value"],
  ];
  for (const [key, value, step] of cases) {
    const r = resolve({
      evidence: { channel: "phone", provider: "sipcentric", [key]: value },
      endpoints: [
        { ...f, id: id(12), provider: "simwood" },
        { ...f, id: id(13), channel: "email" },
        f,
      ],
    });
    assert.equal(r.sourceEndpoint.id, id(11));
    assert.equal(r.matchStep, step);
  }
  for (const kind of ["ddi", "queue", "ring_group"]) {
    const key = kind === "ring_group" ? "ringGroup" : kind;
    const e = { ...f, endpoint_kind: kind };
    assert.equal(
      resolve({
        evidence: { channel: "phone", provider: "sipcentric", [key]: "101" },
        endpoints: [{ ...e, id: id(12), provider: "other" }, e],
      }).sourceEndpoint.id,
      id(11),
    );
  }
  const r = resolve({
    evidence: { channel: "phone", extension: "101" },
    endpoints: [f, { ...f, id: id(12), provider: "simwood" }],
  });
  assert.equal(r.matched, false);
  assert.equal(r.accountable, null);
  assert.ok(r.warnings.includes("ambiguous_endpoint_match"));
});
test("proposed/conflicted assignments never count as owners and duplicate confirmed roles stay unresolved", () => {
  for (const review_state of ["proposed", "conflicted", "rejected"])
    assert.equal(resolve({ assignments: [assignment(21, { review_state })] }).accountable, null);
  const r = resolve({
    assignments: [
      assignment(21),
      assignment(22, { owner_member_id: id(2) }),
      assignment(23, {
        owner_kind: "team",
        owner_org_unit_id: id(4),
        assignment_role: "primary_handler",
      }),
    ],
  });
  assert.equal(r.accountable, null);
  assert.equal(r.teamOrRole, null);
  assert.equal(r.assignmentVersionId, null);
  assert.equal(r.confidence, 0);
  assert.ok(r.warnings.includes("ambiguous_accountable_assignment"));
  assert.equal(
    resolve({ assignments: [assignment(21, { owner_member_id: null })] }).accountable,
    null,
  );
});
test("historical endpoint intervals and assignments preserve reassignment boundaries without inventing inactive history", () => {
  const endpoint = { ...ep(), status: "inactive", effective_to: "2026-10-12T00:00:00Z" };
  assert.equal(resolve({ endpoints: [endpoint] }).accountable.ref, id(1));
  assert.equal(resolve({ endpoints: [{ ...endpoint, effective_to: null }] }).matched, false);
  assert.equal(
    resolve({ endpoints: [{ ...endpoint, effective_to: "2026-10-11T00:00:00Z" }] }).matched,
    false,
  );
  const assignments = [
    assignment(21, { effective_to: "2026-10-11T00:00:00Z" }),
    assignment(22, { owner_member_id: id(2), effective_from: "2026-10-11T00:00:00Z" }),
  ];
  assert.equal(resolve({ assignments, nowMs: now - 1 }).accountable.ref, id(1));
  assert.equal(resolve({ assignments }).accountable.ref, id(2));
  assert.equal(resolve({ nowMs: NaN }).matched, false);
});
test("future/undated/rejected handoffs cannot alter historical handlers; equal-time conflicts are unresolved", () => {
  const assignments = [
    assignment(21),
    assignment(22, { assignment_role: "primary_handler", owner_member_id: id(3) }),
  ];
  for (const h of [
    handoff(31, { occurred_at: "2026-10-12T00:00:00Z" }),
    handoff(31, { occurred_at: null }),
    handoff(31, { observed_state: "rejected" }),
  ])
    assert.equal(resolve({ assignments, handoffs: [h] }).likelyCurrentHandler.ref, id(3));
  const r = resolve({
    assignments,
    handoffs: [handoff(31), handoff(32, { to_party: { kind: "person", ref: id(4) } })],
  });
  assert.equal(r.accountable.ref, id(1));
  assert.equal(r.likelyCurrentHandler, null);
  assert.ok(r.warnings.includes("ambiguous_handoff_target"));
  assert.equal(
    resolve({
      assignments,
      handoffs: [handoff(31, { to_party: { kind: "external", ref: "outside" } })],
    }).likelyCurrentHandler,
    null,
  );
});
test("handoff subjects with the same reference cannot cross entity types", async () => {
  const f = fixture();
  f.responsibility_handoffs.push(
    handoff(32, {
      subject_type: "commitment",
      occurred_at: "2026-10-10T23:30:00Z",
      to_party: { kind: "person", ref: id(3) },
    }),
  );
  const a = await resolveCheckedOwnership(
    database(f),
    tenant,
    { channel: "phone", extension: "101" },
    now,
    { subjectRef: "call-1" },
  );
  assert.equal(a.likelyCurrentHandler, null);
  assert.ok(a.warnings.includes("ambiguous_handoff_subject"));
  const b = await resolveCheckedOwnership(
    database(f),
    tenant,
    { channel: "phone", extension: "101" },
    now,
    { subjectRef: "call-1", subjectType: "interaction" },
  );
  assert.equal(b.likelyCurrentHandler.ref, id(2));
  assert.equal(b.accountable.ref, id(1));
});
test("selected handoff person/team must exist in this tenant; lookup failure cannot look resolved", async () => {
  for (const kind of ["person", "team"]) {
    const f = fixture();
    f.responsibility_handoffs[0].to_party = { kind, ref: id(2) };
    f.team_members = [];
    f.org_units = [];
    f[kind === "person" ? "team_members" : "org_units"] = [row(2, { tenant_id: foreign })];
    const r = await resolveCheckedOwnership(
      database(f),
      tenant,
      { channel: "phone", extension: "101" },
      now,
      { subjectRef: "call-1" },
    );
    assert.equal(r.likelyCurrentHandler, null);
    assert.ok(r.warnings.includes("unverified_handoff_target"));
    await assert.rejects(
      resolveCheckedOwnership(
        database(f, (r, c) =>
          c.table === (kind === "person" ? "team_members" : "org_units")
            ? { data: null, error: "offline" }
            : r,
        ),
        tenant,
        { channel: "phone", extension: "101" },
        now,
        { subjectRef: "call-1" },
      ),
      /Handoff target/,
    );
  }
});
test("more than 2500 endpoints and handoffs survive a lower cap, including the final handoff target", async () => {
  const f = fixture();
  f.communication_endpoints = [];
  f.responsibility_handoffs = [];
  for (let n = 1; n <= 2503; n++) {
    f.communication_endpoints.push({
      ...ep(),
      id: id(10000 + n),
      normalized_value: String(n),
      provider_external_ref: `seat-${n}`,
    });
    f.responsibility_handoffs.push(
      handoff(n, {
        occurred_at: new Date(now - 3000000 + n * 1000).toISOString(),
        to_party: { kind: "person", ref: n === 2503 ? id(2) : id(3) },
      }),
    );
  }
  f.endpoint_ownership_assignments = [assignment(21, { endpoint_id: id(12503) })];
  const db = database(f),
    r = await resolveCheckedOwnership(db, tenant, { channel: "phone", extension: "2503" }, now, {
      subjectRef: "call-1",
      subjectType: "interaction",
    });
  assert.equal(r.sourceEndpoint.id, id(12503));
  assert.equal(r.accountable.ref, id(1));
  assert.equal(r.likelyCurrentHandler.ref, id(2));
  assert.equal(db.calls.filter((c) => c.head).length, 6);
  assert.equal(db.calls.length, 48);
});
test("failed, truncated, foreign and changed source reads cannot return a successful ownership answer", async () => {
  for (const table of [
    "communication_endpoints",
    "endpoint_ownership_assignments",
    "responsibility_handoffs",
  ]) {
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
        resolveCheckedOwnership(
          database(fixture(), transform),
          tenant,
          { channel: "phone", extension: "101" },
          now,
          { subjectRef: "call-1" },
        ),
        /Complete ownership evidence/,
      );
  }
  const db = database(fixture());
  await assert.rejects(
    resolveCheckedOwnership(db, tenant, { channel: "phone" }, NaN),
    /Valid ownership scope/,
  );
  assert.equal(db.calls.length, 0);
});

test("opaque provider references are case-sensitive and do not match by lowercasing", () => {
  assert.equal(
    resolve({
      evidence: { channel: "phone", provider: "sipcentric", providerExternalRef: "SEAT-101" },
    }).matched,
    false,
  );
});

test("handoff people must be effective at the requested time, including historical membership", async () => {
  const f = fixture();
  f.team_members.find((m) => m.id === id(2)).effective_to = "2026-10-11T00:00:00Z";
  const after = await resolveCheckedOwnership(
    database(f),
    tenant,
    { channel: "phone", extension: "101" },
    now,
    { subjectRef: "call-1" },
  );
  assert.equal(after.likelyCurrentHandler, null);
  const before = await resolveCheckedOwnership(
    database(f),
    tenant,
    { channel: "phone", extension: "101" },
    now - 1,
    { subjectRef: "call-1" },
  );
  assert.equal(before.likelyCurrentHandler.ref, id(2));
});
