import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { loadRoster } from "../supabase/functions/_shared/controlplane/roster.ts";

const uid = "20000000-0000-4000-8000-000000000001";
const tenant = "10000000-0000-4000-8000-000000000001";
function compiled(path) {
  const result = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.deepEqual(result.diagnostics, []);
  return result.outputText;
}
const authCode = compiled("../supabase/functions/_shared/controlplane/authz.ts");
const edgeCode = compiled("../supabase/functions/openfolk-control-plane/index.ts");
async function call(body = {}, options = {}) {
  const writes = [];
  const results = {
    profiles: { data: { role: "owner" }, error: null },
    platform_authority_grants: {
      data: [{ permission: "platform.controlplane.admin" }],
      error: null,
    },
    view_as_context: { data: null, error: null },
    ...options.tables,
  };
  const db = {
    auth: {
      getUser: async () => ({
        data: { user: { id: uid, email: "synthetic@example.invalid" } },
        error: null,
      }),
    },
    from(table) {
      const q = {};
      for (const name of ["select", "eq", "is", "order"]) q[name] = () => q;
      q.range = async (from, to) => ({
        ...results[table],
        data: results[table]?.data?.slice(from, to + 1) ?? null,
      });
      q.maybeSingle = async () => results[table];
      q.then = (resolve, reject) => Promise.resolve(results[table]).then(resolve, reject);
      return q;
    },
    rpc: async (name, args) => {
      writes.push({ name, args });
      return options.rpcResult ?? { data: uid, error: null };
    },
  };
  const authExports = {};
  const Deno = {
    env: {
      get: (name) =>
        name === "OPENFOLK_CONTROLPLANE_KEY" ? "synthetic-machine-key" : "synthetic-setting",
    },
  };
  runInContext(
    authCode,
    createContext({
      exports: authExports,
      Deno,
      require: () => ({ getBearerToken: () => "synthetic-token" }),
    }),
  );
  let handler;
  runInContext(
    edgeCode,
    createContext({
      exports: {},
      Deno: { ...Deno, serve: (fn) => (handler = fn) },
      Request,
      Response,
      crypto,
      require: (path) =>
        path.includes("@supabase/")
          ? { createClient: () => db }
          : path.endsWith("controlplane/authz.ts")
            ? authExports
            : {},
    }),
  );
  const response = await handler(
    new Request("http://localhost/openfolk-control-plane", {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: JSON.stringify({
        action: "roster.member_upsert",
        tenant_id: tenant,
        display_name: "Example person",
        reason: "Synthetic review",
        ...body,
      }),
    }),
  );
  return { status: response.status, body: await response.json(), writes };
}
test("operator directory reads all pages and refuses tenant-only or failed authority", async () => {
  const tenants = Array.from({ length: 1001 }, (_, i) => ({
    tenant_id: String(i),
    slug: `test-${i}`,
    display_name: `Synthetic ${i}`,
  }));
  const r = await call(
    { action: "tenants.directory" },
    { tables: { tenants: { data: tenants, error: null } } },
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.data.tenants.length, 1001);
  assert.equal(r.writes.length, 0);
  for (const tables of [
    { platform_authority_grants: { data: [], error: null } },
    { profiles: { data: null, error: null } },
    { platform_authority_grants: { data: null, error: "offline" } },
    { tenants: { data: null, error: "offline" } },
  ]) {
    const denied = await call({ action: "tenants.directory" }, { tables });
    assert.notEqual(denied.status, 200);
    assert.equal(denied.body.ok, false);
    assert.equal(denied.body.data, undefined);
    assert.equal(denied.writes.length, 0);
  }
});
test("directory is not available to machine callers even with the dedicated machine key", async () => {
  const r = await call(
    { action: "tenants.directory" },
    {
      headers: {
        "x-openfolk-machine-key": "synthetic-machine-key",
        "x-openfolk-actor": "synthetic-machine",
      },
    },
  );
  assert.equal(r.status, 403);
  assert.equal(r.writes.length, 0);
});
test("all six recovered roster actions use the gated audited RPC contract", async () => {
  for (const [action, rpc, extra] of [
    ["member_upsert", "cp_roster_upsert_member", {}],
    ["member_lifecycle", "cp_member_lifecycle", { member_id: uid, op: "end" }],
    [
      "responsibility_upsert",
      "cp_upsert_responsibility",
      { member_id: uid, kind: "workflow", label: "Example" },
    ],
    ["responsibility_end", "cp_end_responsibility", { assignment_id: uid }],
    [
      "authority_grant",
      "cp_grant_authority",
      { member_id: uid, permission: "work.assign", scope: "team", scope_ref: uid },
    ],
    ["authority_end", "cp_end_authority", { grant_id: uid }],
  ]) {
    const r = await call({ action: "roster." + action, ...extra });
    assert.equal(r.status, 200);
    assert.equal(r.writes.length, 1);
    assert.equal(r.writes[0].name, rpc);
    assert.equal(r.writes[0].args.p_tenant, tenant);
    assert.equal(r.writes[0].args.p_actor, "synthetic@example.invalid");
    assert.equal(r.writes[0].args.p_view_as, false);
    assert.equal(r.writes[0].args.p_reason, "Synthetic review");
    if (action === "authority_grant") assert.equal(r.writes[0].args.p_scope_ref, uid);
  }
});
test("tenant owner alone, view-only operator, View-As and failed authority reads cannot mutate a roster", async () => {
  for (const tables of [
    { platform_authority_grants: { data: [], error: null } },
    {
      platform_authority_grants: {
        data: [{ permission: "platform.controlplane.view" }],
        error: null,
      },
    },
    { profiles: { data: null, error: "offline" } },
    { platform_authority_grants: { data: null, error: "offline" } },
    { view_as_context: { data: null, error: "offline" } },
    { view_as_context: { data: { id: uid, expires_at: null }, error: null } },
    { view_as_context: { data: { id: uid, expires_at: "invalid" }, error: null } },
  ]) {
    const r = await call({}, { tables });
    assert.notEqual(r.status, 200);
    assert.equal(r.writes.length, 0);
  }
});
test("missing reason and authenticated machine callers do not reach roster writes", async () => {
  for (const r of [
    await call({ reason: "" }),
    await call(
      {},
      {
        headers: {
          "x-openfolk-machine-key": "synthetic-machine-key",
          "x-openfolk-actor": "test-machine",
        },
      },
    ),
  ]) {
    assert.notEqual(r.status, 200);
    assert.equal(r.writes.length, 0);
  }
});
test("database rejection is returned without a success acknowledgement", async () => {
  const r = await call(
    {},
    { rpcResult: { error: { message: "Synthetic rejected write" }, data: null } },
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

// Evaluates the actual query filters, cursor, server row cap and count requests.
function rosterDatabase(tables, transform = (value) => value, pageCap = 500) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      let selected = [...(tables[table] ?? [])],
        head = false,
        limit = Infinity;
      const call = { table, head: false, tenant: null, cursor: null, openFilter: null };
      const q = {
        select(columns, options) {
          head = options?.head === true;
          call.head = head;
          assert.equal(options?.count, head ? "exact" : undefined);
          return q;
        },
        eq(key, value) {
          call.tenant = value;
          selected = selected.filter((r) => r[key] === value);
          return q;
        },
        or(filter) {
          call.openFilter = filter;
          const cutoff = filter.split("effective_to.gt.")[1];
          selected = selected.filter(
            (r) => r.effective_to == null || Date.parse(r.effective_to) > Date.parse(cutoff),
          );
          return q;
        },
        gt(key, value) {
          call.cursor = value;
          selected = selected.filter((r) => r[key] > value);
          return q;
        },
        order(key, options) {
          assert.equal(key, "id");
          assert.equal(options.ascending, true);
          selected.sort((a, b) => a.id.localeCompare(b.id));
          return q;
        },
        limit(value) {
          assert.equal(value, 500);
          limit = value;
          return q;
        },
        then(resolve, reject) {
          calls.push({ ...call });
          const value = {
            data: head ? null : selected.slice(0, Math.min(limit, pageCap)),
            count: head ? selected.length : null,
            error: null,
          };
          return Promise.resolve(transform(value, call, calls)).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return db;
}
const rosterId = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("roster reads retain scope and reject failed, foreign, duplicate or truncated inventories", async () => {
  const records = {
    team_members: [{ id: uid, tenant_id: tenant }],
    responsibility_assignments: [{ id: uid, tenant_id: tenant }],
    authority_grants: [{ id: uid, tenant_id: tenant }],
  };
  const db = rosterDatabase(records);
  const value = await loadRoster(db, tenant);
  assert.equal(value.members.length, 1);
  assert.equal(value.responsibilities.length, 1);
  assert.ok(db.calls.every((c) => c.tenant === tenant));
  assert.ok(db.calls.filter((c) => c.table !== "team_members").every((c) => c.openFilter));
  for (const transform of [
    (r, c) => (c.head ? { ...r, count: null } : r),
    (r) => ({ ...r, error: "offline" }),
    (r, c) => (c.head ? r : { ...r, data: [] }),
    (r, c) => (c.head ? r : { ...r, data: [{ id: uid, tenant_id: uid }] }),
    (r, c) =>
      c.head
        ? { ...r, count: 2 }
        : { ...r, data: [records.team_members[0], records.team_members[0]] },
    (r, c) => (c.head ? r : { ...r, data: [{ id: "not-a-uuid", tenant_id: tenant }] }),
  ])
    await assert.rejects(loadRoster(rosterDatabase(records, transform), tenant), /Complete roster/);
});

test("keyset reads exhaust lower server limits and preserve more than 2000 people and assignments", async () => {
  const members = Array.from({ length: 2503 }, (_, i) => ({
    id: rosterId(i + 1),
    tenant_id: tenant,
    display_name: `Member ${String(2503 - i).padStart(4, "0")}`,
    effective_to: i === 2502 ? "2026-01-01" : null,
  }));
  const records = {
    team_members: [...members, { id: rosterId(9999), tenant_id: uid }],
    responsibility_assignments: members.map((m) => ({
      ...m,
      member_id: m.id,
      label: "Shared label",
      effective_to: null,
    })),
    authority_grants: members.map((m) => ({
      ...m,
      member_id: m.id,
      permission: "work.assign",
      effective_to: null,
    })),
  };
  records.responsibility_assignments.push({
    id: rosterId(9998),
    tenant_id: tenant,
    effective_to: "2026-01-01",
  });
  const db = rosterDatabase(records, undefined, 137);
  const result = await loadRoster(db, tenant, Date.parse("2026-10-11T00:00:00Z"));
  for (const rows of [result.members, result.responsibilities, result.authorityGrants]) {
    assert.equal(rows.length, 2503);
    assert.equal(new Set(rows.map((r) => r.id)).size, 2503);
  }
  assert.equal(result.members[0].display_name, "Member 0001");
  assert.equal(result.members.at(-1).display_name, "Member 2503");
  for (const table of Object.keys(records)) {
    assert.equal(db.calls.filter((c) => c.table === table && c.head).length, 2);
    assert.equal(db.calls.filter((c) => c.table === table && !c.head).length, 20);
  }
});

test("changing counts, repeated cursors, ordering failures and bounded inventories fail explicitly", async () => {
  const members = Array.from({ length: 501 }, (_, i) => ({
    id: rosterId(i + 1),
    tenant_id: tenant,
  }));
  const records = { team_members: members };
  const cases = [
    (r, c, calls) =>
      c.table === "team_members" &&
      c.head &&
      calls.filter((x) => x.table === c.table && x.head).length === 2
        ? { ...r, count: 502 }
        : r,
    (r, c) => (c.table === "team_members" && c.cursor ? { ...r, data: [members[0]] } : r),
    (r, c) => (c.table === "team_members" && !c.head ? { ...r, data: [...r.data].reverse() } : r),
    (r, c) => (c.table === "team_members" && c.head ? { ...r, count: 20001 } : r),
    (r, c) => (c.table === "team_members" && !c.head ? { ...r, data: members } : r),
    (r, c) =>
      c.table === "team_members" && !c.head && r.data.length
        ? { ...r, data: [{ ...r.data[0], display_name: "x".repeat(8 * 1024 * 1024) }] }
        : r,
  ];
  for (const transform of cases)
    await assert.rejects(loadRoster(rosterDatabase(records, transform), tenant), /Complete roster/);
  await assert.rejects(
    loadRoster(rosterDatabase(records, undefined, 1), tenant),
    /Complete roster/,
  );
  const invalid = rosterDatabase(records);
  await assert.rejects(loadRoster(invalid, "foreign"), /Invalid roster scope/);
  await assert.rejects(loadRoster(invalid, tenant, NaN), /Invalid roster scope/);
  assert.equal(invalid.calls.length, 0);
});

test("actual workspace store wires the complete roster into the operator response", async () => {
  const member = {
    id: uid,
    tenant_id: tenant,
    display_name: "Example coordinator",
    effective_to: null,
  };
  const rows = {
    team_members: [member],
    responsibility_assignments: [{ id: rosterId(1), tenant_id: tenant, member_id: uid }],
    authority_grants: [{ id: rosterId(2), tenant_id: tenant, member_id: uid }],
  };
  const db = {
    from(table) {
      const q = {};
      let selected = rows[table] ?? [],
        head = false;
      q.select = (_, options) => {
        head = options?.head === true;
        return q;
      };
      q.gt = (key, value) => {
        selected = selected.filter((r) => r[key] > value);
        return q;
      };
      for (const name of ["eq", "is", "not", "in", "or", "order", "limit"]) q[name] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (resolve, reject) =>
        Promise.resolve({ data: head ? null : selected, count: selected.length, error: null }).then(
          resolve,
          reject,
        );
      return q;
    },
  };
  const exports = {};
  runInContext(
    compiled("../supabase/functions/_shared/controlplane/store.ts"),
    createContext({
      exports,
      require: (path) =>
        path.endsWith("roster.ts")
          ? { loadRoster }
          : path.endsWith("discovery.ts") && !path.endsWith("telephony_discovery.ts")
            ? { loadApprovedEmailDomains: async () => [] }
            : path.endsWith("telephony_discovery.ts")
              ? { computeTelephonyIdentityResolution: async () => ({}) }
              : path.endsWith("capabilities.ts")
                ? { providerCapabilities: () => ({}) }
                : {},
    }),
  );
  const result = await exports.loadTenantWorkspace(db, tenant);
  assert.deepEqual(result.members, [member]);
  assert.equal(result.responsibilities[0].id, rosterId(1));
  assert.equal(result.authorityGrants[0].id, rosterId(2));
  assert.equal(result.summary.people, 1);
  assert.equal(result.identityResolution.suggestions.length, 0);
});
