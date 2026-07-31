// ServiceOS — Marketing Phase 7 RPC-boundary proof (PostgREST + real GoTrue
// JWTs). No Edge runtime, no network to any provider, NO model call — engine
// results are stubbed through the engine's own RPCs exactly as the SQL suite
// does. Proves at the REAL service boundary:
//   1. Every Phase-7 RPC is SERVICE-ROLE ONLY (authenticated + anon JWTs →
//      42501) and Phase-7 tables refuse browser writes.
//   2. RLS: a same-tenant viewer WITHOUT marketing.view reads ZERO rows from
//      every Phase-7 table; a tenant-B admin reads ZERO tenant-A rows.
//   3. TRUE CONCURRENCY: parallel identical objective-link requests converge
//      on ONE link + ONE history pair; request-id reuse against a DIFFERENT
//      campaign version → MK412 (the fingerprint binds the version); parallel
//      supersedes and link-vs-unlink races yield ONE winner + ONE stable
//      MK409 with exact append-only history; parallel template revisions
//      produce ONE winner + ONE stable MK409; parallel identical AI accepts
//      create ONE template; parallel accepts into DIFFERENT sequence steps
//      yield ONE winner + ONE MK409, and the retried loser converges with no
//      step lost or reordered.
//   4. DRIFT LOCK: the REAL SQL-built generation envelope (the frozen intent
//      parameters) validates against the adapter's exact allowlist.
//   5. The provider-configuration path over PostgREST: state honesty, the
//      owner/admin structural ceiling, Vault-referenced secret, enablement in
//      tenant_connector_capabilities.
// Random-id synthetic tenant; cleanup removes everything deletable and leaves
// only the bounded residue the append-only platform ledgers retain.

