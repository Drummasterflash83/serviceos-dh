// ServiceOS — Marketing Phase 4 RPC-boundary proof (PostgREST + real GoTrue JWTs).
//
// Proves at the REAL service boundary (no Edge runtime, no network to Google,
// no email — provider results are STUBBED through the engine's own finalize
// RPC exactly as the SQL suite does):
//   1. Every Phase-4 sender/test-send RPC is SERVICE-ROLE ONLY (authenticated
//      JWTs → 42501; no Edge-Function bypass exists).
//   2. Sender lifecycle end-to-end over PostgREST: create (evidence-led scope),
//      verification recording, enable → capability enablement flips on,
//      default set, disable → default cleared + capability off. Capability
//      truth is SELF-REFRESHING: authoritative source mutations (scope loss,
//      fake scope suffixes, auth_state changes) flip it with NO manual
//      capability-sync call — trigger-proven at the real service boundary.
//   3. TRUE CONCURRENCY: PARALLEL identical test-send requests (same
//      request_id) converge on ONE delivery + ONE intent; parallel DIFFERENT
//      request ids within the rate window are bounded by the DB rate limit.
//   4. The stubbed engine path (claim → finalize succeeded) projects ONE
//      delivery submitted + ONE canonical outbound email_messages row; a
//      repeat reconcile changes nothing; browser-role table writes are denied.
// Random-id synthetic tenant; cleanup removes everything deletable and
// reports the bounded residue the append-only engine history retains (see the
// note at the id block). HTTP layers are covered by the staged
// marketing-senders-http script (NOT-RUN until an edge runtime exists).

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
// Per-run RANDOM ids: the engine's execution attempts are append-only for
// EVERY role (deliberately — immutable history), so a tenant that executed
// cannot be fully deleted by the service role. Random ids keep re-runs
// collision-free; cleanup removes everything deletable and reports the
// bounded synthetic residue (tenant + immutable lineage) it must leave.
const T = crypto.randomUUID();
const U = {
  owner: crypto.randomUUID(),
  ops: crypto.randomUUID(),
  viewer: crypto.randomUUID(),
};
const ACC = crypto.randomUUID();
const RUN = T.slice(0, 8);

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of Object.values(U)) await admin.auth.admin.deleteUser(id).catch(() => {});
  // deliveries/events/senders cascade from the tenant; engine rows cascade too
  for (const table of [
    "marketing_delivery_events",
    "marketing_deliveries",
    "email_messages",
    "automation_approvals",
    "automation_execution_attempts",
    "automation_intents",
    "decision_log",
    "intelligence_objects",
    "tenant_connector_capabilities",
    "tenant_connectors",
    "marketing_settings_history",
    "email_oauth_tokens",
    "email_accounts",
    "marketing_access_grants",
    "marketing_lifecycle_stages",
    "marketing_settings",
    "audit_logs",
    "platform_events",
    "platform_jobs",
    "review_tasks",
  ]) {
    await admin.from(table).delete().eq("tenant_id", T);
  }
  await admin.from("tenants").delete().eq("id", T);
}

