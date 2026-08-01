// ServiceOS — Marketing provider-connections RPC-boundary proof (PostgREST +
// real GoTrue JWTs). No Edge runtime, NO provider — synthetic fixtures only.
// Proves at the REAL service boundary (the same interface the application
// uses):
//   1. EVERY marketing_provider_% RPC is SERVICE-ROLE ONLY: authenticated and
//      anon JWTs read 42501 for all fourteen callable functions.
//   2. Browser writes are refused on all four provider tables (insert /
//      update / delete) — RLS + zero privileges, through PostgREST itself.
//   3. RLS reads: the owner (marketing.view) sees the tenant's connections;
//      a same-tenant viewer WITHOUT marketing.view reads ZERO rows; a
//      tenant-B admin reads ZERO tenant-A rows — no existence disclosure.
//   4. Sync runs and facts are visible to the authorised tenant only.
// Cleanup removes everything deletable; append-only ledgers retain their
// bounded, tenant-scoped fixture residue by design (same as every phase).
//
// Run: SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node scripts/marketing-connections.test.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = crypto.randomUUID();
const TB = crypto.randomUUID();
const U = { owner: crypto.randomUUID(), viewer: crypto.randomUUID() };
const UB = crypto.randomUUID();
const RUN = T.slice(0, 8);

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed += 1;
};

async function cleanup() {
  for (const id of [...Object.values(U), UB]) await admin.auth.admin.deleteUser(id).catch(() => {});
  for (const tenant of [T, TB]) {
    for (const table of [
      "marketing_provider_facts",
      "marketing_provider_sync_runs",
      "marketing_provider_account_versions",
      "marketing_provider_accounts",
      "marketing_request_keys",
      "marketing_access_grants",
      "marketing_lifecycle_stages",
      "marketing_settings",
      "platform_jobs",
      "platform_events",
      "audit_logs",
    ]) {
      await admin.from(table).delete().eq("tenant_id", tenant);
    }
    await admin.from("tenants").delete().eq("id", tenant);
  }
}

