import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newOwnerPlan,
  validateOwnerPlan,
  ownerPreservationSql,
  ownerGrantSql,
  runOwnerAccess,
  OWNER,
} from "./learn-test-owner-access.mjs";
const tables = [
  "public.profiles",
  "public.platform_authority_grants",
  "public.controlplane_change_log",
  "vault.secrets",
  "storage.objects",
];
const initial = {
  identity: 1,
  banned: 1,
  email_identities: 1,
  prior_profile: 1,
  owner_profile: 0,
  target_tenant: 1,
  active_grants: 0,
  exact_grant: 0,
  exact_audit: 0,
};
const rows = tables
  .map((name) => ({ name, count: 1, fingerprint: "preserved" }))
  .sort((a, b) => a.name.localeCompare(b.name));
function fixture(options = {}) {
  let saved;
  const events = [];
  let state = { ...initial };
  const req = async (url, init) => {
    events.push({
      type: "http",
      url,
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (url.includes("/config/auth"))
      return Response.json({
        site_url: OWNER.redirect,
        uri_allow_list: OWNER.redirect,
        smtp_host: null,
      });
    if (url.includes("/api-keys"))
      return Response.json(
        ["anon", "service_role"].map((role) => ({
          name: role,
          api_key:
            "header." +
            Buffer.from(JSON.stringify({ ref: "saatxzwxvdvqevbnskxy", role })).toString(
              "base64url",
            ) +
            ".test",
        })),
      );
    if (url.includes("/auth/v1/admin/users/")) {
      if (init.method === "PUT") {
        assert.equal(saved.state, "unban_started");
        if (options.unbanLost) throw Error("lost acknowledgement");
        state.banned = 0;
      }
      return Response.json({
        id: OWNER.user,
        email: OWNER.email,
        app_metadata: { learn_hosted_operator_session: OWNER.origin },
        banned_until: state.banned ? "2100-01-01T00:00:00Z" : null,
      });
    }
    if (url.includes("/auth/v1/recover?")) {
      assert.equal(saved.state, "recovery_email_started");
      if (options.emailLost) throw Error("email outcome uncertain");
      return Response.json({});
    }
    throw Error("unexpected URL");
  };
  const sql = async (q, readOnly = true) => {
    events.push({ type: "sql", readOnly, q });
    if (q.includes("as contract")) return [{ contract: { fixture: true } }];
    if (q.startsWith("select n.nspname")) return tables.map((name) => ({ name }));
    if (q.includes("as fingerprint"))
      return options.drift && saved ? rows.map((r) => ({ ...r, fingerprint: "changed" })) : rows;
    if (q.startsWith("begin;")) {
      assert.equal(readOnly, false);
      assert.equal(saved.state, "grant_started");
      if (options.grantLost) throw Error("commit uncertain");
      state = { ...state, active_grants: 1, exact_grant: 1, exact_audit: 1 };
      return [{ marker: "owner_access_committed" }];
    }
    if (q.includes("as identity")) return [{ ...state }];
    throw Error("unexpected query");
  };
  const args = {
    token: "fixture-only",
    read: async () => structuredClone(saved),
    save: async (p, exclusive = false) => {
      if (exclusive) assert.equal(saved, undefined);
      saved = structuredClone(p);
      events.push({ type: "save", state: p.state });
    },
    sql,
    fetcher: req,
    checkContract: () => true,
  };
  return {
    args,
    events,
    get saved() {
      return saved;
    },
  };
}
test("read-only preparation does not retrieve keys, unban, grant or email", async () => {
  const f = fixture(),
    r = await runOwnerAccess("prepare", f.args);
  assert.equal(r.state, "prepared");
  assert.equal(r.tenantRole, "viewer");
  assert.equal(r.clientScope, "all_TEST_clients");
  assert(f.events.filter((e) => e.type === "sql").every((e) => e.readOnly));
  assert(
    f.events
      .filter((e) => e.type === "http")
      .every((e) => e.method === "GET" && e.url.endsWith("/config/auth")),
  );
});
test("access change retains tenant profile and all old grants; accepts one recovery request", async () => {
  const f = fixture();
  await runOwnerAccess("prepare", f.args);
  const r = await runOwnerAccess("apply", { ...f.args, approvedRun: f.saved.runId });
  assert.equal(r.state, "ready_needs_owner_signin");
  assert(r.preserved);
  assert.equal(r.checks.prior_profile, 1);
  assert.equal(r.signedInVerified, false);
  assert.equal(r.emailDeliveryVerified, false);
  assert.equal(f.events.filter((e) => e.type === "http" && e.url.includes("/recover?")).length, 1);
  const write = f.events.find((e) => e.type === "http" && e.method === "PUT");
  assert.deepEqual(write.body, { ban_duration: "none" });
  const grant = f.events.find((e) => e.type === "sql" && !e.readOnly).q;
  assert(!/update public\.profiles|delete |update public\.platform_authority_grants/i.test(grant));
});
test("missing approval, changed scope and changed source baseline stop before access writes", async () => {
  const f = fixture();
  await runOwnerAccess("prepare", f.args);
  await assert.rejects(() => runOwnerAccess("apply", f.args), /approval/);
  const p = newOwnerPlan();
  for (const delta of [
    { project: "production" },
    { tenantRole: "owner" },
    { email: "someone@example.invalid" },
    { expiresAt: "2100-01-01" },
  ])
    assert.throws(() => validateOwnerPlan({ ...p, ...delta }));
  const g = fixture({ drift: true });
  await runOwnerAccess("prepare", g.args);
  await assert.rejects(
    () => runOwnerAccess("apply", { ...g.args, approvedRun: g.saved.runId }),
    /changed/,
  );
  assert(
    !g.events.some(
      (e) => (e.type === "http" && e.method === "PUT") || (e.type === "sql" && !e.readOnly),
    ),
  );
});
for (const [option, phase] of [
  ["unbanLost", "unban_started"],
  ["grantLost", "grant_started"],
  ["emailLost", "recovery_email_started"],
])
  test(`uncertain ${phase} is journalled and cannot be blindly repeated`, async () => {
    const f = fixture({ [option]: true });
    await runOwnerAccess("prepare", f.args);
    const approvedRun = f.saved.runId;
    await assert.rejects(() => runOwnerAccess("apply", { ...f.args, approvedRun }));
    assert.equal(f.saved.state, phase);
    const before = f.events.length;
    await assert.rejects(() => runOwnerAccess("apply", { ...f.args, approvedRun }), /approval/);
    assert.equal(f.events.length, before);
  });
test("snapshot includes complete profile values and only excludes the exact new grant/audit", () => {
  const p = newOwnerPlan(),
    sql = ownerPreservationSql(p, tables);
  assert(!sql.includes("-'tenant_id'"));
  assert(sql.includes(`id<>'${p.grant}'`));
  assert(sql.includes(`id<>'${p.audit}'`));
  assert.throws(() => ownerPreservationSql(p, ["public.profiles;drop table profiles"]));
  assert.throws(() => ownerGrantSql({ ...p, grant: p.audit }));
});