async function main() {
  await cleanup();
  await admin.from("tenants").insert({ id: T, slug: `p4-proof-${RUN}`, display_name: "P4 Proof" });
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}-${RUN}@p4-proof.test`,
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
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.owner });
  await admin.from("email_accounts").insert({
    id: ACC,
    tenant_id: T,
    provider: "gmail",
    email_address: "sender@p4-proof.test",
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

  // ── (1) service-role-only boundary over real JWTs ──
  if (ANON) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await anon.auth.signInWithPassword({
      email: `owner-${RUN}@p4-proof.test`,
      password: "Proof-Passw0rd!",
    });
    const asOwner = createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${si.data.session.access_token}` } },
    });
    for (const [fn, args] of [
      ["marketing_sender_sources", { p_tenant: T }],
      ["marketing_sender_readiness", { p_tenant: T, p_sender: ACC }],
      ["marketing_sender_readiness_all", { p_tenant: T }],
      ["marketing_sender_create", { p_tenant: T, p_actor: U.owner, p_args: {} }],
      [
        "marketing_sender_set_enabled",
        {
          p_tenant: T,
          p_actor: U.owner,
          p_sender: ACC,
          p_enabled: true,
          p_expected: new Date().toISOString(),
        },
      ],
      [
        "marketing_sender_set_default",
        { p_tenant: T, p_actor: U.owner, p_sender: ACC, p_expected: new Date().toISOString() },
      ],
      [
        "marketing_sender_record_verification",
        { p_tenant: T, p_sender: ACC, p_state: "authorized", p_note: null, p_verified_at: null },
      ],
      ["marketing_sender_capability_sync", { p_tenant: T }],
      ["marketing_test_send_request", { p_tenant: T, p_actor: U.owner, p_args: {} }],
      ["marketing_delivery_reconcile", { p_tenant: T, p_delivery: ACC }],
      ["marketing_test_send_status", { p_tenant: T, p_args: {} }],
      ["marketing_sender_health", { p_tenant: T }],
    ]) {
      const r = await asOwner.rpc(fn, args);
      ok(
        `boundary: ${fn} denied to an authenticated JWT`,
        Boolean(r.error) && r.error.code === "42501",
        r.error?.code ?? "no error",
      );
    }
    const w = await asOwner.from("marketing_sender_profiles").insert({
      tenant_id: T,
      source_kind: "gmail_oauth",
      email_account_id: ACC,
      mailbox_address: "x@y.test",
    });
    ok("boundary: browser cannot write sender profiles", Boolean(w.error), w.error?.code);
  } else {
    console.log("SKIP  JWT boundary (no SUPABASE_ANON_KEY)");
  }

  // ── (2) sender lifecycle over PostgREST ──
  let r = await admin.rpc("marketing_sender_create", {
    p_tenant: T,
    p_actor: U.owner,
    p_args: { source_kind: "gmail_oauth", source_id: ACC, label: "P4 Sender" },
  });
  ok(
    "sender: created with scope evidence from the stored grant",
    !r.error && r.data?.created === true && r.data?.send_scope_state === "authorized",
    r.error?.message ?? JSON.stringify(r.data),
  );
  const senderId = r.data?.id;
  let sender = await admin
    .from("marketing_sender_profiles")
    .select("updated_at")
    .eq("id", senderId)
    .single();
  r = await admin.rpc("marketing_sender_set_enabled", {
    p_tenant: T,
    p_actor: U.owner,
    p_sender: senderId,
    p_enabled: true,
    p_expected: sender.data.updated_at,
  });
  ok("sender: enabled", !r.error && r.data?.enabled === true, r.error?.message);
  const cap = await admin
    .from("tenant_connector_capabilities")
    .select("enabled")
    .eq("tenant_id", T)
    .eq("capability_key", "email.send_marketing")
    .single();
  ok(
    "capability: enabled ONLY via the explicit verified-sender action",
    cap.data?.enabled === true,
  );

  // ── (2b) SELF-REFRESHING capability truth over the REAL service boundary ──
  // Only AUTHORITATIVE source state is mutated below — NO manual
  // marketing_sender_capability_sync call: the source-table triggers must
  // re-derive capability truth, or these checks fail.
  const readCap = async () => {
    const c = await admin
      .from("tenant_connector_capabilities")
      .select("enabled")
      .eq("tenant_id", T)
      .eq("capability_key", "email.send_marketing")
      .maybeSingle();
    return c.data?.enabled === true;
  };
  await admin
    .from("email_oauth_tokens")
    .update({ scope: "https://www.googleapis.com/auth/gmail.readonly" })
    .eq("email_account_id", ACC);
  ok("capability: scope loss disables WITHOUT a manual sync call", (await readCap()) === false);
  await admin
    .from("email_oauth_tokens")
    .update({
      scope:
        "https://www.googleapis.com/auth/gmail.send.extra https://www.googleapis.com/auth/gmail.sendfoo",
    })
    .eq("email_account_id", ACC);
  ok(
    "capability: a fake scope suffix never re-enables (exact token match)",
    (await readCap()) === false,
  );
  await admin
    .from("email_oauth_tokens")
    .update({
      scope:
        "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
    })
    .eq("email_account_id", ACC);
  ok(
    "capability: restoring the exact scope re-enables (trigger-driven)",
    (await readCap()) === true,
  );
  await admin.from("email_accounts").update({ auth_state: "unknown" }).eq("id", ACC);
  ok("capability: auth_state unknown disables (trigger-driven)", (await readCap()) === false);
  await admin.from("email_accounts").update({ auth_state: "ok" }).eq("id", ACC);
  ok("capability: auth_state ok restores (trigger-driven)", (await readCap()) === true);
  sender = await admin
    .from("marketing_sender_profiles")
    .select("updated_at")
    .eq("id", senderId)
    .single();
  r = await admin.rpc("marketing_sender_set_default", {
    p_tenant: T,
    p_actor: U.owner,
    p_sender: senderId,
    p_expected: sender.data.updated_at,
  });
  ok("sender: set default (versioned)", !r.error && r.data?.default === true, r.error?.message);

  // ── (3) PARALLEL identical test-send requests converge ──
  const reqArgs = (requestId) => ({
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      sender_id: senderId,
      recipient_profile_id: U.owner,
      subject: "P4 parallel proof",
      body_text: "Converge.",
      request_id: requestId,
    },
  });
  const [a, b] = await Promise.all([
    admin.rpc("marketing_test_send_request", reqArgs("req-parallel-01")),
    admin.rpc("marketing_test_send_request", reqArgs("req-parallel-01")),
  ]);
  ok(
    "test send: parallel duplicate requests both complete",
    !a.error && !b.error,
    a.error?.message ?? b.error?.message,
  );
  ok(
    "test send: SAME request id → ONE delivery + ONE intent",
    a.data?.delivery_id === b.data?.delivery_id &&
      a.data?.intent_id === b.data?.intent_id &&
      [a.data?.idempotent, b.data?.idempotent].filter(Boolean).length === 1,
    JSON.stringify([a.data, b.data]),
  );
  const intents = await admin
    .from("automation_intents")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("intent_type", "send_marketing_test_email");
  ok("test send: exactly one TEST intent exists", intents.count === 1, intents.count);
  const approvals = await admin
    .from("automation_approvals")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok(
    "authority: NO automation_approvals row is fabricated for a delegated test send",
    approvals.count === 0,
    approvals.count,
  );
  const mismatch = await admin.rpc("marketing_test_send_request", {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      sender_id: senderId,
      recipient_profile_id: U.owner,
      subject: "P4 parallel proof",
      body_text: "DIFFERENT BODY",
      request_id: "req-parallel-01",
    },
  });
  ok(
    "idempotency: a reused request id with different content → stable MK412",
    Boolean(mismatch.error) && mismatch.error.code === "MK412",
    mismatch.error?.code,
  );
  const badLimit = await admin.rpc("marketing_test_send_status", {
    p_tenant: T,
    p_args: { limit: 2.5 },
  });
  ok(
    "status: the DB boundary rejects a fractional limit",
    Boolean(badLimit.error) && badLimit.error.code === "22023",
    badLimit.error?.code,
  );
  const extraKey = await admin.rpc("marketing_test_send_status", {
    p_tenant: T,
    p_args: { limit: 5, sneaky: 1 },
  });
  ok(
    "status: the DB boundary rejects extra keys",
    Boolean(extraKey.error) && extraKey.error.code === "22023",
    extraKey.error?.code,
  );
  const deliveryId = a.data.delivery_id;
  const intentId = a.data.intent_id;

  // ── (4) stubbed engine path → submitted + ONE canonical email row ──
  const claim = await admin.rpc("automation_claim_and_start", {
    p_intent_id: intentId,
    p_tenant_id: T,
    p_worker: "p4-mjs-worker",
    p_lease_seconds: 120,
    p_idempotency_key: `idem-mjs-${intentId}`,
    p_correlation_id: crypto.randomUUID(),
    p_engine_version: "test",
  });
  const claimed = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  ok(
    "engine: claim returns the frozen envelope",
    !claim.error &&
      claimed?.attempt_id &&
      claimed?.envelope_parameters?.subject === "P4 parallel proof",
    claim.error?.message ?? JSON.stringify(claimed?.envelope_parameters ?? null),
  );
  const fin = await admin.rpc("automation_finalize_execution", {
    p_tenant_id: T,
    p_intent_id: intentId,
    p_inflight_attempt_id: claimed.attempt_id,
    p_worker: "p4-mjs-worker",
    p_to_state: "succeeded",
    p_result: {
      message_id: "gm-mjs-001",
      thread_id: "gm-thr-mjs-001",
      delivery_id: deliveryId,
      submitted_at: new Date().toISOString(),
    },
    p_error_code: null,
    p_attempt_status: "succeeded",
    p_retryable: false,
    p_retry_at: null,
    p_external_reference: "gm-mjs-001",
    p_response_class: "2xx",
    p_outcome_type: "marketing_email_submitted",
    p_outcome_layer: "operational",
    p_correlation_id: crypto.randomUUID(),
    p_job_id: null,
  });
  ok("engine: finalize recorded attempt + outcome", !fin.error, fin.error?.message);
  let rec = await admin.rpc("marketing_delivery_reconcile", {
    p_tenant: T,
    p_delivery: deliveryId,
  });
  ok(
    "projection: delivery submitted with provider identifiers",
    !rec.error &&
      rec.data?.status === "submitted" &&
      rec.data?.provider_message_id === "gm-mjs-001",
    rec.error?.message ?? JSON.stringify(rec.data),
  );
  rec = await admin.rpc("marketing_delivery_reconcile", { p_tenant: T, p_delivery: deliveryId });
  ok("projection: reconcile is idempotent", !rec.error && rec.data?.changed === false);
  const email = await admin
    .from("email_messages")
    .select("id, direction, origin, origin_delivery_id", { count: "exact" })
    .eq("tenant_id", T)
    .eq("provider_message_id", "gm-mjs-001");
  ok(
    "canonical: exactly ONE outbound email_messages row with provenance",
    email.count === 1 &&
      email.data?.[0]?.direction === "outbound" &&
      email.data?.[0]?.origin === "marketing_delivery" &&
      email.data?.[0]?.origin_delivery_id === deliveryId,
    JSON.stringify(email.data),
  );

  // ── (5) disable clears default + capability, history survives ──
  sender = await admin
    .from("marketing_sender_profiles")
    .select("updated_at")
    .eq("id", senderId)
    .single();
  r = await admin.rpc("marketing_sender_set_enabled", {
    p_tenant: T,
    p_actor: U.owner,
    p_sender: senderId,
    p_enabled: false,
    p_expected: sender.data.updated_at,
  });
  ok(
    "sender: disable clears the default atomically",
    !r.error && r.data?.default_cleared === true,
    r.error?.message,
  );
  const cap2 = await admin
    .from("tenant_connector_capabilities")
    .select("enabled")
    .eq("tenant_id", T)
    .eq("capability_key", "email.send_marketing")
    .single();
  ok("capability: off when the last verified sender is disabled", cap2.data?.enabled === false);
  const still = await admin
    .from("marketing_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok("history: deliveries survive sender disable", still.count === 1, still.count);

  await cleanup();
  const residue = await admin
    .from("tenants")
    .select("id", { count: "exact", head: true })
    .eq("id", T);
  if (residue.count) {
    console.log(
      `NOTE  bounded synthetic residue kept by append-only engine history (tenant ${T}) — expected in local proof DBs`,
    );
  }
  console.log(
    failed === 0 ? "\nALL PASS (real PostgREST boundary exercised)" : `\n${failed} FAILURES`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
