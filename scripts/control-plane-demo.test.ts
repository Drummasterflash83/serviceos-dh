// Run (local stack up, grants shim applied — see control-plane-verify.sh):
//   node scripts/control-plane-demo.test.ts
//
// §5 FINAL LOCAL PROOF — the 11-step end-to-end demonstration with synthetic data.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { discoverTelephonyEndpoints } from "../supabase/functions/_shared/controlplane/discovery.ts";
import {
  computeDataQuality,
  resolveForEvidence,
} from "../supabase/functions/_shared/controlplane/store.ts";
import { deriveOwnershipForEvidence } from "../supabase/functions/_shared/controlplane/projection.ts";
import { decidePlatformAccess } from "../supabase/functions/_shared/controlplane/authz.ts";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });
const RUN = Date.now().toString(16).padStart(12, "0").slice(-12);
const T = `d0d0d0d0-0000-0000-0000-${RUN}`;
const ALICE = "d0d0d0d0-0000-0000-0000-0000000000a1";
const BOB = "d0d0d0d0-0000-0000-0000-0000000000a2";
const CARE = "d0d0d0d0-0000-0000-0000-0000000000a3";
const SCHED = "d0d0d0d0-0000-0000-0000-00000000ff01";
const HOUR = 3_600_000;
const NOW = Date.parse("2026-07-23T12:00:00Z");