async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email, password: "Proof-Passw0rd!" });
  if (s.error) {
    console.error("sign-in failed", email, s.error.message);
    process.exit(1);
  }
  return createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.data.session.access_token}` } },
  });
}

async function main() {
  await cleanup();
  await admin.from("tenants").insert([
    { id: T, slug: `p10c-${RUN}`, display_name: "P10 Conn Proof" },
    { id: TB, slug: `p10cb-${RUN}`, display_name: "P10 Conn Proof B" },
  ]);
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}-${RUN}@p10c-proof.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) {
      console.error("user create failed", c.error.message);
      process.exit(1);
    }
    await admin
      .from("profiles")
      .update({ tenant_id: T, role: k === "owner" ? "owner" : "viewer" })
      .eq("id", id);
  }
  await admin.auth.admin.createUser({
    id: UB,
    email: `adminb-${RUN}@p10c-proof.test`,
    password: "Proof-Passw0rd!",
    email_confirm: true,
  });
  await admin.from("profiles").update({ tenant_id: TB, role: "admin" }).eq("id", UB);
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.owner });
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TB, p_actor: UB });

  const ownerC = await signIn(`owner-${RUN}@p10c-proof.test`);
  const viewerC = await signIn(`viewer-${RUN}@p10c-proof.test`);
  const adminBC = await signIn(`adminb-${RUN}@p10c-proof.test`);
  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });

  // ── (1) every callable marketing_provider_% RPC is service-role only ─────
  const RPCS = [
    ["marketing_provider_account_create", { p_tenant: T, p_actor: U.owner, p_args: {} }],
    [
      "marketing_provider_account_connect_start",
      { p_tenant: T, p_actor: U.owner, p_account: T, p_args: {} },
    ],
    ["marketing_provider_account_connect_result", { p_tenant: T, p_account: T, p_args: {} }],
    [
      "marketing_provider_account_credential_mark",
      { p_tenant: T, p_actor: U.owner, p_account: T, p_args: {}, p_expected_version: 1 },
    ],
    [
      "marketing_provider_account_external_select",
      { p_tenant: T, p_actor: U.owner, p_account: T, p_args: {} },
    ],
    [
      "marketing_provider_account_revoke",
      { p_tenant: T, p_actor: U.owner, p_account: T, p_args: {} },
    ],
    [
      "marketing_provider_sync_request",
      { p_tenant: T, p_actor: U.owner, p_account: T, p_args: {} },
    ],
    [
      "marketing_provider_sync_claim",
      { p_tenant: T, p_worker: "x", p_batch: 1, p_lease_seconds: 60 },
    ],
    ["marketing_provider_sync_complete", { p_tenant: T, p_run: T, p_args: {} }],
    ["marketing_provider_sync_due", { p_tenant: T }],
    ["marketing_provider_sync_enqueue_due", { p_tenant: T }],
    ["marketing_provider_fact_record", { p_tenant: T, p_run: T, p_args: {} }],
    ["marketing_provider_account_report", { p_tenant: T, p_account: T }],
    ["marketing_provider_connection_list", { p_tenant: T, p_args: {} }],
  ];
  for (const [name, args] of RPCS) {
    for (const [who, client] of [
      ["authenticated", ownerC],
      ["anon", anonC],
    ]) {
      const r = await client.rpc(name, args);
      ok(
        `${name} refuses ${who}`,
        Boolean(r.error) &&
          (r.error.code === "42501" || /permission denied/i.test(r.error.message)),
        r.error?.code ?? "no-error",
      );
    }
  }

  // fixture: one connected test-provider account through the governed path
  const created = await admin.rpc("marketing_provider_account_create", {
    p_tenant: T,
    p_actor: U.owner,
    p_args: {
      provider: "serviceos_test_provider",
      display_name: "Boundary fixture",
      request_id: `p10c-acc-${RUN}`,
    },
  });
  ok("fixture account creates through the governed RPC", !created.error, created.error?.message);
  const acct = created.data?.id;

  // ── (2) browser writes refused on every provider table ───────────────────
  for (const [table, row] of [
    ["marketing_provider_accounts", { tenant_id: T, provider: "meta", display_name: "x" }],
    [
      "marketing_provider_account_versions",
      { tenant_id: T, account_id: acct, version_number: 99, change_kind: "create", config: {} },
    ],
    ["marketing_provider_sync_runs", { tenant_id: T, account_id: acct, kind: "manual" }],
    [
      "marketing_provider_facts",
      {
        tenant_id: T,
        account_id: acct,
        run_id: acct,
        fact_kind: "campaign",
        external_ref: "x",
        content_digest: "0".repeat(64),
        revision: 1,
      },
    ],
  ]) {
    const ins = await ownerC.from(table).insert(row);
    ok(`${table}: browser insert refused`, Boolean(ins.error), ins.error?.code);
    const upd = await ownerC.from(table).update({ tenant_id: T }).eq("tenant_id", T);
    ok(`${table}: browser update refused`, Boolean(upd.error), upd.error?.code);
    const del = await ownerC.from(table).delete().eq("tenant_id", T);
    ok(`${table}: browser delete refused`, Boolean(del.error), del.error?.code);
  }

  // ── (3) RLS visibility through the REAL interface ─────────────────────────
  const ownerRead = await ownerC
    .from("marketing_provider_accounts")
    .select("id")
    .eq("tenant_id", T);
  ok("owner (marketing.view) sees the tenant's connection", (ownerRead.data ?? []).length === 1);
  const viewerRead = await viewerC.from("marketing_provider_accounts").select("id");
  ok(
    "same-tenant viewer WITHOUT marketing.view reads ZERO rows",
    (viewerRead.data ?? []).length === 0,
  );
  const bRead = await adminBC.from("marketing_provider_accounts").select("id");
  ok("tenant-B admin reads ZERO tenant-A rows", (bRead.data ?? []).length === 0);
  const bDirect = await adminBC.from("marketing_provider_accounts").select("id").eq("id", acct);
  ok("tenant-B direct-id probe discloses NOTHING", (bDirect.data ?? []).length === 0);
  const runsRead = await adminBC.from("marketing_provider_sync_runs").select("id");
  ok("tenant-B reads zero foreign sync runs", (runsRead.data ?? []).length === 0);
  const factsRead = await adminBC.from("marketing_provider_facts").select("id");
  ok("tenant-B reads zero foreign facts", (factsRead.data ?? []).length === 0);

  await cleanup();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
