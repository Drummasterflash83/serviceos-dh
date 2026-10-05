// Run (local stack up):
//   eval "$(npx --no-install supabase status --output json | node -e '…SUPABASE_URL/SERVICE_ROLE_KEY…')"
//   node scripts/control-plane.test.ts
//
// Integration test: OpenFolk Control Plane store + atomic RPCs + discovery adapter
// against the local Docker Postgres on an isolated synthetic tenant (purged at the end).
// Proves: discovery precedence (never overwrites confirmed ownership), RPC atomicity
// (mutation + change_log together; failure ⇒ no partial write), ownership resolution,
// tenant isolation, and the data-quality queue.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  computeDataQuality,
  resolveForEvidence,
} from "../supabase/functions/_shared/controlplane/store.ts";
import { discoverTelephonyEndpoints } from "../supabase/functions/_shared/controlplane/discovery.ts";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run the eval line in the header).",
  );
  process.exit(2);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const RUN = Date.now().toString(16).padStart(12, "0").slice(-12);
const T = `c0c0c0c0-0000-0000-0000-${RUN}`;
const T2 = `c0c0c0c0-0000-0000-1111-${RUN}`;
const M1 = "c0c0c0c0-0000-0000-0000-0000000000a1";
const M2 = "c0c0c0c0-0000-0000-0000-0000000000a2";
const NOW = Date.parse("2026-07-23T12:00:00Z");

let failed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
  }
}
function purge(...tenants: string[]) {
  const tables = [
    "controlplane_change_log",
    "responsibility_handoffs",
    "endpoint_ownership_assignments",
    "member_integration_identities",
    "communication_endpoints",
    "telephony_inventory",
    "team_members",
    "org_units",
  ];
  for (const t of tenants) {
    const dels = tables.map((tb) => `delete from ${tb} where tenant_id='${t}';`).join(" ");
    const sql = `begin; set local session_replication_role=replica; ${dels} delete from tenants where id='${t}'; commit;`;
    try {
      execSync(
        `docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "${sql}"`,
        { stdio: "ignore" },
      );
    } catch {
      /* best effort */
    }
  }
}

async function ins(table: string, rows: unknown) {
  const { error } = await db.from(table).insert(rows as never);
  if (error) throw new Error(`seed ${table}: ${error.message}`);
}

