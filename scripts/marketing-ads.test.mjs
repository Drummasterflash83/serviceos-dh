// ServiceOS — Marketing Phase 8 RPC-boundary proof (PostgREST + real GoTrue
// JWTs). No Edge runtime, NO provider, NO real lead — synthetic fixtures
// only. Proves at the REAL service boundary:
//   1. Every Phase-8 RPC is SERVICE-ROLE ONLY (authenticated + anon JWTs →
//      42501) and every Phase-8 evidence table refuses browser writes.
//   2. RLS: a same-tenant viewer WITHOUT marketing.view reads ZERO rows; a
//      tenant-B admin reads ZERO tenant-A rows.
//   3. TRUE CONCURRENCY: parallel identical source creates converge on ONE
//      source; parallel identical ingests converge on ONE logical event;
//      parallel claim batches never double-process an event.
//   4. The E2E flow over PostgREST: source → credential mark → ingest →
//      claim → process → Person/Interaction/touchpoint facts.
// Random-id synthetic tenant; cleanup removes everything deletable and leaves
// only the bounded residue the append-only platform ledgers retain.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = crypto.randomUUID();
const TB = crypto.randomUUID();
const U = { owner: crypto.randomUUID(), viewer: crypto.randomUUID() };
const UB = crypto.randomUUID();
const RUN = T.slice(0, 8);

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of [...Object.values(U), UB]) await admin.auth.admin.deleteUser(id).catch(() => {});
  for (const tenant of [T, TB]) {
    for (const table of [
      "marketing_ad_touchpoints",
      "marketing_ad_metric_facts",
      "marketing_ad_sync_runs",
      "marketing_ad_event_conflicts",
      "marketing_ad_events",
      "marketing_ad_source_versions",
      "marketing_ad_sources",
      "marketing_request_keys",
      "marketing_identity_conflicts",
      "interactions",
      "contact_tag_assignments",
      "contact_relationships",
      "contact_points",
      "people",
      "marketing_tags",
      "marketing_access_grants",
      "marketing_lifecycle_stages",
      "marketing_settings",
      "audit_logs",
      "platform_events",
      "platform_jobs",
    ]) {
      await admin.from(table).delete().eq("tenant_id", tenant);
    }
    await admin.from("tenants").delete().eq("id", tenant);
  }
}

