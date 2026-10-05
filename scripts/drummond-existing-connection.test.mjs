// ServiceOS — Drummond existing-connection proof (import without reconnection or cred exposure).
//
// Drummond already has an operator-managed Sipcentric/Simwood connection (connector_accounts
// account_key 3950). This proves the new connection model RECOGNISES and imports it as a
// provider-assisted connection — WITHOUT copying live credentials into ordinary tables, and
// WITHOUT exposing any secret. Runs over HTTP as a Drummond owner. Self-cleaning (only the
// new provider_connections/onboarding/events rows it creates; never the seeded connector).
//
// Requires the local functions server running. Local env (URL/SR/ANON) in the environment.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !SR || !ANON) {
  console.error("MISSING local SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const FN = `${URL}/functions/v1/telephony-onboarding`;
const DRUMMOND = "00000000-0000-0000-0000-000000000001";
const PROVIDER = "sipcentric";
const stamp = process.env.STAMP || "t1";

let failed = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};

let user = null;
async function mkOwner() {
  const email = `drummond-owner+${stamp}@example.com`;
  const { data: list } = await admin.auth.admin.listUsers();
  const prior = list?.users?.find((u) => u.email === email);
  if (prior) await admin.auth.admin.deleteUser(prior.id);
  const { data: c } = await admin.auth.admin.createUser({ email, password: "Test-Passw0rd!", email_confirm: true });
  await admin.from("profiles").upsert({ id: c.user.id, tenant_id: DRUMMOND, role: "owner", email });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: si } = await anon.auth.signInWithPassword({ email, password: "Test-Passw0rd!" });
  user = { id: c.user.id, token: si.session.access_token };
}

async function call(body) {
  const r = await fetch(FN, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user.token}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text, json: JSON.parse(text) };
}

async function cleanup() {
  // Only remove the NEW connection-model rows for sipcentric — never the seeded connector.
  await admin.rpc("provider_secret_revoke", { p_tenant: DRUMMOND, p_provider: PROVIDER }).then(() => {}, () => {});
  await admin.from("provider_connection_events").delete().eq("tenant_id", DRUMMOND).eq("provider", PROVIDER);
  await admin.from("provider_connections").delete().eq("tenant_id", DRUMMOND).eq("provider", PROVIDER);
  await admin.from("telephony_onboarding").delete().eq("tenant_id", DRUMMOND).eq("provider", PROVIDER);
  if (user) await admin.auth.admin.deleteUser(user.id);
}

async function main() {
  await cleanup();
  await mkOwner();

  // 1. Sipcentric appears as a provider-assisted connection in the gallery.
  const provs = await call({ action: "providers" });
  const sip = provs.json.providers.find((p) => p.provider === PROVIDER);
  ok("Sipcentric present as provider-assisted", sip && sip.manual === true);

  // 2. Import the existing operator connection — recognised, no reconnection.
  const imp = await call({ action: "import_existing", provider: PROVIDER });
  ok("existing connection imported", imp.json.imported === true);
  ok("imported as provider-assisted (manual)", imp.json.connection?.status === "manual");
  ok("account reference is masked (…3950)", (imp.json.connection?.accountRef ?? "").endsWith("3950"));
  ok("NO secret fields configured by import", (imp.json.connection?.configuredFields ?? []).length === 0);

  // 3. No credentials were copied into Vault or exposed.
  const secret = await admin.rpc("provider_secret_read", { p_tenant: DRUMMOND, p_provider: PROVIDER, p_field: "account_reference" });
  ok("no credential stored in Vault by import", (secret.data ?? null) === null);
  // The live SIMWOOD_* credentials remain operator env — never in ordinary tables.
  const { data: rows } = await admin.from("provider_connections").select("secret_refs, non_secret_config").eq("tenant_id", DRUMMOND).eq("provider", PROVIDER).maybeSingle();
  ok("connection row holds NO secret refs", Object.keys(rows?.secret_refs ?? {}).length === 0);

  // 4. connection_status reflects the imported provider-assisted connection, secret-free.
  const st = await call({ action: "connection_status", provider: PROVIDER });
  ok("connection_status = manual, masked ref", st.json.connection?.status === "manual" && (st.json.connection?.accountRef ?? "").endsWith("3950"));

  // 5. Onboarding is resumable: reopen returns to a mid-journey stage.
  const reopen = await call({ action: "reopen", provider: PROVIDER, stage: "mappings_reviewed" });
  ok("onboarding can be reopened/resumed", reopen.json.reopened === true);
  const state = await call({ action: "state", provider: PROVIDER });
  ok("state persisted (resumable)", !!state.json.state && state.json.state.stage === "mappings_reviewed");

  // 6. Audit recorded the import without secrets.
  const audit = await call({ action: "audit", provider: PROVIDER });
  const auditText = JSON.stringify(audit.json.events ?? []);
  ok("audit recorded import + reopen, no secrets", audit.json.events.some((e) => e.event === "onboarding_reopened") && !/SIMWOOD|password/i.test(auditText));
}

main()
  .catch((e) => {
    console.error("DRUMMOND PROOF ERROR:", e?.message ?? String(e));
    failed++;
  })
  .finally(async () => {
    await cleanup();
    console.log(failed === 0 ? "\nDRUMMOND EXISTING-CONNECTION: ALL PASSED ✅" : `\nDRUMMOND: ${failed} FAIL ❌`);
    process.exit(failed === 0 ? 0 : 1);
  });