async function main() {
  purge(T, T2);
  for (const t of [T, T2]) {
    await ins("tenants", {
      id: t,
      slug: "cp-int-" + (t === T ? "a-" : "b-") + RUN,
      display_name: "CP Int",
      industry: "hvac",
    });
  }
  await ins("team_members", [
    { id: M1, tenant_id: T, display_name: "Alice" },
    { id: M2, tenant_id: T, display_name: "Bob" },
  ]);
  await ins("telephony_inventory", [
    {
      tenant_id: T,
      provider: "simwood",
      provider_object_id: "obj-ddi",
      canonical_type: "ddi",
      label: "+441111222333",
    },
    {
      tenant_id: T,
      provider: "simwood",
      provider_object_id: "obj-ext",
      canonical_type: "extension",
      label: "103",
    },
    {
      tenant_id: T,
      provider: "simwood",
      provider_object_id: "obj-q",
      canonical_type: "queue",
      label: "scheduling",
    },
    {
      tenant_id: T,
      provider: "simwood",
      provider_object_id: "obj-dev",
      canonical_type: "device",
      label: "desk-phone-1",
    },
  ]);

  await ok("discovery mirrors telephony endpoints (device skipped)", async () => {
    const r = await discoverTelephonyEndpoints(db, T, "op@openfolk.test");
    assert.equal(r.scanned, 4);
    assert.equal(r.upserted, 3, "ddi + extension + queue");
    assert.equal(r.skipped, 1, "device is not an addressable endpoint");
    const { count } = await db
      .from("communication_endpoints")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", T);
    assert.equal(count, 3);
  });

  await ok("discovery is idempotent (re-run creates no duplicates)", async () => {
    await discoverTelephonyEndpoints(db, T, "op@openfolk.test");
    const { count } = await db
      .from("communication_endpoints")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", T);
    assert.equal(count, 3, "still exactly 3 endpoints");
  });

  let ddiEndpointId = "";
  await ok("assign confirmed ownership via atomic RPC (mutation + change_log)", async () => {
    const { data: ep } = await db
      .from("communication_endpoints")
      .select("id")
      .eq("tenant_id", T)
      .eq("endpoint_kind", "ddi")
      .single();
    ddiEndpointId = ep!.id as string;
    const { data: assignId, error } = await db.rpc("cp_assign_ownership", {
      p_tenant: T,
      p_endpoint: ddiEndpointId,
      p_owner_kind: "person",
      p_member: M1,
      p_org_unit: null,
      p_role: null,
      p_assignment_role: "accountable",
      p_exclusive: true,
      p_effective_from: null,
      p_confidence: 0.95,
      p_review_state: "confirmed",
      p_actor: "op@openfolk.test",
      p_reason: "map main line to Alice",
      p_correlation: null,
      p_view_as: false,
    });
    assert.ok(!error, error?.message);
    const { count: logs } = await db
      .from("controlplane_change_log")
      .select("*", { count: "exact", head: true })
      .eq("resource_id", assignId as string)
      .eq("action", "controlplane.ownership.assign");
    assert.equal(logs, 1, "change_log row written atomically with the assignment");
  });

  await ok(
    "DISCOVERY PRECEDENCE: re-running discovery never touches confirmed ownership",
    async () => {
      const before = await db
        .from("endpoint_ownership_assignments")
        .select("id, owner_member_id, review_state, effective_to")
        .eq("tenant_id", T);
      await discoverTelephonyEndpoints(db, T, "op@openfolk.test");
      const after = await db
        .from("endpoint_ownership_assignments")
        .select("id, owner_member_id, review_state, effective_to")
        .eq("tenant_id", T);
      assert.deepEqual(
        after.data,
        before.data,
        "ownership assignments must be byte-for-byte unchanged by discovery",
      );
    },
  );

  await ok("resolve: DDI evidence → accountable owner (Alice)", async () => {
    const r = await resolveForEvidence(db, T, { channel: "phone", ddi: "+441111222333" }, NOW);
    assert.equal(r.matched, true);
    assert.equal(r.accountable?.ref, M1);
    assert.ok(r.confidence >= 0.9);
  });

  await ok("tenant isolation: tenant B does not resolve tenant A's DDI", async () => {
    const r = await resolveForEvidence(db, T2, { channel: "phone", ddi: "+441111222333" }, NOW);
    assert.equal(r.matched, false, "tenant B has no such endpoint");
  });

  await ok("ATOMICITY: a failing RPC writes NO change_log row (no partial config)", async () => {
    const { count: before } = await db
      .from("controlplane_change_log")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", T);
    // member_id belongs to no tenant row here → cp_upsert_member raises → whole tx rolls back.
    const { error } = await db.rpc("cp_upsert_member", {
      p_tenant: T,
      p_member_id: "c0c0c0c0-0000-0000-9999-999999999999",
      p_display_name: "Ghost",
      p_org_unit: null,
      p_formal_role: null,
      p_actor: "op@openfolk.test",
      p_reason: "should fail",
      p_correlation: null,
      p_view_as: false,
    });
    assert.ok(error, "expected the RPC to fail");
    const { count: after } = await db
      .from("controlplane_change_log")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", T);
    assert.equal(after, before, "no change_log row from a failed write");
  });

  await ok("data quality: unmapped endpoints (extension, queue) surface", async () => {
    const items = await computeDataQuality(db, T);
    const unmapped = items.filter((i) => i.kind === "unmapped_endpoint");
    assert.ok(unmapped.length >= 2, `extension + queue unmapped (got ${unmapped.length})`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    purge(T, T2);
    console.log(
      failed === 0 ? "\ncontrol-plane.test: ALL PASSED" : `\ncontrol-plane.test: ${failed} FAILED`,
    );
    process.exit(failed === 0 ? 0 : 1);
  });