async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email, password: "Proof-Passw0rd!" });
  if (s.error) {
    console.error("sign-in failed", email, s.error.message);
    process.exit(1);
  }
  return createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.data.session.access_token}` } },
  });
}

async function main() {
  await cleanup();
  await admin.from("tenants").insert([
    { id: T, slug: `p8-proof-${RUN}`, display_name: "P8 Proof" },
    { id: TB, slug: `p8b-proof-${RUN}`, display_name: "P8 Proof B" },
  ]);
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}-${RUN}@p8-proof.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) {
      console.error("user create failed", c.error.message);
      process.exit(1);
    }
    await admin
      .from("profiles")
      .update({ tenant_id: T, role: k === "owner" ? "owner" : "viewer" })
      .eq("id", id);
  }
  await admin.auth.admin.createUser({
    id: UB,
    email: `adminb-${RUN}@p8-proof.test`,
    password: "Proof-Passw0rd!",
    email_confirm: true,
  });
  await admin.from("profiles").update({ tenant_id: TB, role: "admin" }).eq("id", UB);
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.owner });
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TB, p_actor: UB });

  const ownerC = await signIn(`owner-${RUN}@p8-proof.test`);
  const viewerC = await signIn(`viewer-${RUN}@p8-proof.test`);
  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });

  // ── (1) SERVICE-ROLE-ONLY RPCs + browser write denial ─────────────────────
  for (const [name, args] of [
    ["marketing_ad_source_create", { p_tenant: T, p_actor: U.owner, p_args: {} }],
    ["marketing_ad_event_ingest", { p_tenant: T, p_source: T, p_args: {} }],
    ["marketing_ad_lead_process", { p_tenant: T, p_event: T }],
    ["marketing_ad_metric_record", { p_tenant: T, p_source: T, p_payload: {} }],
    ["marketing_ad_claim_events", { p_tenant: T, p_worker: "x", p_batch: 1, p_lease_seconds: 60 }],
    ["marketing_ads_overview", { p_tenant: T }],
  ]) {
    for (const [who, client] of [
      ["authenticated", ownerC],
      ["anon", anonC],
    ]) {
      const r = await client.rpc(name, args);
      ok(
        `${who} JWT cannot execute ${name}`,
        r.error?.code === "42501" || /permission denied/i.test(r.error?.message ?? ""),
        r.error?.code ?? "no error",
      );
    }
  }
  for (const table of [
    "marketing_ad_events",
    "marketing_ad_touchpoints",
    "marketing_ad_metric_facts",
  ]) {
    const w = await ownerC.from(table).insert({ tenant_id: T });
    ok(`browser cannot insert into ${table}`, w.error != null, w.error?.code);
  }

  // ── (2) E2E: source → credential → ingest → claim → process ───────────────
  const created = await admin.rpc("marketing_ad_source_create", {
    p_tenant: T,
    p_actor: U.owner,
    p_args: {
      provider: "webhook",
      name: `P8 source ${RUN}`,
      default_relationship_type: "lead",
      default_lifecycle_stage_key: "new_lead",
      request_id: `p8-src-${RUN}`,
    },
  });
  ok("source created over PostgREST", !created.error, created.error?.message);
  const SRC = created.data?.id;
  // PARALLEL identical creates converge on the SAME source
  const [c1, c2] = await Promise.all([
    admin.rpc("marketing_ad_source_create", {
      p_tenant: T,
      p_actor: U.owner,
      p_args: {
        provider: "webhook",
        name: `P8 source ${RUN}`,
        default_relationship_type: "lead",
        default_lifecycle_stage_key: "new_lead",
        request_id: `p8-src-${RUN}`,
      },
    }),
    admin.rpc("marketing_ad_source_create", {
      p_tenant: T,
      p_actor: U.owner,
      p_args: {
        provider: "webhook",
        name: `P8 source ${RUN}`,
        default_relationship_type: "lead",
        default_lifecycle_stage_key: "new_lead",
        request_id: `p8-src-${RUN}`,
      },
    }),
  ]);
  ok(
    "PARALLEL identical source creates converge",
    !c1.error && !c2.error && c1.data.id === SRC && c2.data.id === SRC,
    `${c1.error?.message ?? ""}${c2.error?.message ?? ""}`,
  );
  const srcCount = await admin.from("marketing_ad_sources").select("id").eq("tenant_id", T);
  ok("exactly ONE source persisted", srcCount.data?.length === 1, srcCount.data?.length);

  await admin.rpc("marketing_ad_source_credential_mark", {
    p_tenant: T,
    p_actor: U.owner,
    p_source: SRC,
    p_args: { request_id: `p8-cm-${RUN}` },
    p_expected_version: 1,
  });

  // PARALLEL identical ingests converge on ONE logical event
  const digest = "ab".repeat(32);
  const ingestArgs = {
    p_tenant: T,
    p_source: SRC,
    p_args: {
      provider_event_id: `evt-${RUN}-1`,
      occurred_at: new Date().toISOString(),
      body_digest: digest,
      schema_version: "ads-lead@1",
      envelope: {
        schema_version: "ads-lead@1",
        lead: { first_name: "Par", last_name: "Allel", email: `par-${RUN}@example.test` },
      },
    },
  };
  const [i1, i2] = await Promise.all([
    admin.rpc("marketing_ad_event_ingest", ingestArgs),
    admin.rpc("marketing_ad_event_ingest", ingestArgs),
  ]);
  ok(
    "PARALLEL identical deliveries create ONE logical event",
    !i1.error && !i2.error && i1.data.event_id === i2.data.event_id,
    `${i1.error?.message ?? ""}${i2.error?.message ?? ""}`,
  );
  const evCount = await admin.from("marketing_ad_events").select("id").eq("tenant_id", T);
  ok("exactly ONE event persisted", evCount.data?.length === 1, evCount.data?.length);
  const EVT = i1.data.event_id;

  // PARALLEL claims never double-process: two claim batches race — the union
  // of both claims contains the event exactly once
  const [k1, k2] = await Promise.all([
    admin.rpc("marketing_ad_claim_events", {
      p_tenant: T,
      p_worker: "w1",
      p_batch: 5,
      p_lease_seconds: 300,
    }),
    admin.rpc("marketing_ad_claim_events", {
      p_tenant: T,
      p_worker: "w2",
      p_batch: 5,
      p_lease_seconds: 300,
    }),
  ]);
  const claimedIds = [...(k1.data ?? []), ...(k2.data ?? [])].map((e) => e.id);
  ok(
    "PARALLEL claim batches yield the event exactly once",
    claimedIds.filter((id) => id === EVT).length === 1,
    JSON.stringify(claimedIds),
  );
  const processed = await admin.rpc("marketing_ad_lead_process", { p_tenant: T, p_event: EVT });
  ok(
    "the claimed event processes to a resolved Person",
    !processed.error && processed.data.state === "resolved" && processed.data.person_id,
    processed.error?.message ?? processed.data?.state,
  );
  const person = processed.data?.person_id;
  const inter = await admin
    .from("interactions")
    .select("id, direction, related_person_id")
    .eq("tenant_id", T)
    .eq("source_table", "marketing_ad_events")
    .eq("source_id", EVT);
  ok(
    "exactly ONE canonical inbound Interaction exists",
    inter.data?.length === 1 &&
      inter.data[0].direction === "inbound" &&
      inter.data[0].related_person_id === person,
    JSON.stringify(inter.data),
  );
  const tp = await admin
    .from("marketing_ad_touchpoints")
    .select("id, confidence, person_id")
    .eq("tenant_id", T)
    .eq("event_id", EVT);
  ok(
    "exactly ONE attribution touchpoint exists with exact confidence",
    tp.data?.length === 1 && tp.data[0].confidence === "exact" && tp.data[0].person_id === person,
    JSON.stringify(tp.data),
  );

  // ── (3) RLS: viewer-without-view and tenant B read ZERO ───────────────────
  for (const table of ["marketing_ad_sources", "marketing_ad_events", "marketing_ad_touchpoints"]) {
    const v = await viewerC.from(table).select("id");
    ok(
      `a viewer WITHOUT marketing.view reads ZERO ${table} rows`,
      !v.error && v.data.length === 0,
      v.data?.length,
    );
  }
  const adminBC = await signIn(`adminb-${RUN}@p8-proof.test`);
  const cross = await adminBC.from("marketing_ad_sources").select("id").eq("tenant_id", T);
  ok(
    "a tenant-B admin reads ZERO tenant-A sources",
    !cross.error && cross.data.length === 0,
    cross.data?.length,
  );
  const crossRpc = await admin.rpc("marketing_ad_source_detail", {
    p_tenant: TB,
    p_source: SRC,
  });
  ok(
    "cross-tenant source detail is NOT_FOUND",
    crossRpc.error?.code === "P0002" || /not found/i.test(crossRpc.error?.message ?? ""),
    crossRpc.error?.code,
  );

  await cleanup();
  console.log(
    failed === 0 ? "\nALL PASS (real PostgREST boundary exercised)" : `\n${failed} FAILURES`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
