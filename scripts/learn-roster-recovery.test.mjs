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
      q.range = async (from, to) => ({ ...results[table], data: results[table]?.data?.slice(from, to + 1) ?? null });
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
  const tenants = Array.from({ length: 1001 }, (_, i) => ({ tenant_id: String(i), slug: `test-${i}`, display_name: `Synthetic ${i}` }));
  const r = await call({ action: "tenants.directory" }, { tables: { tenants: { data: tenants, error: null } } });
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
  const r = await call({ action: "tenants.directory" }, { headers: {
    "x-openfolk-machine-key": "synthetic-machine-key", "x-openfolk-actor": "synthetic-machine",
  } });
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

test("roster reads retain scope and reject failed, foreign, duplicate or truncated inventories", async () => {
  const calls = [];
  const client = (override = {}) => ({
    from(table) {
      const q = {};
      q.select = (columns, options) => {
        assert.equal(options.count, "exact");
        return q;
      };
      q.eq = (key, value) => {
        assert.equal(key, "tenant_id");
        assert.equal(value, tenant);
        return q;
      };
      q.or = (filter) => {
        calls.push(filter);
        return q;
      };
      q.order = () => q;
      q.limit = async (n) => {
        assert.equal(n, 2001);
        return { data: [{ id: uid, tenant_id: tenant }], count: 1, error: null, ...override };
      };
      return q;
    },
  });
  const value = await loadRoster(client(), tenant);
  assert.equal(value.members.length, 1);
  assert.equal(value.responsibilities.length, 1);
  assert.equal(calls.length, 2);
  for (const override of [
    { data: [], count: 1 },
    { count: null },
    { error: "offline" },
    { data: [{ id: uid, tenant_id: uid }] },
    {
      data: [
        { id: uid, tenant_id: tenant },
        { id: uid, tenant_id: tenant },
      ],
      count: 2,
    },
  ])
    await assert.rejects(() => loadRoster(client(override), tenant));
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
    responsibility_assignments: [{ id: "responsibility", tenant_id: tenant, member_id: uid }],
    authority_grants: [{ id: "grant", tenant_id: tenant, member_id: uid }],
  };
  const db = {
    from(table) {
      const q = {};
      for (const name of ["select", "eq", "is", "not", "in", "or", "order", "limit"])
        q[name] = () => q;
      const result = { data: rows[table] ?? [], count: (rows[table] ?? []).length, error: null };
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
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
  assert.equal(result.responsibilities[0].id, "responsibility");
  assert.equal(result.authorityGrants[0].id, "grant");
  assert.equal(result.summary.people, 1);
  assert.equal(result.identityResolution.suggestions.length, 0);
});
