// Local end-to-end proof: telephony identity Discover → Review → Confirm.
//
// Exercises the REAL production functions (discoverTelephonyExtensionsFromActivity,
// computeTelephonyIdentityResolution) and the governed RPC (cp_review_identity) against the
// local Supabase stack — no mocks. Self-seeds a disposable tenant with realistic Drummonds
// caller-ID label patterns, proves the workflow, and cleans up after itself (idempotent).
//
// Run (local stack up):  node scripts/telephony-discovery-e2e.ts
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY override the local defaults below.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  discoverTelephonyExtensionsFromActivity,
  computeTelephonyIdentityResolution,
} from "../supabase/functions/_shared/controlplane/telephony_discovery.ts";
import { loadTenantWorkspace } from "../supabase/functions/_shared/controlplane/store.ts";

// Local-stack credentials — never hard-coded. Use env if provided, otherwise read them from
// the running local Supabase stack (`supabase status -o json`). No secret literal in the repo.
function localCreds(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return { url, key };
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
    const s = JSON.parse(out) as { API_URL?: string; SERVICE_ROLE_KEY?: string };
    return {
      url: url ?? s.API_URL ?? "http://127.0.0.1:54321",
      key: key ?? s.SERVICE_ROLE_KEY ?? "",
    };
  } catch {
    throw new Error(
      "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or run with the local Supabase stack up (npx supabase start).",
    );
  }
}
const { url: URL, key: KEY } = localCreds();
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const T = "11111111-1111-1111-1111-111111111111";
const ACTOR = "e2e-operator";

const CALLS = [
  { from: "Mary - Clients <103>", to: "07700900111", dir: "OUT", at: "2026-07-24T16:17:30Z" },
  { from: "Mary - Clients <103>", to: "07700900112", dir: "OUT", at: "2026-07-24T16:00:21Z" },
  { from: "07700900113", to: "Clients - Mary <103>", dir: "IN", at: "2026-07-10T09:00:00Z" },
  { from: "Rudi - Operations <106>", to: "01234567890", dir: "OUT", at: "2026-07-24T16:00:36Z" },
  { from: "Julie - Sandy <101>", to: "07700900114", dir: "OUT", at: "2026-07-01T09:00:00Z" },
  { from: "Heidi <101>", to: "07700900115", dir: "OUT", at: "2026-07-20T09:00:00Z" }, // reassigned
  { from: "Business Hours IVR <501>", to: "07700900116", dir: "IN", at: "2026-07-22T09:00:00Z" },
  { from: "07700900117", to: "anonymous", dir: "IN", at: "2026-07-22T10:00:00Z" }, // external
];

// Teardown runs through psql with session_replication_role=replica so it can clear the
// append-only identity-review history (whose trigger correctly blocks deletes over the API).
// This is a LOCAL dev helper only; production data is never touched by this path.
const PSQL_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_serviceos-dh";
function cleanup() {
  const sql =
    "set session_replication_role=replica;" +
    [
      "member_integration_identities",
      "endpoint_identity_reviews",
      "controlplane_change_log",
      "communication_endpoints",
      "phone_calls",
      "team_members",
    ]
      .map((t) => `delete from ${t} where tenant_id='${T}';`)
      .join("") +
    `delete from tenants where id='${T}';reset session_replication_role;`;
  try {
    execFileSync("docker", [
      "exec",
      PSQL_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-q",
      "-c",
      sql,
    ]);
  } catch (e) {
    console.warn("cleanup warning:", (e as Error).message);
  }
}

async function seed() {
  let r = await db
    .from("tenants")
    .insert({ id: T, slug: "e2e-drummond", display_name: "E2E Drummond" });
  assert.equal(r.error, null, `seed tenant: ${r.error?.message}`);
  const names = ["Mary", "Rudi", "Julie", "Liz", "Heidi", "Larne", "Tony", "Owner / MD"];
  const ins = await db
    .from("team_members")
    .insert(names.map((n) => ({ tenant_id: T, display_name: n })))
    .select("id, display_name");
  assert.equal(ins.error, null, `seed members: ${ins.error?.message}`);
  r = await db.from("phone_calls").insert(
    CALLS.map((c, i) => ({
      tenant_id: T,
      provider: "sipcentric",
      provider_call_id: "e2e-" + i,
      direction: c.dir,
      from_number: c.from,
      to_number: c.to,
      started_at: c.at,
      raw_payload: {},
    })),
  );
  assert.equal(r.error, null, `seed calls: ${r.error?.message}`);
  return ins.data!.find((m) => m.display_name === "Mary")!.id as string;
}

