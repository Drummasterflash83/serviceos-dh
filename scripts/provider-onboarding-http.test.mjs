// ServiceOS — Provider onboarding HTTP-boundary security + multi-provider proof.
//
// Exercises the DEPLOYED telephony-onboarding Edge Function over HTTP with real user JWTs,
// proving the properties that only show at the boundary:
//   • secrets are NEVER present in any HTTP response body
//   • cross-tenant access is denied (tenant B cannot see tenant A's connection)
//   • non-admin (viewer) writes are denied (403)
//   • the connection form is adapter-driven (mock vs oauth_demo schemas differ)
//   • OAuth start returns a PKCE-bound authorize URL (no secret)
//
// Requires the local functions server running:  npx supabase functions serve --no-verify-jwt
// Run with SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY in env. Self-cleaning.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !SR || !ANON) {
  console.error("MISSING SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const FN = `${URL}/functions/v1/telephony-onboarding`;

const TENANT_A = "a1a1a1a1-0000-4000-8000-0000000000a1";
const TENANT_B = "b2b2b2b2-0000-4000-8000-0000000000b2";
const API_KEY = "HTTP-SECRET-KEY-4c8e1f";
const WEBHOOK = "HTTP-WH-SECRET-77";
const stamp = process.env.STAMP || "t1"; // vary emails across runs without Date/random

let failed = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};

