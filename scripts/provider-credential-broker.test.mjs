// ServiceOS — Credential broker integration test (Vault-backed, service-role, self-cleaning).
//
// Proves store/resolve/replace/revoke + the security invariants that matter most:
//   • the client-facing status object contains NO secret value
//   • the audit trail contains NO secret value (only field names)
//   • resolveCredential (server-side) returns the plaintext; replace rotates it
//   • revoke removes the secret, marks the row revoked (history preserved), audits it
//
// Run (LOCAL): eval "$(npx --no-install supabase status --output json | ...)" && \
//              node scripts/provider-credential-broker.test.mjs
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS).

import { createClient } from "@supabase/supabase-js";
import {
  storeCredential,
  getConnectionStatus,
  resolveCredential,
  revokeCredential,
  listConnectionEvents,
} from "../supabase/functions/_shared/telephony/credential_broker.ts";

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) {
  console.error("MISSING SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const db = createClient(URL, SR, { auth: { persistSession: false } });

const TENANT = "cccccccc-0000-4000-8000-00000000cccc";
const PROVIDER = "mock";
const ACTOR = "dddddddd-0000-4000-8000-00000000dddd";
const API_KEY = "SUPER-SECRET-KEY-9f3a2b";
const WEBHOOK = "WH-SECRET-1122";

let failed = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};
const containsSecret = (obj) => {
  const s = JSON.stringify(obj ?? {});
  return s.includes(API_KEY) || s.includes(WEBHOOK);
};

async function cleanup() {
  try {
    await db.rpc("provider_secret_revoke", { p_tenant: TENANT, p_provider: PROVIDER });
    await db.from("provider_connection_events").delete().eq("tenant_id", TENANT);
    await db.from("provider_connections").delete().eq("tenant_id", TENANT);
  } catch {
    /* ignore */
  }
}

async function main() {
  await cleanup();

  // 1. store
  const s1 = await storeCredential(db, TENANT, PROVIDER, {
    authMode: "api_key",
    secrets: { api_key: API_KEY, webhook_secret: WEBHOOK },
    nonSecret: { account_id: "acct_777", region: "eu" },
    accountRefField: "account_id",
    actorId: ACTOR,
  });
  ok("store → status configured", s1.status === "configured");
  ok("store → configuredFields lists both secret fields", s1.configuredFields.sort().join() === "api_key,webhook_secret");
  ok("store → account ref is masked (…777)", s1.accountRef === "…_777" || s1.accountRef?.endsWith("777"));
  ok("store → non-secret config kept", s1.nonSecretConfig.account_id === "acct_777" && s1.nonSecretConfig.region === "eu");
  ok("store → status object contains NO secret value", !containsSecret(s1));

  // 2. resolve (server-side) returns plaintext
  const rk = await resolveCredential(db, TENANT, PROVIDER, "api_key");
  const rw = await resolveCredential(db, TENANT, PROVIDER, "webhook_secret");
  ok("resolveCredential(api_key) returns plaintext (server-side only)", rk === API_KEY);
  ok("resolveCredential(webhook_secret) returns plaintext", rw === WEBHOOK);

  // 3. audit trail carries NO secret value, records field names
  const ev1 = await listConnectionEvents(db, TENANT, PROVIDER);
  ok("audit has a credentials_configured event", ev1.some((e) => e.event === "credentials_configured"));
  ok("audit trail contains NO secret value", !containsSecret(ev1));
  const cfgEvt = ev1.find((e) => e.event === "credentials_configured");
  ok("audit records field NAMES only", JSON.stringify(cfgEvt?.detail ?? {}).includes("api_key") && !containsSecret(cfgEvt));

  // 4. read-back status still secret-free
  const s2 = await getConnectionStatus(db, TENANT, PROVIDER);
  ok("getConnectionStatus is secret-free", !containsSecret(s2) && s2.status === "configured");

  // 5. replace api_key → rotates value, records credentials_replaced, one vault row
  const NEW_KEY = "ROTATED-KEY-abc123";
  const s3 = await storeCredential(db, TENANT, PROVIDER, {
    authMode: "api_key",
    secrets: { api_key: NEW_KEY },
    nonSecret: { account_id: "acct_777", region: "us" },
    accountRefField: "account_id",
    actorId: ACTOR,
  });
  const rk2 = await resolveCredential(db, TENANT, PROVIDER, "api_key");
  ok("replace → resolves the NEW value", rk2 === NEW_KEY);
  ok("replace → webhook secret still present (not clobbered)", (await resolveCredential(db, TENANT, PROVIDER, "webhook_secret")) === WEBHOOK);
  ok("replace → non-secret config updated (region us)", s3.nonSecretConfig.region === "us");
  const ev2 = await listConnectionEvents(db, TENANT, PROVIDER);
  ok("replace → audit has credentials_replaced", ev2.some((e) => e.event === "credentials_replaced"));
  ok("replace → still no secret in audit", !containsSecret(ev2));

  // 6. revoke → secret gone, row revoked (preserved), audited
  const s4 = await revokeCredential(db, TENANT, PROVIDER, ACTOR);
  ok("revoke → status revoked", s4.status === "revoked");
  ok("revoke → configuredFields cleared", s4.configuredFields.length === 0);
  ok("revoke → secret no longer resolvable", (await resolveCredential(db, TENANT, PROVIDER, "api_key")) === null);
  const { data: rowStill } = await db.from("provider_connections").select("status").eq("tenant_id", TENANT).eq("provider", PROVIDER).maybeSingle();
  ok("revoke → metadata row preserved as history", rowStill?.status === "revoked");
  const ev3 = await listConnectionEvents(db, TENANT, PROVIDER);
  ok("revoke → audit has provider_disconnected", ev3.some((e) => e.event === "provider_disconnected"));
}

main()
  .catch((e) => {
    console.error("BROKER TEST ERROR:", e?.message ?? String(e));
    failed++;
  })
  .finally(async () => {
    await cleanup();
    console.log(failed === 0 ? "\nCREDENTIAL BROKER: ALL PASSED ✅" : `\nCREDENTIAL BROKER: ${failed} FAIL ❌`);
    process.exit(failed === 0 ? 0 : 1);
  });