let step = 0;
let failed = 0;
async function demo(name: string, fn: () => Promise<void>) {
  step++;
  try {
    await fn();
    console.log(`  ${step}. PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ${step}. FAIL  ${name}: ${(e as Error).message}`);
  }
}
function purge() {
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
  const dels = tables.map((tb) => `delete from ${tb} where tenant_id='${T}';`).join(" ");
  const sql = `begin; set local session_replication_role=replica; ${dels} delete from tenants where id='${T}'; commit;`;
  try {
    execSync(`docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -c "${sql}"`, {
      stdio: "ignore",
    });
  } catch {
    /* best effort */
  }
}
async function assign(
  endpointId: string,
  kind: string,
  memberOrUnit: string,
  role: string,
  effFrom: number | null,
  reason: string,
) {
  const isUnit = kind === "team";
  const { data, error } = await db.rpc("cp_assign_ownership", {
    p_tenant: T,
    p_endpoint: endpointId,
    p_owner_kind: kind,
    p_member: isUnit ? null : memberOrUnit,
    p_org_unit: isUnit ? memberOrUnit : null,
    p_role: null,
    p_assignment_role: role,
    p_exclusive: role === "accountable",
    p_effective_from: effFrom ? new Date(effFrom).toISOString() : null,
    p_confidence: 0.95,
    p_review_state: "confirmed",
    p_actor: "op@openfolk.test",
    p_reason: reason,
    p_correlation: null,
    p_view_as: false,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
const ddiEvidence = { channel: "phone", ddi: "+441111888999" };

async function main() {
  purge();
  await db
    .from("tenants")
    .insert({ id: T, slug: "demo-" + RUN, display_name: "Demo Heating", industry: "hvac" });
  await db.from("org_units").insert({ id: SCHED, tenant_id: T, kind: "team", name: "Scheduling" });
  await db.from("team_members").insert([
    { id: ALICE, tenant_id: T, display_name: "Alice" },
    { id: BOB, tenant_id: T, display_name: "Bob" },
    { id: CARE, tenant_id: T, display_name: "Carol" },
  ]);
  await db.from("telephony_inventory").insert([
    {
      tenant_id: T,
      provider: "simwood",
      provider_object_id: "d-ddi",
      canonical_type: "ddi",
      label: "+441111888999",
    },
    {
      tenant_id: T,
      provider: "simwood",
      provider_object_id: "d-q",
      canonical_type: "queue",
      label: "scheduling",
    },
    {
      tenant_id: T,
      provider: "simwood",
      provider_object_id: "d-ext",
      canonical_type: "extension",
      label: "210",
    },
  ]);

  let ddiId = "";
  let queueId = "";
  await demo("A DDI is discovered from provider metadata", async () => {
    const r = await discoverTelephonyEndpoints(db, T, "op@openfolk.test");
    assert.ok(r.upserted >= 2);
    const { data } = await db
      .from("communication_endpoints")
      .select("id, endpoint_kind")
      .eq("tenant_id", T);
    ddiId = (data ?? []).find((e) => e.endpoint_kind === "ddi")!.id as string;
    queueId = (data ?? []).find((e) => e.endpoint_kind === "queue")!.id as string;
    assert.ok(ddiId && queueId);
  });

  await demo("OpenFolk maps the DDI to a team member (Alice), from 20h ago", async () => {
    await assign(ddiId, "person", ALICE, "accountable", NOW - 20 * HOUR, "map main line to Alice");
    const r = await resolveForEvidence(db, T, ddiEvidence, NOW);
    assert.equal(r.accountable?.ref, ALICE);
  });

  await demo("A historical ownership change is entered (→ Bob from 5h ago)", async () => {
    await assign(ddiId, "person", BOB, "accountable", NOW - 5 * HOUR, "reassign main line to Bob");
    const { count } = await db
      .from("endpoint_ownership_assignments")
      .select("*", { count: "exact", head: true })
      .eq("endpoint_id", ddiId)
      .eq("assignment_role", "accountable");
    assert.equal(count, 2, "both historical assignments retained");
  });

  await demo(
    "Two interactions at different dates resolve to different historical owners",
    async () => {
      const past = await resolveForEvidence(db, T, ddiEvidence, NOW - 10 * HOUR);
      const present = await resolveForEvidence(db, T, ddiEvidence, NOW);
      assert.equal(past.accountable?.ref, ALICE, "10h ago → Alice");
      assert.equal(present.accountable?.ref, BOB, "now → Bob");
    },
  );

  await demo("A queue resolves to a team (Scheduling)", async () => {
    await assign(
      queueId,
      "team",
      SCHED,
      "accountable",
      NOW - HOUR,
      "scheduling queue owned by Scheduling team",
    );
    const r = await resolveForEvidence(db, T, { channel: "phone", queue: "scheduling" }, NOW);
    assert.equal(r.teamOrRole?.ref, SCHED);
  });

  await demo("An observed transfer changes the LIKELY HANDLER but NOT accountable", async () => {
    await db.from("responsibility_handoffs").insert({
      tenant_id: T,
      subject_type: "interaction",
      subject_ref: "call-xyz",
      handoff_type: "phone_transfer",
      to_party: { kind: "person", ref: CARE },
      occurred_at: new Date(NOW - HOUR).toISOString(),
      observed_state: "confirmed",
    });
    const r = await resolveForEvidence(db, T, ddiEvidence, NOW, { subjectRef: "call-xyz" });
    assert.equal(r.accountable?.ref, BOB, "accountable stays Bob");
    assert.equal(r.likelyCurrentHandler?.ref, CARE, "likely handler follows the transfer");
  });

  await demo("An unmapped endpoint (extension 210) appears in Data Quality", async () => {
    const items = await computeDataQuality(db, T);
    assert.ok(items.some((i) => i.kind === "unmapped_endpoint" && /extension 210/.test(i.detail)));
  });

  await demo(
    "Tenant Command Centre receives the DERIVED result (labels, no raw tables)",
    async () => {
      const d = await deriveOwnershipForEvidence(db, T, ddiEvidence, NOW);
      assert.equal(d.status, "resolved");
      assert.equal(d.accountable?.label, "Bob", "human label, not a uuid");
      // The derived shape carries ONLY operational fields — no provider metadata / identity / audit.
      assert.ok(!("provider" in d) && !("metadata" in d) && !("external_ref" in d));
    },
  );

  await demo("Tenant Superadmin cannot use the Control Plane (no platform grant)", async () => {
    // Platform authority comes from the grant ledger, NOT from profiles.role: a tenant
    // superadmin holds a TENANT grant only, so the platform gate denies them.
    const d = decidePlatformAccess({
      role: "owner",
      profileExists: true,
      grants: [{ permission: "tenant.superadmin" }],
      requireAdmin: false,
      viewAsActive: false,
      nowMs: NOW,
    });
    assert.equal(d.allow, false);
    // Conversely, the SAME tenant role WITH an active platform grant is allowed — this is
    // the operator-bootstrap case (an owner keeps their tenant role and gains platform access).
    const bootstrapped = decidePlatformAccess({
      role: "owner",
      profileExists: true,
      grants: [{ permission: "platform.controlplane.admin" }],
      requireAdmin: false,
      viewAsActive: false,
      nowMs: NOW,
    });
    assert.equal(bootstrapped.allow, true);
    // (DB-level: control_plane.test.sql proves a tenant superadmin reads ZERO Control Plane rows.)
  });

  await demo("OpenFolk VIEWER can inspect but not change", async () => {
    const read = decidePlatformAccess({
      role: "openfolk",
      profileExists: true,
      grants: [{ permission: "platform.controlplane.view" }],
      requireAdmin: false,
      viewAsActive: false,
      nowMs: NOW,
    });
    const write = decidePlatformAccess({
      role: "openfolk",
      profileExists: true,
      grants: [{ permission: "platform.controlplane.view" }],
      requireAdmin: true,
      viewAsActive: false,
      nowMs: NOW,
    });
    assert.equal(read.allow, true);
    assert.equal(write.allow, false);
  });

  await demo("OpenFolk ADMIN makes an audited, atomic change", async () => {
    const w = decidePlatformAccess({
      role: "openfolk",
      profileExists: true,
      grants: [{ permission: "platform.controlplane.admin" }],
      requireAdmin: true,
      viewAsActive: false,
      nowMs: NOW,
    });
    assert.equal(w.allow, true);
    const id = await assign(
      ddiId,
      "person",
      ALICE,
      "primary_handler",
      NOW - HOUR,
      "Alice is primary handler",
    );
    const { count } = await db
      .from("controlplane_change_log")
      .select("*", { count: "exact", head: true })
      .eq("resource_id", id)
      .eq("action", "controlplane.ownership.assign");
    assert.equal(count, 1, "change written atomically with the assignment");
  });
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    purge();
    console.log(
      failed === 0
        ? "\ncontrol-plane-demo: ALL 11 STEPS PASSED"
        : `\ncontrol-plane-demo: ${failed} FAILED`,
    );
    process.exit(failed === 0 ? 0 : 1);
  });