async function main() {
  cleanup();
  const maryId = await seed();

  // ── DISCOVER ──
  const disc = await discoverTelephonyExtensionsFromActivity(db, T, ACTOR);
  assert.equal(disc.extensions, 4, "derives exactly the 4 internal seats (101,103,106,501)");
  const eps = await db
    .from("communication_endpoints")
    .select("normalized_value")
    .eq("tenant_id", T)
    .eq("channel", "phone");
  assert.deepEqual(
    [...new Set((eps.data ?? []).map((e) => e.normalized_value))].sort(),
    ["101", "103", "106", "501"],
    "external legs (numbers / anonymous) are dropped",
  );
  assert.equal(
    (await discoverTelephonyExtensionsFromActivity(db, T, ACTOR)).created,
    0,
    "idempotent rerun",
  );

  // ── REVIEW ──
  const byExt = new Map(
    (await computeTelephonyIdentityResolution(db, T)).candidates.map((c) => [
      c.endpoint_extension,
      c,
    ]),
  );
  const mary = byExt.get("103")!;
  assert.equal(
    mary.confidence,
    "high",
    "Mary/103 is a HIGH-confidence candidate (not auto-confirmed)",
  );
  assert.equal(mary.suggested_member_id, maryId);
  assert.ok(
    mary.observed_labels.includes("Mary - Clients") && mary.call_count >= 3 && mary.last_activity,
  );
  assert.equal(
    byExt.get("101")!.confidence,
    "unresolved",
    "ext 101 ambiguous (reassigned Julie↔Heidi)",
  );
  assert.equal(byExt.get("101")!.ambiguity.length, 2);
  assert.equal(byExt.get("501")!.suggested_kind, "shared", "IVR is shared, never an individual");

  // ── PROJECTION: the telephony candidates flow through the workspace payload the frontend reads ──
  const ws = await loadTenantWorkspace(db, T);
  const wsCands = (ws.telephonyIdentityResolution?.candidates ?? []) as Array<{
    endpoint_extension: string;
    confidence: string;
  }>;
  const wsMary = wsCands.find((c) => c.endpoint_extension === "103");
  assert.ok(wsMary, "workspace payload surfaces the telephony candidates");
  assert.equal(wsMary!.confidence, "high", "workspace surfaces Mary/103 as a high candidate");
  assert.equal(
    (await db.from("member_integration_identities").select("id").eq("tenant_id", T)).data!.length,
    0,
    "no identity link before the operator confirms",
  );

  // ── CONFIRM (governed operator action) ──
  const conf = await db.rpc("cp_review_identity", {
    p_tenant: T,
    p_endpoint: mary.endpoint_id,
    p_decision: "confirmed_person",
    p_member: maryId,
    p_confidence: "high",
    p_evidence: { labels: mary.observed_labels, call_count: mary.call_count },
    p_actor: ACTOR,
    p_reason: "operator confirmed Mary → ext 103",
    p_correlation: "e2e-confirm",
    p_view_as: false,
  });
  assert.equal(conf.error, null, `confirm RPC: ${conf.error?.message}`);
  const link = (
    await db
      .from("member_integration_identities")
      .select("team_member_id, external_ref, verification_state")
      .eq("tenant_id", T)
  ).data!;
  assert.equal(link.length, 1, "exactly one governed identity link created");
  assert.equal(link[0].team_member_id, maryId);
  assert.equal(link[0].external_ref, "103");
  assert.equal(link[0].verification_state, "verified");

  const mary2 = (await computeTelephonyIdentityResolution(db, T)).candidates.find(
    (c) => c.endpoint_extension === "103",
  )!;
  assert.equal(
    mary2.provenance,
    "member_integration_identities",
    "103 now reads as a confirmed link",
  );
  assert.equal(
    (
      await db
        .from("controlplane_change_log")
        .select("action")
        .eq("tenant_id", T)
        .eq("action", "controlplane.identity.review")
    ).data!.length,
    1,
    "confirm wrote an immutable audit row",
  );

  cleanup();
  console.log(
    "✅ telephony Discover → Review → Confirm: all assertions passed (real fns + governed RPC, local stack)",
  );
}

main().catch(async (e) => {
  console.error("❌ FAILED:", e.message);
  cleanup();
  process.exit(1);
});
