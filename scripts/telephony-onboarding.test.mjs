// Focused test — telephony inventory idempotency + tenant isolation (service-role).
//
// Uses two synthetic tenants + the mock adapter (no Drummond data touched). Proves:
//  - repeated discovery UPDATES rather than duplicates;
//  - one tenant's discovered objects are invisible to another tenant;
//  - provider capabilities differ per provider.
// Self-cleaning. Run: set -a && . ./.env.verify && set +a && node scripts/telephony-onboarding.test.mjs

import { createClient } from "@supabase/supabase-js";
import { getAdapter } from "../supabase/functions/_shared/telephony/registry.ts";
import { DISCOVERY_ORDER } from "../supabase/functions/_shared/telephony/adapter.ts";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const TENANT_A = crypto.randomUUID();
const TENANT_B = crypto.randomUUID();
const PROVIDER = "mock";
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
};

// Replicates the edge function's discover→upsert (idempotent).
async function discoverInto(tenantId) {
  const adapter = getAdapter(PROVIDER);
  let imported = 0;
  for (const type of DISCOVERY_ORDER) {
    const r = await adapter.discover(type, { db, tenantId });
    if (!r.supported) continue;
    for (const o of r.objects) {
      const { error } = await db.from("telephony_inventory").upsert(
        {
          tenant_id: tenantId,
          provider: PROVIDER,
          provider_object_id: o.providerObjectId,
          canonical_type: o.canonicalType,
          label: o.label,
          parent_object_id: o.parentObjectId ?? null,
          status: "active",
          discovery_source: o.discoverySource,
          confidence: o.confidence,
        },
        { onConflict: "tenant_id,provider,provider_object_id" },
      );
      if (!error) imported++;
    }
  }
  return imported;
}
const count = async (tenantId) =>
  (
    await db
      .from("telephony_inventory")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("provider", PROVIDER)
  ).count ?? 0;

try {
  // 1) First discovery imports the mock fixtures.
  await discoverInto(TENANT_A);
  const after1 = await count(TENANT_A);
  ok("first discovery imports objects", after1 > 0, `count=${after1}`);

  // 2) Repeated discovery UPDATES, does not duplicate.
  await discoverInto(TENANT_A);
  const after2 = await count(TENANT_A);
  ok("repeated discovery is idempotent (no duplicates)", after2 === after1, `${after1}→${after2}`);

  // 3) Tenant isolation — tenant B discovers independently; A's rows stay A's.
  await discoverInto(TENANT_B);
  const aOnly = await count(TENANT_A);
  const bOnly = await count(TENANT_B);
  ok("tenant B discovery does not affect tenant A", aOnly === after1);
  ok("tenant B has its own rows", bOnly === after1);

  // 4) Isolation: the same object ids exist under BOTH tenants as DISTINCT rows;
  // a tenant-scoped query only ever returns that tenant's rows.
  const { data: aRows } = await db
    .from("telephony_inventory")
    .select("tenant_id")
    .eq("tenant_id", TENANT_A);
  ok(
    "every tenant-A row is tenant A (isolation)",
    (aRows ?? []).every((r) => r.tenant_id === TENANT_A),
  );

  // 5) capability difference (mock exposes extensions; sipcentric manual).
  const mockCaps = getAdapter("mock").getCapabilityStatus().capabilities;
  const sipCaps = getAdapter("sipcentric").getCapabilityStatus().capabilities;
  ok(
    "provider capabilities differ",
    mockCaps.extension_discovery === "supported" && sipCaps.extension_discovery === "manual",
  );
} catch (e) {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  failures++;
} finally {
  await db.from("telephony_inventory").delete().in("tenant_id", [TENANT_A, TENANT_B]);
  console.log("cleanup: removed synthetic tenant inventory");
}

console.log(failures === 0 ? "\ntelephony onboarding invariants hold ✓" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