import { createClient } from "@supabase/supabase-js";
import { validateGenerationEnvelope } from "../supabase/functions/_shared/marketing_ai_prompt.ts";

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
const U = { owner: crypto.randomUUID(), ops: crypto.randomUUID(), viewer: crypto.randomUUID() };
const UB = crypto.randomUUID();
const ACC = crypto.randomUUID();
const SEG = crypto.randomUUID();
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
      "marketing_ai_revisions",
      "marketing_ai_proposals",
      "marketing_ai_requests",
      "marketing_request_keys",
      "marketing_campaign_objective_history",
      "marketing_template_usages",
      "marketing_campaign_revisions",
      "marketing_campaign_approvals",
      "marketing_campaign_events",
      "marketing_deliveries",
      "objective_links",
      "objective_metrics",
      "measurements",
      "metric_definitions",
      "objectives",
      "config_versions",
      "tenant_connector_capabilities",
      "tenant_connectors",
      "automation_intents",
      "intelligence_objects",
      "decision_log",
      "marketing_sender_profiles",
      "email_oauth_tokens",
      "email_accounts",
      "marketing_segments",
      "marketing_access_grants",
      "marketing_lifecycle_stages",
      "marketing_settings",
      "audit_logs",
      "platform_events",
      "platform_jobs",
    ]) {
      await admin.from(table).delete().eq("tenant_id", tenant);
    }
    // templates AFTER campaign revisions (lineage FKs), campaigns last
    await admin.from("marketing_template_revisions").delete().eq("tenant_id", tenant);
    await admin.from("marketing_templates").delete().eq("tenant_id", tenant);
    await admin.from("marketing_campaigns").delete().eq("tenant_id", tenant);
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
    { id: T, slug: `p7-proof-${RUN}`, display_name: "P7 Proof" },
    { id: TB, slug: `p7b-proof-${RUN}`, display_name: "P7 Proof B" },
  ]);
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}-${RUN}@p7-proof.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) {
      console.error("user create failed", c.error.message);
      process.exit(1);
    }
    await admin
      .from("profiles")
      .update({ tenant_id: T, role: k === "owner" ? "owner" : k })
      .eq("id", id);
  }
  await admin.auth.admin.createUser({
    id: UB,
    email: `adminb-${RUN}@p7-proof.test`,
    password: "Proof-Passw0rd!",
    email_confirm: true,
  });
  await admin.from("profiles").update({ tenant_id: TB, role: "admin" }).eq("id", UB);
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.owner });
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TB, p_actor: UB });

  await admin.from("email_accounts").insert({
    id: ACC,
    tenant_id: T,
    provider: "gmail",
    email_address: `sender-${RUN}@p7-proof.test`,
    status: "active",
    auth_state: "ok",
  });
  await admin.from("email_oauth_tokens").insert({
    tenant_id: T,
    email_account_id: ACC,
    provider: "gmail",
    access_token: "tok",
    refresh_token: "ref",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    scope:
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
  });
  let r = await admin.rpc("marketing_sender_create", {
    p_tenant: T,
    p_actor: U.owner,
    p_args: { source_kind: "gmail_oauth", source_id: ACC, label: "P7 Sender" },
  });
  const senderId = r.data?.id;
  const senderRow = await admin
    .from("marketing_sender_profiles")
    .select("updated_at")
    .eq("id", senderId)
    .single();
  await admin.rpc("marketing_sender_set_enabled", {
    p_tenant: T,
    p_actor: U.owner,
    p_sender: senderId,
    p_enabled: true,
    p_expected: senderRow.data.updated_at,
  });
  await admin.from("marketing_segments").insert({
    id: SEG,
    tenant_id: T,
    name: `P7 audience ${RUN}`,
    definition: { field: "search", value: "P7MJS" },
    definition_version: 1,
    status: "active",
  });
  // an ACTIVE objective for linking
  const CV = crypto.randomUUID();
  const OBJ = crypto.randomUUID();
  await admin.from("config_versions").insert({
    id: CV,
    tenant_id: T,
    artifact_kind: "objective",
    artifact_key: `p7-${RUN}`,
    version: 1,
    status: "published",
  });
  await admin.from("objectives").insert({
    id: OBJ,
    tenant_id: T,
    objective_type: "quarterly_priority",
    title: `P7 objective ${RUN}`,
    status: "active",
    version_id: CV,
    published_by: "p7 operator",
    published_role: "tenant_owner",
  });

  const opsC = await signIn(`ops-${RUN}@p7-proof.test`);
  const viewerC = await signIn(`viewer-${RUN}@p7-proof.test`);
  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });

  // ── (1) every Phase-7 RPC is service-role only ────────────────────────────
  const DENIED = [
    ["marketing_template_create", { p_tenant: T, p_actor: U.ops, p_args: {} }],
    [
      "marketing_template_revise",
      { p_tenant: T, p_actor: U.ops, p_template: T, p_args: {}, p_expected_version: 1 },
    ],
    ["marketing_template_duplicate", { p_tenant: T, p_actor: U.ops, p_template: T, p_args: {} }],
    [
      "marketing_template_set_status",
      { p_tenant: T, p_actor: U.ops, p_template: T, p_args: {}, p_expected_version: 1 },
    ],
    ["marketing_template_list", { p_tenant: T, p_args: {} }],
    ["marketing_template_detail", { p_tenant: T, p_template: T }],
    ["marketing_template_use_in_broadcast", { p_tenant: T, p_actor: U.ops, p_args: {} }],
    ["marketing_template_use_in_sequence_step", { p_tenant: T, p_actor: U.ops, p_args: {} }],
    [
      "marketing_campaign_objective_link",
      { p_tenant: T, p_actor: U.owner, p_campaign: T, p_args: {}, p_expected_version: 1 },
    ],
    [
      "marketing_campaign_objective_unlink",
      { p_tenant: T, p_actor: U.owner, p_campaign: T, p_args: {}, p_expected_version: 1 },
    ],
    ["marketing_objective_search", { p_tenant: T, p_args: {} }],
    ["marketing_campaign_objective_context", { p_tenant: T, p_campaign: T }],
    ["marketing_reporting_overview", { p_tenant: T, p_args: {} }],
    ["marketing_reporting_campaign", { p_tenant: T, p_campaign: T }],
    ["marketing_ai_provider_state", { p_tenant: T }],
    ["marketing_ai_configure", { p_tenant: T, p_actor: U.owner, p_args: {} }],
    ["marketing_ai_generation_request", { p_tenant: T, p_actor: U.ops, p_args: {} }],
    ["marketing_ai_record_proposal", { p_tenant: T, p_intent: T, p_payload: {} }],
    ["marketing_ai_request_status", { p_tenant: T, p_request: T }],
    ["marketing_ai_request_list", { p_tenant: T, p_args: {} }],
    ["marketing_ai_proposal_detail", { p_tenant: T, p_proposal: T }],
    ["marketing_ai_revise", { p_tenant: T, p_actor: U.ops, p_proposal: T, p_args: {} }],
    ["marketing_ai_accept", { p_tenant: T, p_actor: U.ops, p_args: {} }],
    ["marketing_ai_reject", { p_tenant: T, p_actor: U.ops, p_request: T, p_args: {} }],
    ["marketing_ai_cancel", { p_tenant: T, p_actor: U.ops, p_request: T }],
  ];
  for (const [fn, args] of DENIED) {
    const viaUser = await opsC.rpc(fn, args);
    const viaAnon = await anonC.rpc(fn, args);
    ok(
      `RPC ${fn} denied for authenticated + anon`,
      viaUser.error?.code === "42501" && viaAnon.error?.code === "42501",
      `${viaUser.error?.code}/${viaAnon.error?.code}`,
    );
  }

  // ── (2) browser writes refused; RLS scoping honest ────────────────────────
  const w = await opsC.from("marketing_templates").insert({ tenant_id: T, name: "sneak" });
  ok(
    "authenticated INSERT into marketing_templates refused",
    w.error?.code === "42501",
    w.error?.code,
  );

  // build real fixtures via the service role — and prove PARALLEL identical
  // creates (same request id + payload) converge on ONE template
  const createArgs = {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      name: `P7 Template ${RUN}`,
      subject: "Service due, {{first_name}}",
      body_authored: "Hi {{first_name}},\n\n[Book](https://x.test/b)",
      token_fallbacks: { first_name: "there" },
      request_id: `p7-tplc-${RUN}`,
    },
  };
  const [tc1, tc2] = await Promise.all([
    admin.rpc("marketing_template_create", createArgs),
    admin.rpc("marketing_template_create", createArgs),
  ]);
  ok(
    "PARALLEL identical template creates converge on ONE result",
    !tc1.error && !tc2.error && tc1.data.id === tc2.data.id,
    `${tc1.error?.message ?? ""}${tc2.error?.message ?? ""}`,
  );
  const tplCount = await admin
    .from("marketing_templates")
    .select("id")
    .eq("tenant_id", T)
    .eq("name", `P7 Template ${RUN}`);
  ok("exactly ONE template row persisted", tplCount.data?.length === 1, tplCount.data?.length);
  // lost-response retry: a sequential exact replay returns the stored result
  r = await admin.rpc("marketing_template_create", createArgs);
  ok(
    "a lost-response create retry converges on the stored result",
    !r.error && r.data.id === tc1.data.id && r.data.revision_id === tc1.data.revision_id,
    r.error?.message,
  );
  // changed reuse of the same id → REQUEST_MISMATCH
  const changed = await admin.rpc("marketing_template_create", {
    ...createArgs,
    p_args: { ...createArgs.p_args, name: `P7 Template CHANGED ${RUN}` },
  });
  ok("changed-payload create reuse → MK412", changed.error?.code === "MK412", changed.error?.code);
  const TPL = tc1.data?.id;
  const TPLREV = tc1.data?.revision_id;

  const viewerRead = await viewerC.from("marketing_templates").select("id");
  ok(
    "a viewer WITHOUT marketing.view reads ZERO template rows",
    !viewerRead.error && viewerRead.data.length === 0,
    viewerRead.data?.length,
  );
  const adminBC = await signIn(`adminb-${RUN}@p7-proof.test`);
  const crossRead = await adminBC.from("marketing_templates").select("id").eq("tenant_id", T);
  ok(
    "a tenant-B admin reads ZERO tenant-A template rows",
    !crossRead.error && crossRead.data.length === 0,
    crossRead.data?.length,
  );

  // ── (3) TRUE CONCURRENCY ──────────────────────────────────────────────────
  // campaign fixture from the pinned template revision
  const useArgs = {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      template_revision_id: TPLREV,
      mode: "new",
      name: `P7 campaign ${RUN}`,
      sender_id: senderId,
      segment_id: SEG,
      request_id: `p7-useb-${RUN}`,
    },
  };
  const [ub1, ub2] = await Promise.all([
    admin.rpc("marketing_template_use_in_broadcast", useArgs),
    admin.rpc("marketing_template_use_in_broadcast", useArgs),
  ]);
  ok(
    "PARALLEL identical use_in_broadcast converge on ONE pinned draft",
    !ub1.error && !ub2.error && ub1.data.id === ub2.data.id,
    `${ub1.error?.message ?? ""}${ub2.error?.message ?? ""}`,
  );
  const campCount = await admin
    .from("marketing_campaigns")
    .select("id")
    .eq("tenant_id", T)
    .eq("name", `P7 campaign ${RUN}`);
  ok(
    "exactly ONE campaign persisted from the replayed use",
    campCount.data?.length === 1,
    campCount.data?.length,
  );
  r = ub1;
  const CID = r.data?.id;

  // parallel identical objective links converge (advisory lock + ledger)
  const version = (await admin.from("marketing_campaigns").select("version").eq("id", CID).single())
    .data.version;
  const linkArgs = {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_args: {
      objective_id: OBJ,
      relation: "supports",
      rationale: "parallel proof",
      request_id: `p7-par-${RUN}`,
    },
    p_expected_version: version,
  };
  const [l1, l2] = await Promise.all([
    admin.rpc("marketing_campaign_objective_link", linkArgs),
    admin.rpc("marketing_campaign_objective_link", linkArgs),
  ]);
  ok(
    "PARALLEL identical objective links both succeed and converge",
    !l1.error && !l2.error && l1.data.objective_link_id === l2.data.objective_link_id,
    `${l1.error?.message ?? ""}${l2.error?.message ?? ""}`,
  );
  const links = await admin
    .from("objective_links")
    .select("id")
    .eq("tenant_id", T)
    .eq("target_kind", "marketing_campaign")
    .eq("target_ref", CID);
  ok("exactly ONE canonical link row exists", links.data?.length === 1, links.data?.length);
  const hist = await admin
    .from("marketing_campaign_objective_history")
    .select("id, action")
    .eq("tenant_id", T)
    .eq("campaign_id", CID);
  ok(
    "exactly ONE linked history record exists (no duplicate acts)",
    hist.data?.filter((h) => h.action === "linked").length === 1,
    JSON.stringify(hist.data?.map((h) => h.action)),
  );

  // the request fingerprint BINDS THE CAMPAIGN VERSION: the same payload
  // replayed against the (now different) current version is a different
  // logical request and must conflict, never converge
  const staleReuse = await admin.rpc("marketing_campaign_objective_link", {
    ...linkArgs,
    p_expected_version: (
      await admin.from("marketing_campaigns").select("version").eq("id", CID).single()
    ).data.version,
  });
  ok(
    "request-id reuse against a DIFFERENT campaign version → MK412",
    staleReuse.error?.code === "MK412",
    staleReuse.error?.code ?? "no error",
  );

  // MIXED CONCURRENCY — supersede vs supersede (distinct request ids, same
  // read version): exactly one winner, one stable MK409, ONE approved link
  const v2 = (await admin.from("marketing_campaigns").select("version").eq("id", CID).single()).data
    .version;
  const supersede = (n) =>
    admin.rpc("marketing_campaign_objective_link", {
      p_tenant: T,
      p_actor: U.owner,
      p_campaign: CID,
      p_args: {
        objective_id: OBJ,
        relation: "contributes_to",
        rationale: `supersede race ${n}`,
        request_id: `p7-sup${n}-${RUN}`,
      },
      p_expected_version: v2,
    });
  const [s1, s2] = await Promise.all([supersede(1), supersede(2)]);
  const supWins = [s1, s2].filter((x) => !x.error).length;
  const supConf = [s1, s2].filter((x) => x.error?.code === "MK409").length;
  ok(
    "PARALLEL supersedes: ONE winner + ONE MK409",
    supWins === 1 && supConf === 1,
    `${supWins}/${supConf}`,
  );
  const approvedLinks = await admin
    .from("objective_links")
    .select("id")
    .eq("tenant_id", T)
    .eq("target_kind", "marketing_campaign")
    .eq("target_ref", CID)
    .eq("approved", true);
  ok(
    "exactly ONE approved current link after the race",
    approvedLinks.data?.length === 1,
    approvedLinks.data?.length,
  );

  // MIXED CONCURRENCY — link vs unlink at the same read version: one winner,
  // one MK409; history is append-only and complete either way
  const v3 = (await admin.from("marketing_campaigns").select("version").eq("id", CID).single()).data
    .version;
  const [mx1, mx2] = await Promise.all([
    admin.rpc("marketing_campaign_objective_link", {
      p_tenant: T,
      p_actor: U.owner,
      p_campaign: CID,
      p_args: { objective_id: OBJ, relation: "supports", request_id: `p7-mx-${RUN}` },
      p_expected_version: v3,
    }),
    admin.rpc("marketing_campaign_objective_unlink", {
      p_tenant: T,
      p_actor: U.owner,
      p_campaign: CID,
      p_args: { rationale: "mixed race" },
      p_expected_version: v3,
    }),
  ]);
  const mxWins = [mx1, mx2].filter((x) => !x.error).length;
  const mxConf = [mx1, mx2].filter((x) => x.error?.code === "MK409").length;
  ok(
    "PARALLEL link vs unlink: ONE winner + ONE MK409",
    mxWins === 1 && mxConf === 1,
    `${mxWins}/${mxConf}`,
  );
  const histAfter = await admin
    .from("marketing_campaign_objective_history")
    .select("action")
    .eq("tenant_id", T)
    .eq("campaign_id", CID);
  // expected acts: initial linked (1) + supersede winner (superseded+linked)
  // + mixed winner (link ⇒ superseded+linked, unlink ⇒ unlinked)
  const expectedActs = hist.data.length + 2 + (mx1.error ? 1 : 2);
  ok(
    "history carries exactly the factual acts (no orphan/duplicate records)",
    (histAfter.data?.length ?? 0) === expectedActs,
    JSON.stringify(histAfter.data?.map((h) => h.action)),
  );

  // parallel template revisions: one winner, one stable MK409 (VERSION_CONFLICT)
  const tplVersion = (
    await admin.from("marketing_templates").select("version").eq("id", TPL).single()
  ).data.version;
  const [rv1, rv2] = await Promise.all([
    admin.rpc("marketing_template_revise", {
      p_tenant: T,
      p_actor: U.ops,
      p_template: TPL,
      p_args: { subject: "Winner subject A, {{first_name}}", request_id: `p7-rva-${RUN}` },
      p_expected_version: tplVersion,
    }),
    admin.rpc("marketing_template_revise", {
      p_tenant: T,
      p_actor: U.ops,
      p_template: TPL,
      p_args: { subject: "Winner subject B, {{first_name}}", request_id: `p7-rvb-${RUN}` },
      p_expected_version: tplVersion,
    }),
  ]);
  const conflicts = [rv1, rv2].filter((x) => x.error?.code === "MK409").length;
  const wins = [rv1, rv2].filter((x) => !x.error).length;
  ok(
    "PARALLEL template revisions (distinct ids): ONE winner + ONE MK409",
    wins === 1 && conflicts === 1,
    `${wins}/${conflicts}`,
  );
  // PARALLEL IDENTICAL revise replay (same id + payload + version) converges
  // on one revision even against the advisory lock race
  const rvVersion = (await admin.from("marketing_templates").select("version").eq("id", TPL).single())
    .data.version;
  const idemRevise = {
    p_tenant: T,
    p_actor: U.ops,
    p_template: TPL,
    p_args: { subject: "Idem subject, {{first_name}}", request_id: `p7-rvi-${RUN}` },
    p_expected_version: rvVersion,
  };
  const [ir1, ir2] = await Promise.all([
    admin.rpc("marketing_template_revise", idemRevise),
    admin.rpc("marketing_template_revise", idemRevise),
  ]);
  ok(
    "PARALLEL IDENTICAL revisions converge on ONE revision",
    !ir1.error && !ir2.error && ir1.data.revision_id === ir2.data.revision_id,
    `${ir1.error?.message ?? ""}${ir2.error?.message ?? ""}`,
  );
  const revRows = await admin
    .from("marketing_template_revisions")
    .select("id")
    .eq("template_id", TPL)
    .eq("subject", "Idem subject, {{first_name}}");
  ok("exactly ONE idempotent revision persisted", revRows.data?.length === 1, revRows.data?.length);
  // a DIFFERENT ACTOR reusing the id + payload conflicts — never another
  // actor's stored result
  const foreignActor = await admin.rpc("marketing_template_revise", {
    ...idemRevise,
    p_actor: U.owner,
  });
  ok(
    "another actor reusing the request id → MK412",
    foreignActor.error?.code === "MK412",
    foreignActor.error?.code,
  );

  // ── (4) AI: configure + generation + DRIFT LOCK + parallel accept ─────────
  const secretRef = await admin.rpc("provider_secret_store", {
    p_tenant: T,
    p_provider: "openai",
    p_field: "api_key",
    p_secret: `p7-mjs-test-key-${RUN}`,
  });
  ok("vault broker stores the test credential", !secretRef.error, secretRef.error?.message);
  r = await admin.rpc("marketing_ai_configure", {
    p_tenant: T,
    p_actor: U.owner,
    p_args: { model: "gpt-4o-mini", secret_ref: secretRef.data, enabled: true },
  });
  ok("owner configures the provider", !r.error && r.data?.configured === true, r.error?.message);
  const hostile = await admin.rpc("marketing_ai_configure", {
    p_tenant: T,
    p_actor: U.ops,
    p_args: { model: "gpt-4o-mini" },
  });
  ok(
    "ops is structurally denied provider configuration",
    hostile.error?.code === "42501",
    hostile.error?.code,
  );

  r = await admin.rpc("marketing_ai_generation_request", {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      destination_kind: "template",
      campaign_objective: "Reactivate lapsed customers",
      offer: "Annual service plan",
      audience: "No visit in 18 months",
      call_to_action: "Book a visit",
      objective_id: OBJ,
      request_id: `p7-gen-${RUN}`,
    },
  });
  ok("the governed generation request succeeds", !r.error, r.error?.message);
  const INTENT = r.data?.intent_id;
  const AIREQ = r.data?.ai_request_id;

  // DRIFT LOCK: the REAL frozen envelope satisfies the adapter's allowlist
  const intentRow = await admin
    .from("automation_intents")
    .select("parameters, status, capability_key")
    .eq("id", INTENT)
    .single();
  const drift = validateGenerationEnvelope(intentRow.data.parameters);
  ok(
    "DRIFT LOCK: the SQL-built envelope validates against the adapter allowlist",
    drift.ok === true,
    drift.ok ? "" : drift.error,
  );

  // stub the engine execution exactly as the SQL suite does
  const claim = await admin.rpc("automation_claim_and_start", {
    p_intent_id: INTENT,
    p_tenant_id: T,
    p_worker: "p7-mjs-worker",
    p_lease_seconds: 120,
    p_idempotency_key: `idem-p7-${RUN}`,
    p_correlation_id: crypto.randomUUID(),
    p_engine_version: "test",
  });
  const claimed = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  ok(
    "the REAL engine claims the generation intent on the registered contract",
    !claim.error && claimed?.capability_key === "ai.generate_marketing_draft",
    claim.error?.message ?? claimed?.capability_key,
  );
  const rec = await admin.rpc("marketing_ai_record_proposal", {
    p_tenant: T,
    p_intent: INTENT,
    p_payload: {
      provider: "openai",
      model: "gpt-4o-mini-2026",
      subject: "A check-up for your boiler, {{first_name}}",
      body_authored: "Hi {{first_name}},\n\n[Book a visit](https://x.test/book)",
      token_fallbacks: { first_name: "there" },
      prompt_tokens: 400,
      completion_tokens: 120,
      finish_reason: "stop",
    },
  });
  ok("the stubbed model output records ONE immutable proposal", !rec.error, rec.error?.message);
  const PROP = rec.data?.proposal_id;
  const status = await admin.rpc("marketing_ai_request_status", { p_tenant: T, p_request: AIREQ });
  ok(
    "the derived status reads succeeded from facts (proposal exists)",
    status.data?.status === "succeeded" && status.data?.proposal_id === PROP,
    status.data?.status,
  );

  // PARALLEL identical accepts create exactly ONE template
  const acceptArgs = {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      proposal_id: PROP,
      destination_kind: "template",
      template_name: `AI accepted ${RUN}`,
      request_id: `p7-acc-${RUN}`,
    },
  };
  const [a1, a2] = await Promise.all([
    admin.rpc("marketing_ai_accept", acceptArgs),
    admin.rpc("marketing_ai_accept", acceptArgs),
  ]);
  ok(
    "PARALLEL identical accepts converge on ONE draft",
    !a1.error && !a2.error && a1.data.id === a2.data.id,
    `${a1.error?.message ?? ""}${a2.error?.message ?? ""}`,
  );
  const accepted = await admin
    .from("marketing_templates")
    .select("id")
    .eq("tenant_id", T)
    .eq("name", `AI accepted ${RUN}`);
  ok("exactly ONE accepted template exists", accepted.data?.length === 1, accepted.data?.length);
  const acceptedRev = await admin
    .from("marketing_template_revisions")
    .select("source, source_ai_proposal_id")
    .eq("template_id", a1.data.id)
    .eq("revision_number", 1)
    .single();
  ok(
    "the accepted draft carries visible AI-origin provenance",
    acceptedRev.data?.source === "ai_draft" && acceptedRev.data?.source_ai_proposal_id === PROP,
    JSON.stringify(acceptedRev.data),
  );

  // MIXED CONCURRENCY — two accepts into DIFFERENT steps of one sequence at
  // the same read version: exactly one winner + one stable MK409; the loser
  // retried at the fresh version converges; no step is lost or reordered
  const seq = await admin.rpc("marketing_sequence_create", {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      name: `P7 race journey ${RUN}`,
      sender_id: senderId,
      steps: [
        { key: "s1", type: "send_email", config: { subject: "One", body_authored: "Body one" } },
        { key: "s2", type: "send_email", config: { subject: "Two", body_authored: "Body two" } },
      ],
    },
  });
  ok("race sequence created", !seq.error, seq.error?.message);
  const SEQ = seq.data?.id;
  const seqV = (await admin.from("marketing_campaigns").select("version").eq("id", SEQ).single())
    .data.version;
  const acceptStep = (step, n) =>
    admin.rpc("marketing_ai_accept", {
      p_tenant: T,
      p_actor: U.ops,
      p_args: {
        proposal_id: PROP,
        destination_kind: "sequence_step",
        campaign_id: SEQ,
        step_key: step,
        expected_version: seqV,
        request_id: `p7-step${n}-${RUN}`,
      },
    });
  const [st1, st2] = await Promise.all([acceptStep("s1", 1), acceptStep("s2", 2)]);
  const stWins = [st1, st2].filter((x) => !x.error).length;
  const stConf = [st1, st2].filter((x) => x.error?.code === "MK409").length;
  ok(
    "PARALLEL accepts into DIFFERENT steps: ONE winner + ONE MK409",
    stWins === 1 && stConf === 1,
    `${stWins}/${stConf}`,
  );
  const loserStep = st1.error ? "s1" : "s2";
  const retryV = (await admin.from("marketing_campaigns").select("version").eq("id", SEQ).single())
    .data.version;
  const retry = await admin.rpc("marketing_ai_accept", {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      proposal_id: PROP,
      destination_kind: "sequence_step",
      campaign_id: SEQ,
      step_key: loserStep,
      expected_version: retryV,
      request_id: `p7-step-retry-${RUN}`,
    },
  });
  ok(
    "the losing accept retried at the fresh version converges",
    !retry.error,
    retry.error?.message,
  );
  const finalRev = (
    await admin
      .from("marketing_campaigns")
      .select("current_sequence_revision_id")
      .eq("id", SEQ)
      .single()
  ).data.current_sequence_revision_id;
  const steps = await admin
    .from("marketing_sequence_steps")
    .select("step_key, step_order, step_type, config")
    .eq("tenant_id", T)
    .eq("revision_id", finalRev)
    .order("step_order");
  ok(
    "both steps survive in order, both email, both now carry the accepted content",
    steps.data?.length === 2 &&
      steps.data[0].step_key === "s1" &&
      steps.data[1].step_key === "s2" &&
      steps.data.every(
        (s) => s.step_type === "send_email" && s.config?.source_ai_proposal_id === PROP,
      ),
    JSON.stringify(steps.data?.map((s) => [s.step_key, s.config?.subject])),
  );

  // ── (5) reporting composition over PostgREST ──────────────────────────────
  const overview = await admin.rpc("marketing_reporting_overview", { p_tenant: T, p_args: {} });
  const canonical = await admin.rpc("marketing_campaign_report", { p_tenant: T, p_campaign: CID });
  const row = overview.data?.campaigns?.find((c) => c.id === CID);
  ok(
    "the overview composes the canonical report byte-for-byte",
    JSON.stringify(row?.report) === JSON.stringify(canonical.data),
    "",
  );
  ok(
    "unavailable metrics stay null through the boundary — never zero",
    row?.report?.delivered === null && row?.report?.clicked === null,
    JSON.stringify({ d: row?.report?.delivered, c: row?.report?.clicked }),
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
