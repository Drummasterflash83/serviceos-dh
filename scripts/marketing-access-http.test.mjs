// ServiceOS — marketing-access HTTP-contract proof (requires a SERVED edge runtime).
//
// This exercises the REAL authenticated HTTP boundary of the marketing-access
// Edge Function — the one thing the DB-level suites deliberately do not claim to
// cover. It requires the function to be served (supabase functions serve locally,
// or a deployed environment) and REQUIRED env:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   MARKETING_ACCESS_URL (optional; defaults to $SUPABASE_URL/functions/v1/marketing-access)
//
// If the function endpoint is unreachable the script exits 3 with NOT-RUN — it
// NEVER reports success without exercising the real HTTP/auth path.
//
// Contract covered:
//   owner/admin → can_view + full permissions + settings/stages (+ idempotent
//     materialisation on first call);
//   ops → can_view + working subset, but a fresh tenant is NOT materialised by ops;
//   viewer → minimal deny {can_view:false, reason:'no_permission'} with NO
//     settings/stages/permissions/role fields;
//   viewer + explicit grant → can_view true;
//   admin + explicit deny → minimal deny;
//   unauthenticated → 401.
// Self-cleaning synthetic tenant.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const FN = process.env.MARKETING_ACCESS_URL ?? `${URL}/functions/v1/marketing-access`;
if (!SR || !ANON) {
  console.error("MISSING env (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY)");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = "44a07700-0000-4000-8000-0000000044ab";
const USERS = {
  admin: { id: "44a07700-0000-4000-8000-0000000044c1", role: "admin" },
  ops: { id: "44a07700-0000-4000-8000-0000000044c2", role: "ops" },
  viewer: { id: "44a07700-0000-4000-8000-0000000044c3", role: "viewer" },
  granted: { id: "44a07700-0000-4000-8000-0000000044c4", role: "viewer" },
  denied: { id: "44a07700-0000-4000-8000-0000000044c5", role: "admin" },
};

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function call(token) {
  const res = await fetch(FN, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: "{}",
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function cleanup() {
  for (const u of Object.values(USERS)) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  await admin.from("marketing_access_grants").delete().eq("tenant_id", T);
  await admin.from("marketing_lifecycle_stages").delete().eq("tenant_id", T);
  await admin.from("marketing_settings").delete().eq("tenant_id", T);
  await admin.from("tenants").delete().eq("id", T);
}

async function main() {
  // Reachability gate: never claim success without the real boundary.
  try {
    const probe = await fetch(FN, { method: "OPTIONS" });
    if (!probe.ok) throw new Error(`status ${probe.status}`);
  } catch (e) {
    console.error(`NOT-RUN  marketing-access endpoint unreachable at ${FN} (${e.message}).`);
    console.error(
      "Serve the function (supabase functions serve) or point MARKETING_ACCESS_URL at a deployed environment.",
    );
    process.exit(3);
  }

  await cleanup();
  await admin
    .from("tenants")
    .insert({ id: T, slug: "mkt-http-proof", display_name: "Marketing HTTP Proof" });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const tokens = {};
  for (const [k, u] of Object.entries(USERS)) {
    const c = await admin.auth.admin.createUser({
      id: u.id,
      email: `${k}@mkt-http.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) return ok(`create ${k}`, false, c.error.message);
    await admin.from("profiles").update({ tenant_id: T, role: u.role }).eq("id", u.id);
    const si = await anon.auth.signInWithPassword({
      email: `${k}@mkt-http.test`,
      password: "Proof-Passw0rd!",
    });
    if (si.error) return ok(`sign in ${k}`, false, si.error.message);
    tokens[k] = si.data.session.access_token;
  }
  await admin.from("marketing_access_grants").insert([
    { tenant_id: T, profile_id: USERS.granted.id, permission: "marketing.view", granted: true },
    { tenant_id: T, profile_id: USERS.denied.id, permission: "marketing.view", granted: false },
  ]);

  // unauthenticated → 401
  let r = await call(null);
  ok("unauthenticated → 401", r.status === 401, r.status);

  // ops first (fresh tenant): can_view, but materialisation must NOT run for ops
  r = await call(tokens.ops);
  ok("ops → 200 can_view", r.status === 200 && r.body?.data?.can_view === true, r.status);
  ok("ops → uninitialised tenant honestly reported", r.body?.data?.initialised === false);
  ok(
    "ops → working subset without launch",
    Array.isArray(r.body?.data?.permissions) &&
      !r.body.data.permissions.includes("marketing.campaigns.launch"),
  );
  const noSettings = await admin
    .from("marketing_settings")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok("ops call did NOT materialise settings", noSettings.count === 0, noSettings.count);

  // viewer → minimal deny
  r = await call(tokens.viewer);
  ok("viewer → 200 can_view:false", r.status === 200 && r.body?.data?.can_view === false);
  ok("viewer deny reason = no_permission", r.body?.data?.reason === "no_permission");
  ok(
    "viewer deny carries NO settings/stages/permissions/role",
    r.body?.data &&
      !("settings" in r.body.data) &&
      !("lifecycle_stages" in r.body.data) &&
      !("permissions" in r.body.data) &&
      !("role" in r.body.data),
  );

  // admin with explicit deny → minimal deny
  r = await call(tokens.denied);
  ok(
    "explicitly denied admin → can_view:false",
    r.status === 200 && r.body?.data?.can_view === false,
  );

  // admin → materialises (idempotent) + full payload
  r = await call(tokens.admin);
  ok("admin → 200 can_view", r.status === 200 && r.body?.data?.can_view === true, r.status);
  ok("admin → materialised on first call", r.body?.data?.materialised?.created_stages === 8);
  ok("admin → 11 permissions", r.body?.data?.permissions?.length === 11);
  ok("admin → settings present, UTC default", r.body?.data?.settings?.timezone === "UTC");
  ok("admin → 8 lifecycle stages", r.body?.data?.lifecycle_stages?.length === 8);
  r = await call(tokens.admin);
  ok("admin second call idempotent (no re-materialise)", r.body?.data?.materialised === null);

  // viewer with explicit grant → can_view true
  r = await call(tokens.granted);
  ok("explicitly granted viewer → can_view", r.status === 200 && r.body?.data?.can_view === true);

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real HTTP boundary exercised)" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
