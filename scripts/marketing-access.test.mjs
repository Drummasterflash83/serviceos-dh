// ServiceOS — marketing-access RPC-boundary proof (Phase 1, hardened).
//
// Exercises the REAL server boundaries the `marketing-access` Edge Function
// delegates to — the canonical resolver `marketing_effective_permissions` and the
// governed bootstrap `marketing_materialise_defaults` — via PostgREST /rpc against
// the real database. This is NOT a replay of copied logic: the SQL under test is
// exactly what production executes. (The function's HTTP/auth shell itself is
// covered by scripts/marketing-access-http.test.mjs, which requires a served edge
// runtime — see the ledger's honest-limitations section.)
//
// Proves: resolver role defaults / grant / deny / disabled verdicts; the
// AUTHENTICATED grant boundary over real JWTs (a signed-in user can resolve ONLY
// themselves via marketing_current_user_permissions; the arbitrary-profile
// resolver is denied to authenticated and anon callers — cross-profile and
// cross-tenant permission inspection is impossible); RPC execute revoked from
// anon; materialisation idempotency + audit; template copy counts.
// Self-cleaning synthetic tenants.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = "34a07700-0000-4000-8000-0000000034ab"; // synthetic proof tenant
const T2 = "34a07700-0000-4000-8000-0000000034ac"; // second tenant (cross-tenant probe)
const U = {
  owner: "34a07700-0000-4000-8000-0000000034c1",
  ops: "34a07700-0000-4000-8000-0000000034c2",
  viewer: "34a07700-0000-4000-8000-0000000034c3",
  denied: "34a07700-0000-4000-8000-0000000034c4", // admin with explicit deny of view
  otherTenant: "34a07700-0000-4000-8000-0000000034c5", // admin of T2
};

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of Object.values(U)) await admin.auth.admin.deleteUser(id).catch(() => {});
  for (const t of [T, T2]) {
    await admin.from("marketing_access_grants").delete().eq("tenant_id", t);
    await admin.from("marketing_lifecycle_stages").delete().eq("tenant_id", t);
    await admin.from("marketing_settings").delete().eq("tenant_id", t);
    await admin.from("audit_logs").delete().eq("tenant_id", t); // stale proof-run audit rows
    await admin.from("tenants").delete().eq("id", t);
  }
}

