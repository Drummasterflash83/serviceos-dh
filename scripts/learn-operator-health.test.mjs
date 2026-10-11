import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import * as health from "../supabase/functions/_shared/controlplane/health.ts";
const tenant = "10000000-0000-4000-8000-000000000001";
const foreign = "20000000-0000-4000-8000-000000000001";
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-11T00:00:00Z");
const row = (n, fields = {}) => ({
  id: id(n),
  tenant_id: tenant,
  effective_from: "2026-01-01T00:00:00Z",
  effective_to: null,
  ...fields,
});
const tables = [
  "team_members",
  "communication_endpoints",
  "member_integration_identities",
  "endpoint_ownership_assignments",
  "google_workspace_mailboxes",
  "telephony_inventory",
];
function database(records = {}, transform = (r) => r, cap = 137) {
  const calls = [];
  return {
    calls,
    from(table) {
      let rows = [...(records[table] ?? [])],
        columns = [],
        head = false,
        limit = Infinity;
      const c = { table, head: false };
      const q = {};
      q.select = (text, opts) => {
        columns = text.split(",").map((s) => s.trim());
        head = opts?.head === true;
        c.head = head;
        return q;
      };
      q.eq = (k, v) => {
        rows = rows.filter((r) => r[k] === v);
        return q;
      };
      q.lte = (k, v) => {
        rows = rows.filter((r) => Date.parse(r[k]) <= Date.parse(v));
        return q;
      };
      q.or = (text) => {
        const cutoff = text.slice("effective_to.is.null,effective_to.gt.".length);
        rows = rows.filter(
          (r) => r.effective_to === null || Date.parse(r.effective_to) > Date.parse(cutoff),
        );
        return q;
      };
      q.gt = (k, v) => {
        rows = rows.filter((r) => r[k] > v);
        c.cursor = v;
        return q;
      };
      q.order = (k) => {
        rows.sort((a, b) => String(a[k]).localeCompare(String(b[k])));
        return q;
      };
      q.limit = (v) => {
        limit = v;
        return q;
      };
      q.maybeSingle = async () => transform({ data: rows[0] ?? null, error: null }, c, calls);
      q.then = (resolve, reject) => {
        calls.push(c);
        const data = rows
          .slice(0, Math.min(limit, cap))
          .map((r) => Object.fromEntries(columns.map((k) => [k, r[k]])));
        return Promise.resolve(
          transform({ data: head ? null : data, count: rows.length, error: null }, c, calls),
        ).then(resolve, reject);
      };
      return q;
    },
  };
}
function fixture() {
  return {
    team_members: [
      row(1),
      row(2),
      row(3, { effective_to: "2026-09-01T00:00:00Z" }),
      row(4, { effective_from: "2027-01-01T00:00:00Z" }),
    ],
    communication_endpoints: [
      row(11, {
        channel: "email",
        endpoint_kind: "email",
        normalized_value: "a@example.invalid",
        provider: "google_workspace",
        provider_external_ref: "opaque-a",
        status: "active",
      }),
      row(12, {
        channel: "phone",
        endpoint_kind: "extension",
        normalized_value: "101",
        provider: "sipcentric",
        status: "active",
      }),
      row(13, {
        channel: "phone",
        endpoint_kind: "extension",
        normalized_value: "102",
        status: "inactive",
      }),
    ],
    member_integration_identities: [
      row(21, {
        team_member_id: id(1),
        provider: "google_workspace",
        identity_kind: "user",
        external_ref: "opaque-a",
        primary_login: "A@EXAMPLE.INVALID",
        verification_state: "verified",
      }),
      row(22, {
        team_member_id: id(2),
        provider: "slack",
        identity_kind: "user",
        external_ref: "U123",
        primary_login: "a@example.invalid",
        verification_state: "verified",
      }),
    ],
    endpoint_ownership_assignments: [
      row(31, {
        endpoint_id: id(11),
        owner_member_id: id(1),
        assignment_role: "accountable",
        review_state: "confirmed",
        confidence: 1,
      }),
      row(32, {
        endpoint_id: id(12),
        owner_member_id: id(2),
        assignment_role: "accountable",
        review_state: "proposed",
        confidence: 1,
      }),
      row(33, {
        endpoint_id: id(13),
        owner_member_id: id(1),
        assignment_role: "accountable",
        review_state: "confirmed",
        confidence: 1,
      }),
    ],
    google_workspace_mailboxes: [],
    telephony_inventory: [],
  };
}
const issuesFor = (items, kind) => items.filter((i) => i.kind === kind).map((i) => i.ref);
test("verified mail identities retain their member, while email ownership does not imply a phone", async () => {
  const h = await health.loadOperatorHealth(database(fixture(), undefined, 2), tenant, now);
  const issues = health.operatorHealthIssues(h);
  assert.deepEqual(issuesFor(issues, "person_no_email_identity"), [id(2)]);
  assert.deepEqual(issuesFor(issues, "person_no_phone"), [id(1), id(2)]);
  assert.deepEqual(issuesFor(issues, "email_no_confirmed_identity"), []);
  assert.deepEqual(issuesFor(issues, "ownership_unconfirmed"), [id(12)]);
  assert.deepEqual(health.operatorHealthCounts(h), {
    people: 2,
    endpoints_total: 2,
    endpoints_unmapped: 1,
    identities_unverified: 0,
    ambiguous_assignments: 0,
  });
  assert.ok(!issues.some((i) => i.ref === id(3) || i.ref === id(4)));
});
test("phone coverage requires a current confirmed phone assignment; cover/escalation proposals are not coverage", async () => {
  const f = fixture();
  f.endpoint_ownership_assignments[1].review_state = "confirmed";
  f.endpoint_ownership_assignments.push(
    row(34, {
      endpoint_id: id(12),
      owner_member_id: id(1),
      assignment_role: "cover",
      review_state: "rejected",
    }),
    row(35, {
      endpoint_id: id(12),
      owner_member_id: id(1),
      assignment_role: "escalation",
      review_state: "conflicted",
    }),
    row(36, {
      endpoint_id: id(12),
      owner_member_id: id(1),
      assignment_role: "primary_handler",
      review_state: "confirmed",
      effective_from: "2027-01-01T00:00:00Z",
    }),
  );
  const h = await health.loadOperatorHealth(database(f), tenant, now),
    issues = health.operatorHealthIssues(h);
  assert.deepEqual(issuesFor(issues, "person_no_phone"), [id(1)]);
  assert.ok(issuesFor(issues, "endpoint_no_cover").includes(id(12)));
  assert.ok(issuesFor(issues, "endpoint_no_escalation").includes(id(12)));
  assert.equal(health.operatorHealthCounts(h).ambiguous_assignments, 1);
  assert.equal(health.operatorHealthCounts(h).endpoints_unmapped, 0);
});
test("ended identities, inactive owners and suspended mailboxes remain visible without former-person setup alarms", async () => {
  const f = fixture();
  f.member_integration_identities[0].effective_to = "2026-10-11T00:00:00Z";
  f.endpoint_ownership_assignments[0].owner_member_id = id(3);
  f.endpoint_ownership_assignments[0].confidence = 0.2;
  f.google_workspace_mailboxes = [
    row(41, { email_address: "A@EXAMPLE.INVALID", status: "suspended" }),
  ];
  const issues = health.operatorHealthIssues(
    await health.loadOperatorHealth(database(f), tenant, now),
  );
  assert.deepEqual(issuesFor(issues, "person_no_email_identity"), [id(1), id(2)]);
  assert.deepEqual(issuesFor(issues, "email_no_confirmed_identity"), [id(11)]);
  for (const kind of ["owner_inactive", "low_confidence", "suspended_mailbox"])
    assert.deepEqual(issuesFor(issues, kind), [id(11)]);
});
test("manual email providers follow the governed review contract and email-only tenants have no invented phone capability issue", async () => {
  const f = fixture();
  f.communication_endpoints = [
    { ...f.communication_endpoints[0], provider: null, provider_external_ref: null },
  ];
  f.member_integration_identities[0] = {
    ...f.member_integration_identities[0],
    provider: "email",
    external_ref: "a@example.invalid",
    primary_login: null,
  };
  const issues = health.operatorHealthIssues(
    await health.loadOperatorHealth(database(f), tenant, now),
  );
  assert.deepEqual(issuesFor(issues, "email_no_confirmed_identity"), []);
  assert.equal(issuesFor(issues, "provider_capability_unavailable").length, 0);
});
test("all six inventories exhaust a smaller server cap and retain far-end health issues", async () => {
  const f = Object.fromEntries(tables.map((t) => [t, []]));
  for (let n = 1; n <= 2503; n++) {
    f.team_members.push(row(n));
    f.communication_endpoints.push(
      row(n, {
        channel: "email",
        endpoint_kind: "email",
        normalized_value: `member${n}@example.invalid`,
        provider: "email",
        status: "active",
      }),
    );
    f.member_integration_identities.push(
      row(n, {
        team_member_id: id(n),
        provider: "email",
        identity_kind: "user",
        external_ref: `member${n}@example.invalid`,
        verification_state: n === 2503 ? "unverified" : "verified",
      }),
    );
    f.endpoint_ownership_assignments.push(
      row(n, {
        endpoint_id: id(n),
        owner_member_id: id(n),
        assignment_role: "accountable",
        review_state: n === 2503 ? "conflicted" : "confirmed",
      }),
    );
    f.google_workspace_mailboxes.push(
      row(n, {
        email_address: `member${n}@example.invalid`,
        status: n === 2503 ? "suspended" : "active",
      }),
    );
    f.telephony_inventory.push(
      row(n, { provider: "sipcentric", canonical_type: "endpoint", status: "active" }),
    );
  }
  for (const t of tables) f[t].push(row(9999, { tenant_id: foreign }));
  const db = database(f),
    h = await health.loadOperatorHealth(db, tenant, now),
    issues = health.operatorHealthIssues(h);
  assert.deepEqual(health.operatorHealthCounts(h), {
    people: 2503,
    endpoints_total: 2503,
    endpoints_unmapped: 1,
    identities_unverified: 1,
    ambiguous_assignments: 1,
  });
  assert.deepEqual(issuesFor(issues, "person_no_email_identity"), [id(2503)]);
  assert.deepEqual(issuesFor(issues, "suspended_mailbox"), [id(2503)]);
  assert.equal(issuesFor(issues, "person_no_phone").length, 2503);
  assert.ok(
    issues.some((i) => i.kind === "unclassified_phone_metadata" && i.detail.startsWith("2503 ")),
  );
  assert.equal(db.calls.length, 132);
  assert.equal(db.calls.filter((c) => c.head).length, 12);
});
test("missing counts, query failures, truncated/foreign pages and changing inventories cannot look healthy", async () => {
  for (const table of tables) {
    const f = fixture();
    if (!f[table].length) f[table] = [row(99)];
    const transforms = [
      (r, c) => (c.table === table ? { ...r, error: "offline" } : r),
      (r, c) => (c.table === table && c.head ? { ...r, count: null } : r),
      (r, c) => (c.table === table && !c.head ? { ...r, data: [] } : r),
      (r, c) =>
        c.table === table && !c.head && r.data.length
          ? { ...r, data: [{ ...r.data[0], tenant_id: foreign }] }
          : r,
      (r, c, calls) =>
        c.table === table && c.head && calls.filter((x) => x.table === table && x.head).length === 2
          ? { ...r, count: r.count + 1 }
          : r,
    ];
    for (const transform of transforms)
      await assert.rejects(
        health.loadOperatorHealth(database(f, transform), tenant, now),
        /Complete operator health/,
      );
  }
  const f = fixture();
  f.team_members[0].effective_from = "bad";
  await assert.rejects(health.loadOperatorHealth(database(f), tenant, now), /effective dates/);
});
const exports = {};
runInContext(
  ts.transpileModule(
    readFileSync(
      new URL("../supabase/functions/_shared/controlplane/store.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText,
  createContext({ exports, require: (path) => (path.endsWith("health.ts") ? health : {}) }),
);
test("actual summary and quality store propagate failures rather than substituting empty healthy results", async () => {
  const f = fixture();
  f.tenants = [{ id: tenant, slug: "synthetic", display_name: "Synthetic" }];
  const counts = await exports.loadTenantSummary(database(f), tenant);
  assert.equal(counts.people, 2);
  assert.equal(counts.endpoints_unmapped, 1);
  const issues = await exports.computeDataQuality(database(f), tenant);
  assert.deepEqual(issuesFor(issues, "person_no_email_identity"), [id(2)]);
  for (const table of [...tables, "tenants"])
    await assert.rejects(
      exports.loadTenantSummary(
        database(f, (r, c) => (c.table === table ? { data: null, error: "offline" } : r)),
        tenant,
      ),
    );
  await assert.rejects(
    exports.computeDataQuality(
      database(f, (r, c) =>
        c.table === "member_integration_identities" ? { data: null, error: "offline" } : r,
      ),
      tenant,
    ),
    /Complete operator health/,
  );
});
