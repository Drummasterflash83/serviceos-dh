// ServiceOS — Provider secret broker REMOTE viability probe.
//
// Proves, over the real Data API with a service-role client, that the Vault-backed
// credential broker RPCs (migration 20260810120000) work end to end AND that a
// non-service client cannot decrypt secrets. This is the "prove remote Vault write/read"
// artifact: run it against the linked remote once the migration is deployed there.
//
// Run (LOCAL):  SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
//               SUPABASE_ANON_KEY=... node scripts/provider-vault-probe.test.mjs
// Run (REMOTE): set -a && . ./.env.verify && set +a && \
//               SUPABASE_ANON_KEY=<remote anon> node scripts/provider-vault-probe.test.mjs
//
// Self-cleaning (revokes its throwaway secrets in a finally). Never prints secret values
// or keys. Exit 0 = remote Vault write/read is VIABLE; non-zero = stop-and-report.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY; // optional but recommended (proves denial)
if (!URL || !SR) {
  console.error("MISSING SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const svc = createClient(URL, SR, { auth: { persistSession: false } });
const anon = ANON ? createClient(URL, ANON, { auth: { persistSession: false } }) : null;

// Obviously-synthetic throwaway tenants — never a real tenant id.
const TA = "aaaaaaaa-0000-4000-8000-00000000aaaa";
const TB = "bbbbbbbb-0000-4000-8000-00000000bbbb";
const PROVIDER = "vaultprobe";

let failed = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};

async function main() {
  // 1. create + read roundtrip (service role)
  const { data: id1, error: e1 } = await svc.rpc("provider_secret_store", {
    p_tenant: TA, p_provider: PROVIDER, p_field: "api_key", p_secret: "PROBE-AAA-111",
  });
  ok("service-role store returns a vault reference", !e1 && !!id1);

  const { data: r1, error: e1r } = await svc.rpc("provider_secret_read", {
    p_tenant: TA, p_provider: PROVIDER, p_field: "api_key",
  });
  ok("service-role read roundtrips plaintext", !e1r && r1 === "PROBE-AAA-111");

  // 2. replacement in place (same reference, new value)
  const { data: id2 } = await svc.rpc("provider_secret_store", {
    p_tenant: TA, p_provider: PROVIDER, p_field: "api_key", p_secret: "PROBE-BBB-222",
  });
  ok("replacement keeps the same vault reference", id2 === id1);
  const { data: r2 } = await svc.rpc("provider_secret_read", {
    p_tenant: TA, p_provider: PROVIDER, p_field: "api_key",
  });
  ok("replacement value read back", r2 === "PROBE-BBB-222");

  // 3. tenant isolation
  await svc.rpc("provider_secret_store", {
    p_tenant: TB, p_provider: PROVIDER, p_field: "api_key", p_secret: "PROBE-B-999",
  });
  const { data: ra } = await svc.rpc("provider_secret_read", {
    p_tenant: TA, p_provider: PROVIDER, p_field: "api_key",
  });
  const { data: rb } = await svc.rpc("provider_secret_read", {
    p_tenant: TB, p_provider: PROVIDER, p_field: "api_key",
  });
  ok("tenant isolation: A and B hold independent secrets", ra === "PROBE-BBB-222" && rb === "PROBE-B-999");

  // 4. a NON-service (anon) client cannot decrypt — the frontend path is physically denied
  if (anon) {
    const { data: leak, error: eDenied } = await anon.rpc("provider_secret_read", {
      p_tenant: TA, p_provider: PROVIDER, p_field: "api_key",
    });
    ok("anon client is DENIED provider_secret_read (no plaintext leak)", !!eDenied && !leak);
  } else {
    console.log("SKIP  anon denial check (set SUPABASE_ANON_KEY to enable)");
  }

  // 5. revoke removes A's secrets only
  const { data: n } = await svc.rpc("provider_secret_revoke", { p_tenant: TA, p_provider: PROVIDER });
  ok("revoke reports removed count", typeof n === "number" && n >= 1);
  const { data: rAfter } = await svc.rpc("provider_secret_read", {
    p_tenant: TA, p_provider: PROVIDER, p_field: "api_key",
  });
  ok("secret unreadable after revoke", rAfter === null);
  const { data: rbStill } = await svc.rpc("provider_secret_read", {
    p_tenant: TB, p_provider: PROVIDER, p_field: "api_key",
  });
  ok("revoke of A did not touch B", rbStill === "PROBE-B-999");
}

main()
  .catch((e) => {
    console.error("PROBE ERROR:", e?.message ?? String(e));
    failed++;
  })
  .finally(async () => {
    // Best-effort cleanup of both throwaway tenants.
    try {
      await svc.rpc("provider_secret_revoke", { p_tenant: TA, p_provider: PROVIDER });
      await svc.rpc("provider_secret_revoke", { p_tenant: TB, p_provider: PROVIDER });
    } catch {
      /* ignore cleanup errors */
    }
    console.log(failed === 0 ? "\nVAULT PROBE: VIABLE ✅" : `\nVAULT PROBE: ${failed} FAIL ❌`);
    process.exit(failed === 0 ? 0 : 1);
  });
