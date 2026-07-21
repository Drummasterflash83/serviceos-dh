// ServiceOS — Operator activation: import Drummond's existing (operator-managed) Sipcentric
// connection into the new connection model. Same code path as the wizard's "Use existing
// operator connection" button (telephony-onboarding action `import_existing`), invoked via the
// internal service path. Idempotent, credential-free, and non-destructive to existing data.
//
// Run (against the linked remote):
//   set -a && . ./.env.verify && set +a && node scripts/activate-drummond-connection.mjs
//
// Leaves Drummond persistently recognised as provider-assisted. Preserves the 10 endpoints,
// the confirmed Liz mapping and the 9 unresolved endpoints. No secret is created or copied.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) {
  console.error("MISSING SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const db = createClient(URL, SR, { auth: { persistSession: false } });
const FN = `${URL}/functions/v1/telephony-onboarding`;
const DRUMMOND = "00000000-0000-0000-0000-000000000001";
const PROVIDER = "sipcentric";

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};
// internal service-to-service call (service-role bearer + explicit tenant header)
async function call(body) {
  const r = await fetch(FN, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SR}`,
      "x-internal-tenant-id": DRUMMOND,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, text, json };
}
const rowCount = async () =>
  (
    await db
      .from("provider_connections")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", DRUMMOND)
      .eq("provider", PROVIDER)
  ).count ?? 0;

async function main() {
  // preservation baseline
  const { count: epBefore } = await db
    .from("telephony_inventory")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", DRUMMOND)
    .eq("canonical_type", "endpoint")
    .eq("status", "active");
  const { data: confBefore } = await db
    .from("telephony_directory")
    .select("status,is_shared_device")
    .eq("tenant_id", DRUMMOND)
    .eq("active", true);
  const confirmedBefore = (confBefore || []).filter((r) => r.status === "confirmed").length;
  const sharedBefore = (confBefore || []).filter((r) => r.is_shared_device).length;

  // 1. Activate (first import)
  const a1 = await call({ action: "import_existing", provider: PROVIDER });
  ok("activation import_existing succeeds", a1.status === 200 && a1.json?.imported === true);
  ok("status provider-assisted (manual)", a1.json?.connection?.status === "manual");
  ok("account reference masked (…3950)", (a1.json?.connection?.accountRef ?? "").endsWith("3950"));
  ok("no secret fields configured", (a1.json?.connection?.configuredFields ?? []).length === 0);
  const rows1 = await rowCount();
  ok("exactly one connection row after activation", rows1 === 1, rows1);

  // 2. Idempotency (second import must not duplicate or mutate materially)
  const a2 = await call({ action: "import_existing", provider: PROVIDER });
  const rows2 = await rowCount();
  ok("idempotent: still exactly one row after re-activation", rows2 === 1, rows2);
  ok(
    "idempotent: status stays manual + masked …3950",
    a2.json?.connection?.status === "manual" &&
      (a2.json?.connection?.accountRef ?? "").endsWith("3950"),
  );

  // 3. No credentials created/copied
  const sec = await db.rpc("provider_secret_read", {
    p_tenant: DRUMMOND,
    p_provider: PROVIDER,
    p_field: "account_reference",
  });
  ok("no credential written to Vault", (sec.data ?? null) === null);
  const { data: row } = await db
    .from("provider_connections")
    .select("secret_refs")
    .eq("tenant_id", DRUMMOND)
    .eq("provider", PROVIDER)
    .maybeSingle();
  ok("connection holds NO secret references", Object.keys(row?.secret_refs ?? {}).length === 0);

  // 4. Existing telephony data preserved
  const { count: epAfter } = await db
    .from("telephony_inventory")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", DRUMMOND)
    .eq("canonical_type", "endpoint")
    .eq("status", "active");
  const { data: confAfter } = await db
    .from("telephony_directory")
    .select("status,is_shared_device")
    .eq("tenant_id", DRUMMOND)
    .eq("active", true);
  const confirmedAfter = (confAfter || []).filter((r) => r.status === "confirmed").length;
  ok(
    `endpoints preserved (${epBefore} → ${epAfter}, expect 10)`,
    epAfter === epBefore && epAfter === 10,
  );
  ok(
    `confirmed Liz mapping preserved (${confirmedBefore} → ${confirmedAfter})`,
    confirmedAfter === confirmedBefore && confirmedAfter >= 1,
  );
  ok(
    `unresolved endpoints preserved (${Math.max(0, epAfter - confirmedAfter - sharedBefore)}, expect 9)`,
    epAfter - confirmedAfter - sharedBefore === 9,
  );
}

main()
  .catch((e) => {
    console.error("ACTIVATION ERROR:", e?.message ?? String(e));
    failed++;
  })
  .finally(() => {
    console.log(
      failed === 0
        ? "\nDRUMMOND ACTIVATION: ALL PASSED ✅ (connection now persistent)"
        : `\nDRUMMOND ACTIVATION: ${failed} FAIL ❌`,
    );
    process.exit(failed === 0 ? 0 : 1);
  });