async function main() {
  await cleanup();
  const mkTenant = await admin.from("tenants").insert([
    { id: T, slug: "mkt-access-proof", display_name: "Marketing Access Proof" },
    { id: T2, slug: "mkt-access-proof-2", display_name: "Marketing Access Proof 2" },
  ]);
  ok("synthetic tenants created", !mkTenant.error, mkTenant.error?.message);

  // Real auth users → profiles rows (the resolver reads profiles).
  const roles = {
    owner: "owner",
    ops: "ops",
    viewer: "viewer",
    denied: "admin",
    otherTenant: "admin",
  };
  const tenantOf = { owner: T, ops: T, viewer: T, denied: T, otherTenant: T2 };
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}@mkt-proof.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) return ok(`create user ${k}`, false, c.error.message);
    const p = await admin
      .from("profiles")
      .update({ tenant_id: tenantOf[k], role: roles[k] })
      .eq("id", id);
    ok(`profile ${k} bound (${roles[k]})`, !p.error, p.error?.message);
  }
  const deny = await admin.from("marketing_access_grants").insert({
    tenant_id: T,
    profile_id: U.denied,
    permission: "marketing.view",
    granted: false,
  });
  ok("explicit deny grant seeded", !deny.error, deny.error?.message);

  // ── Canonical resolver verdicts (the REAL production SQL) ──
  const rpc = (uid) => admin.rpc("marketing_effective_permissions", { p_profile_id: uid });
  let r = await rpc(U.owner);
  ok("resolver: owner full set", !r.error && r.data?.permissions?.length === 12, r.error?.message);
  r = await rpc(U.ops);
  ok(
    "resolver: ops working subset (no launch)",
    !r.error &&
      r.data?.permissions?.length === 7 &&
      !r.data.permissions.includes("marketing.campaigns.launch"),
  );
  r = await rpc(U.viewer);
  ok("resolver: viewer nothing", !r.error && r.data?.permissions?.length === 0);
  r = await rpc(U.denied);
  ok(
    "resolver: explicit deny strips admin view",
    !r.error && !r.data.permissions.includes("marketing.view"),
  );

  // ── AUTHENTICATED grant boundary: real JWTs over PostgREST ──
  // A signed-in user resolves ONLY themselves; the arbitrary-profile resolver is
  // structurally out of reach for authenticated and anon callers.
  if (ANON) {
    const anonBase = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await anonBase.auth.signInWithPassword({
      email: "ops@mkt-proof.test",
      password: "Proof-Passw0rd!",
    });
    ok("ops signs in (real GoTrue JWT)", !si.error, si.error?.message);
    if (!si.error) {
      const asOps = createClient(URL, ANON, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${si.data.session.access_token}` } },
      });
      const self = await asOps.rpc("marketing_current_user_permissions");
      ok(
        "authenticated: resolves OWN permissions via self-only wrapper",
        !self.error && self.data?.permissions?.length === 7,
        self.error?.message,
      );
      const cross = await asOps.rpc("marketing_effective_permissions", {
        p_profile_id: U.owner,
      });
      ok(
        "authenticated: CANNOT resolve another user (same tenant) — denied",
        Boolean(cross.error) && cross.error.code === "42501",
        cross.error?.code,
      );
      const crossTenant = await asOps.rpc("marketing_effective_permissions", {
        p_profile_id: U.otherTenant,
      });
      ok(
        "authenticated: CANNOT resolve a tenant-B profile — denied",
        Boolean(crossTenant.error) && crossTenant.error.code === "42501",
        crossTenant.error?.code,
      );
    }
    // FRESH client for the anonymous checks — anonBase holds the ops session in
    // memory after signInWithPassword, so reusing it would test authenticated,
    // not anonymous.
    const pureAnon = createClient(URL, ANON, { auth: { persistSession: false } });
    const anonSelf = await pureAnon.rpc("marketing_current_user_permissions");
    ok(
      "anonymous: self-only wrapper denied",
      Boolean(anonSelf.error) && anonSelf.error.code === "42501",
      anonSelf.error?.code,
    );
    const anonArb = await pureAnon.rpc("marketing_effective_permissions", {
      p_profile_id: U.owner,
    });
    ok(
      "anonymous: arbitrary resolver denied",
      Boolean(anonArb.error) && anonArb.error.code === "42501",
      anonArb.error?.code,
    );
  } else {
    console.log("SKIP  authenticated-boundary checks (no SUPABASE_ANON_KEY)");
  }

  // service role resolves a SPECIFIED profile (the Edge Function's path)
  const svc = await admin.rpc("marketing_effective_permissions", { p_profile_id: U.ops });
  ok(
    "service role: resolves a specified profile for the Edge Function",
    !svc.error && svc.data?.permissions?.length === 7,
    svc.error?.message,
  );

  // ── Materialisation RPC: revoked from anon; idempotent for the service ──
  if (ANON) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const blocked = await anon.rpc("marketing_materialise_defaults", {
      p_tenant: T,
      p_actor: U.owner,
    });
    ok("materialise RPC blocked for anon", Boolean(blocked.error), blocked.error?.code);
  } else {
    console.log("SKIP  anon-block check (no SUPABASE_ANON_KEY)");
  }

  const m1 = await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.owner });
  ok(
    "materialise run1 creates settings + 8 stages",
    !m1.error && m1.data?.created_settings === true && m1.data?.created_stages === 8,
    m1.error?.message,
  );
  const m2 = await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.owner });
  ok(
    "materialise run2 is a no-op (idempotent)",
    !m2.error && m2.data?.created_settings === false && m2.data?.created_stages === 0,
  );
  const s = await admin
    .from("marketing_lifecycle_stages")
    .select("stage_key", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok("tenant stage count is 8", s.count === 8, s.count);
  const settings = await admin
    .from("marketing_settings")
    .select("timezone")
    .eq("tenant_id", T)
    .maybeSingle();
  ok("settings timezone default is UTC (tenant-neutral)", settings.data?.timezone === "UTC");
  const audit = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("action", "marketing.defaults.materialised");
  ok("materialisation audited exactly once", audit.count === 1, audit.count);

  // ── Disabled tenant → resolver strips everything ──
  await admin.from("marketing_settings").update({ marketing_enabled: false }).eq("tenant_id", T);
  r = await rpc(U.owner);
  ok(
    "resolver: disabled tenant strips even owner",
    !r.error && r.data?.enabled === false && r.data?.permissions?.length === 0,
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
