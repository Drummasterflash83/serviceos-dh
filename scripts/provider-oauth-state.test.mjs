// ServiceOS — OAuth framework proof: one-time/expiring/bound state + full callback flow.
//
// Module-level (oauth.ts): consume is single-use; unknown → invalid_state; expired → state_expired.
// HTTP-level: oauth_start → provider-oauth-callback(state, code) → token stored in Vault,
// connection configured; replay rejected; forged state rejected; no token in any response.
//
// Requires the local functions server running. Self-cleaning.

import { createClient } from "@supabase/supabase-js";
import { startOAuth, consumeState } from "../supabase/functions/_shared/telephony/oauth.ts";

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !SR || !ANON) {
  console.error("MISSING SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const CB = `${URL}/functions/v1/provider-oauth-callback`;
const ONB = `${URL}/functions/v1/telephony-onboarding`;
const TENANT = "0ac50ac5-0000-4000-8000-00000000ac50";
const stamp = process.env.STAMP || "t1";

let failed = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};

let user = null;
async function mkOwner() {
  const email = `oauthtest+${stamp}@example.com`;
  const { data: list } = await admin.auth.admin.listUsers();
  const prior = list?.users?.find((u) => u.email === email);
  if (prior) await admin.auth.admin.deleteUser(prior.id);
  const { data: c } = await admin.auth.admin.createUser({ email, password: "Test-Passw0rd!", email_confirm: true });
  await admin.from("profiles").upsert({ id: c.user.id, tenant_id: TENANT, role: "owner", email });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: si } = await anon.auth.signInWithPassword({ email, password: "Test-Passw0rd!" });
  user = { id: c.user.id, token: si.session.access_token };
}

async function cleanup() {
  try {
    await admin.rpc("provider_secret_revoke", { p_tenant: TENANT, p_provider: "oauth_demo" });
    for (const tbl of ["provider_connection_events", "provider_connections", "provider_oauth_states", "telephony_onboarding"]) {
      await admin.from(tbl).delete().eq("tenant_id", TENANT);
    }
    if (user) await admin.auth.admin.deleteUser(user.id);
  } catch { /* */ }
}

async function main() {
  await cleanup();

  // ── module-level: one-time + expiry ─────────────────────────────────────────
  const r = await startOAuth({
    db: admin, tenantId: TENANT, provider: "oauth_demo", userId: null,
    scopes: ["a"], redirectUri: "https://x/cb", authorizeBase: "https://p/authorize",
    clientId: "cid", usePkce: true,
  });
  ok("startOAuth returns a state", !!r.state);
  const c1 = await consumeState(admin, r.state);
  ok("first consume succeeds + returns server-held verifier", c1.ok && !!c1.codeVerifier && c1.tenantId === TENANT);
  const c2 = await consumeState(admin, r.state);
  ok("second consume rejected (one-time)", !c2.ok && c2.code === "state_reused");
  const c3 = await consumeState(admin, "totally-forged-state");
  ok("unknown state rejected", !c3.ok && c3.code === "invalid_state");
  // expired
  const expState = "expired-" + stamp;
  await admin.from("provider_oauth_states").insert({
    tenant_id: TENANT, provider: "oauth_demo", state: expState, scopes: [],
    expires_at: new Date(Date.now() - 60000).toISOString(),
  });
  const c4 = await consumeState(admin, expState);
  ok("expired state rejected", !c4.ok && c4.code === "state_expired");

  // ── HTTP-level: full callback flow ──────────────────────────────────────────
  await mkOwner();
  const startResp = await fetch(ONB, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ action: "oauth_start", provider: "oauth_demo", values: { workspace: "acme" }, redirect_uri: `${CB}` }),
  });
  const startJson = await startResp.json();
  ok("oauth_start (HTTP) returns state", !!startJson.state);

  // Provider redirects the browser to our callback with state + code.
  const cbResp = await fetch(`${CB}?state=${encodeURIComponent(startJson.state)}&code=demo-code-123`, { redirect: "manual" });
  const loc = cbResp.headers.get("location") ?? "";
  ok("callback redirects with oauth=connected", (cbResp.status === 302 || cbResp.status === 303) && /oauth=connected/.test(loc));
  ok("callback redirect carries NO token", !/demo-access/.test(loc) && !/demo-refresh/.test(loc));

  // connection now configured with the oauth token stored (server-side resolvable, not exposed)
  const stResp = await fetch(ONB, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ action: "connection_status", provider: "oauth_demo" }),
  });
  const stText = await stResp.text();
  const stJson = JSON.parse(stText);
  ok("connection now configured after OAuth", stJson.connection?.status === "configured" && stJson.connection?.configuredFields?.includes("oauth_access_token"));
  ok("no token value in connection_status response", !/demo-access/.test(stText) && !/demo-refresh/.test(stText));
  const tok = await admin.rpc("provider_secret_read", { p_tenant: TENANT, p_provider: "oauth_demo", p_field: "oauth_access_token" });
  ok("access token IS resolvable server-side (Vault)", typeof tok.data === "string" && tok.data.length > 0);

  // replay the SAME state → rejected (one-time), redirect error
  const replay = await fetch(`${CB}?state=${encodeURIComponent(startJson.state)}&code=demo-code-123`, { redirect: "manual" });
  const replayLoc = replay.headers.get("location") ?? "";
  ok("callback replay rejected (state reused)", /oauth=error/.test(replayLoc));

  // forged state → error
  const forged = await fetch(`${CB}?state=forged-${stamp}&code=x`, { redirect: "manual" });
  ok("forged state rejected", /oauth=error/.test(forged.headers.get("location") ?? ""));
}

main()
  .catch((e) => {
    console.error("OAUTH TEST ERROR:", e?.message ?? String(e));
    failed++;
  })
  .finally(async () => {
    await cleanup();
    console.log(failed === 0 ? "\nOAUTH FRAMEWORK: ALL PASSED ✅" : `\nOAUTH FRAMEWORK: ${failed} FAIL ❌`);
    process.exit(failed === 0 ? 0 : 1);
  });