const users = {};
async function mkUser(key, tenant, role) {
  const email = `provtest+${key}-${stamp}@example.com`;
  // Clean any prior user with this email.
  const { data: list } = await admin.auth.admin.listUsers();
  const prior = list?.users?.find((u) => u.email === email);
  if (prior) await admin.auth.admin.deleteUser(prior.id);
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: "Test-Passw0rd!",
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${key}: ${error.message}`);
  const id = created.user.id;
  await admin.from("profiles").upsert({ id, tenant_id: tenant, role, email });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password: "Test-Passw0rd!" });
  if (sErr) throw new Error(`signIn ${key}: ${sErr.message}`);
  users[key] = { id, email, token: signIn.session.access_token, tenant };
}

async function call(token, body) {
  const resp = await fetch(FN, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: resp.status, text, json };
}
const leaks = (text) => text.includes(API_KEY) || text.includes(WEBHOOK);

async function cleanup() {
  for (const t of [TENANT_A, TENANT_B]) {
    for (const p of ["mock", "oauth_demo"]) {
      try { await admin.rpc("provider_secret_revoke", { p_tenant: t, p_provider: p }); } catch { /* */ }
    }
    for (const tbl of ["provider_connection_events", "provider_connections", "provider_oauth_states", "telephony_inventory", "telephony_onboarding"]) {
      try { await admin.from(tbl).delete().eq("tenant_id", t); } catch { /* */ }
    }
  }
  for (const key of Object.keys(users)) {
    try { await admin.auth.admin.deleteUser(users[key].id); } catch { /* */ }
  }
}

async function main() {
  await cleanup();
  await mkUser("ownerA", TENANT_A, "owner");
  await mkUser("ownerB", TENANT_B, "owner");
  await mkUser("viewerA", TENANT_A, "viewer");

  // sanity: function reachable + admin client configured
  const prov = await call(users.ownerA.token, { action: "providers" });
  ok("providers action returns gallery (server configured)", prov.status === 200 && Array.isArray(prov.json?.providers));
  ok("gallery hides dev adapters, shows sipcentric", prov.json?.providers?.some((p) => p.provider === "sipcentric") && !prov.json?.providers?.some((p) => p.provider === "mock"));

  // adapter-driven spec: mock (secret api_key) vs oauth_demo (oauth, no secret) differ
  const specMock = await call(users.ownerA.token, { action: "spec", provider: "mock" });
  const specOauth = await call(users.ownerA.token, { action: "spec", provider: "oauth_demo" });
  ok("mock spec declares a secret api_key field", specMock.json?.connection_spec?.fields?.some((f) => f.name === "api_key" && f.secret));
  ok("oauth_demo spec supports OAuth + PKCE, no secret fields", specOauth.json?.connection_spec?.oauth?.supported === true && specOauth.json?.connection_spec?.oauth?.pkce === true && !specOauth.json?.connection_spec?.fields?.some((f) => f.secret));

  // configure mock as ownerA — secrets must NOT appear in the response
  const cfg = await call(users.ownerA.token, {
    action: "configure_connection",
    provider: "mock",
    values: { account_id: "acct_http", api_key: API_KEY, region: "eu", webhook_secret: WEBHOOK },
  });
  ok("configure_connection succeeds (owner)", cfg.status === 200 && cfg.json?.connection?.status === "configured");
  ok("configure response contains NO secret value", !leaks(cfg.text));
  ok("configure returns masked account ref + field names only", cfg.json?.connection?.accountRef?.includes("http") && cfg.json?.connection?.configuredFields?.includes("api_key"));

  // connection_status — no secret, and test_connection resolves server-side
  const st = await call(users.ownerA.token, { action: "connection_status", provider: "mock" });
  ok("connection_status has no secret", !leaks(st.text) && st.json?.connection?.status === "configured");
  const tc = await call(users.ownerA.token, { action: "test_connection", provider: "mock" });
  ok("test_connection passes (credential resolved server-side) with no secret in body", tc.json?.ok === true && !leaks(tc.text));

  // CROSS-TENANT: ownerB must NOT see tenant A's connection
  const bView = await call(users.ownerB.token, { action: "connection_status", provider: "mock" });
  ok("cross-tenant: ownerB sees not_configured (isolation)", bView.json?.connection?.status === "not_configured" && !leaks(bView.text));

  // NON-ADMIN: viewer cannot configure
  const vCfg = await call(users.viewerA.token, {
    action: "configure_connection",
    provider: "mock",
    values: { account_id: "x", api_key: "shouldnotwork", region: "eu" },
  });
  ok("non-admin (viewer) configure_connection is denied (403)", vCfg.status === 403);

  // audit — events present, no secret
  const audit = await call(users.ownerA.token, { action: "audit", provider: "mock" });
  ok("audit returns events with NO secret", Array.isArray(audit.json?.events) && audit.json.events.some((e) => e.event === "credentials_configured") && !leaks(audit.text));

  // OAuth framework: start returns a PKCE-bound authorize URL, no secret
  const oauth = await call(users.ownerA.token, { action: "oauth_start", provider: "oauth_demo", values: { workspace: "acme" }, redirect_uri: "https://app.example.com/cb" });
  ok("oauth_start returns authorize_url + state", oauth.json?.authorize_url && oauth.json?.state);
  ok("authorize_url carries state + PKCE challenge (S256)", oauth.json?.authorize_url?.includes(`state=${oauth.json.state}`) && /code_challenge=/.test(oauth.json?.authorize_url) && /code_challenge_method=S256/.test(oauth.json?.authorize_url));

  // disconnect
  const disc = await call(users.ownerA.token, { action: "disconnect", provider: "mock" });
  ok("disconnect → revoked", disc.json?.connection?.status === "revoked");
  const afterResolve = await admin.rpc("provider_secret_read", { p_tenant: TENANT_A, p_provider: "mock", p_field: "api_key" });
  ok("after disconnect the secret is gone from Vault", (afterResolve.data ?? null) === null);
}

main()
  .catch((e) => {
    console.error("HTTP TEST ERROR:", e?.message ?? String(e));
    failed++;
  })
  .finally(async () => {
    await cleanup();
    console.log(failed === 0 ? "\nONBOARDING HTTP SECURITY: ALL PASSED ✅" : `\nONBOARDING HTTP SECURITY: ${failed} FAIL ❌`);
    process.exit(failed === 0 ? 0 : 1);
  });
