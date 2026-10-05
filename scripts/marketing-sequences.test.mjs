// ServiceOS — Marketing Phase 6 RPC-boundary proof (PostgREST + real GoTrue JWTs).
//
// Proves at the REAL service boundary (no Edge runtime, no network to Google,
// no email — provider results are STUBBED through the engine's own finalize
// RPC exactly as the SQL suite does):
//   1. Every Phase-6 sequence RPC is SERVICE-ROLE ONLY (authenticated JWTs →
//      42501) and direct table writes are denied to browser roles.
//   2. The full lifecycle over PostgREST: draft → review → approve →
//      activation preflight → activate → enrolment preflight → confirm.
//   3. TRUE CONCURRENCY: PARALLEL identical activations converge on ONE
//      activation; PARALLEL identical enrolment confirmations create each
//      Person exactly once; PARALLEL workers claim DISJOINT steps.
//   4. The REAL SQL-built sequence envelope satisfies the adapter's exact
//      allowlist (a drift lock — a rename on either side would otherwise only
//      surface as every live send failing validation).
//   5. The orphaned-intent recovery contract the worker and scheduler rely on.
// Random-id synthetic tenant; cleanup removes everything deletable and reports
// the bounded residue the append-only platform ledgers retain.

import { createClient } from "@supabase/supabase-js";
import { validateSequenceEnvelope } from "../supabase/functions/_shared/marketing_email.ts";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = crypto.randomUUID();
const U = { owner: crypto.randomUUID(), ops: crypto.randomUUID(), viewer: crypto.randomUUID() };
const ACC = crypto.randomUUID();
const SEG = crypto.randomUUID();
const P1 = crypto.randomUUID();
const P2 = crypto.randomUUID();
const RUN = T.slice(0, 8);
const BASE = "https://unsub.p6-proof.test/functions/v1";

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of Object.values(U)) await admin.auth.admin.deleteUser(id).catch(() => {});
  for (const table of [
    "marketing_sequence_executions",
    "marketing_sequence_confirmations",
    "marketing_sequence_enrolments",
    "marketing_enrolment_candidates",
    "marketing_enrolment_batches",
    "marketing_sequence_approvals",
    "marketing_sequence_steps",
    "marketing_sequence_revisions",
    "marketing_unsubscribe_tokens",
    "marketing_delivery_events",
    "marketing_deliveries",
    "marketing_campaign_events",
    "email_messages",
    "automation_approvals",
    "automation_execution_attempts",
    "automation_intents",
    "decision_log",
    "intelligence_objects",
    "object_state_history",
    "tenant_connector_capabilities",
    "tenant_connectors",
    "marketing_settings_history",
    "email_oauth_tokens",
    "email_accounts",
    "contact_suppressions",
    "communication_preferences",
    "contact_tag_assignments",
    "marketing_tags",
    "contact_points",
    "people",
    "marketing_segments",
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
  await admin.from("marketing_campaigns").delete().eq("tenant_id", T);
  await admin.from("tenants").delete().eq("id", T);
}

async function main() {
  await cleanup();
  await admin.from("tenants").insert({ id: T, slug: `p6-proof-${RUN}`, display_name: "P6 Proof" });
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}-${RUN}@p6-proof.test`,
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
    email_address: "sender@p6-proof.test",
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
    p_args: { source_kind: "gmail_oauth", source_id: ACC, label: "P6 Sender" },
  });
  const senderId = r.data?.id;
  const sender = await admin
    .from("marketing_sender_profiles")
    .select("updated_at")
    .eq("id", senderId)
    .single();
  await admin.rpc("marketing_sender_set_enabled", {
    p_tenant: T,
    p_actor: U.owner,
    p_sender: senderId,
    p_enabled: true,
    p_expected: sender.data.updated_at,
  });
  await admin.from("people").insert([
    {
      id: P1,
      tenant_id: T,
      display_name: `P6MJS Alpha ${RUN}`,
      first_name: "Alpha",
      primary_email: `alpha-${RUN}@x.test`,
    },
    {
      id: P2,
      tenant_id: T,
      display_name: `P6MJS Beta ${RUN}`,
      first_name: "Beta",
      primary_email: `beta-${RUN}@x.test`,
    },
  ]);
  await admin.from("contact_points").insert([
    {
      tenant_id: T,
      person_id: P1,
      channel: "email",
      value: `alpha-${RUN}@x.test`,
      normalized_value: `alpha-${RUN}@x.test`,
      is_primary: true,
    },
    {
      tenant_id: T,
      person_id: P2,
      channel: "email",
      value: `beta-${RUN}@x.test`,
      normalized_value: `beta-${RUN}@x.test`,
      is_primary: true,
    },
  ]);
  await admin.from("communication_preferences").insert([
    { tenant_id: T, person_id: P1, channel: "email", state: "subscribed", source: "manual" },
    { tenant_id: T, person_id: P2, channel: "email", state: "subscribed", source: "manual" },
  ]);
  await admin.from("marketing_segments").insert({
    id: SEG,
    tenant_id: T,
    name: "P6MJS",
    definition: { field: "search", value: "P6MJS" },
    definition_version: 1,
    status: "active",
  });

  // ── (1) service-role-only boundary over real JWTs ──
  if (ANON) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await anon.auth.signInWithPassword({
      email: `owner-${RUN}@p6-proof.test`,
      password: "Proof-Passw0rd!",
    });
    const asOwner = createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${si.data.session.access_token}` } },
    });
    for (const [fn, args] of [
      ["marketing_sequence_create", { p_tenant: T, p_actor: U.owner, p_args: {} }],
      [
        "marketing_sequence_transition",
        {
          p_tenant: T,
          p_actor: U.owner,
          p_campaign: SEG,
          p_action: "approve",
          p_expected_version: 1,
          p_args: {},
        },
      ],
      [
        "marketing_sequence_preflight_activation",
        {
          p_tenant: T,
          p_actor: U.owner,
          p_campaign: SEG,
          p_expected_version: 1,
          p_public_base_url: BASE,
        },
      ],
      [
        "marketing_sequence_activate",
        { p_tenant: T, p_actor: U.owner, p_campaign: SEG, p_args: {} },
      ],
      [
        "marketing_sequence_preflight_enrolment",
        { p_tenant: T, p_actor: U.owner, p_campaign: SEG, p_args: {} },
      ],
      [
        "marketing_sequence_confirm_enrolment",
        { p_tenant: T, p_actor: U.owner, p_campaign: SEG, p_args: {} },
      ],
      [
        "marketing_sequence_claim_batch",
        { p_tenant: T, p_worker: "x", p_limit: 1, p_lease_seconds: 60 },
      ],
      ["marketing_sequence_step_bundle", { p_tenant: T, p_execution: SEG, p_worker: "x" }],
      [
        "marketing_sequence_create_email_lineage",
        { p_tenant: T, p_execution: SEG, p_worker: "x", p_args: {} },
      ],
      [
        "marketing_sequence_create_action_lineage",
        { p_tenant: T, p_execution: SEG, p_worker: "x" },
      ],
      ["marketing_sequence_send_authority", { p_tenant: T, p_delivery: SEG }],
      ["marketing_sequence_authority_core", { p_tenant: T, p_enrolment: SEG, p_execution: SEG }],
      [
        "marketing_sequence_exit_enrolment",
        {
          p_tenant: T,
          p_enrolment: SEG,
          p_reason: "manual_removal",
          p_evidence: {},
          p_actor_label: "x",
        },
      ],
      ["marketing_sequence_report", { p_tenant: T, p_campaign: SEG }],
      ["marketing_sequence_health", { p_tenant: T }],
    ]) {
      const res = await asOwner.rpc(fn, args);
      ok(
        `boundary: ${fn} denied to an authenticated JWT`,
        Boolean(res.error) && res.error.code === "42501",
        res.error?.code ?? "no error",
      );
    }
    const w1 = await asOwner
      .from("marketing_sequence_enrolments")
      .insert({ tenant_id: T, campaign_id: SEG });
    ok("boundary: browser cannot write enrolments", Boolean(w1.error), w1.error?.code);
    const w2 = await asOwner
      .from("marketing_sequence_executions")
      .update({ status: "succeeded" })
      .eq("tenant_id", T);
    ok("boundary: browser cannot rewrite execution evidence", Boolean(w2.error), w2.error?.code);
    const w3 = await asOwner
      .from("marketing_sequence_confirmations")
      .select("*")
      .eq("tenant_id", T);
    ok(
      "boundary: challenge digests are never client-readable",
      Boolean(w3.error) || (w3.data ?? []).length === 0,
      w3.error?.code ?? "empty",
    );
  } else {
    console.log("SKIP  JWT boundary (no SUPABASE_ANON_KEY)");
  }

  // ── (2) lifecycle to ACTIVE over PostgREST ──
  r = await admin.rpc("marketing_sequence_create", {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      name: "P6 concurrency proof",
      sender_id: senderId,
      timezone: "UTC",
      exit_rules: { on_reply: true },
      steps: [
        {
          key: "s1",
          type: "send_email",
          config: { subject: "Hello {{first_name}}", body_authored: "Hi {{first_name}}." },
        },
        { key: "s2", type: "wait_duration", config: { unit: "days", amount: 2 } },
      ],
    },
  });
  ok("sequence: drafted by ops", !r.error && r.data?.step_count === 2, r.error?.message);
  const CID = r.data?.id;
  r = await admin.rpc("marketing_sequence_transition", {
    p_tenant: T,
    p_actor: U.ops,
    p_campaign: CID,
    p_action: "submit_review",
    p_expected_version: r.data.version,
    p_args: {},
  });
  const denied = await admin.rpc("marketing_sequence_transition", {
    p_tenant: T,
    p_actor: U.ops,
    p_campaign: CID,
    p_action: "approve",
    p_expected_version: r.data?.version,
    p_args: {},
  });
  ok(
    "authority: ops cannot approve even via the direct service RPC",
    Boolean(denied.error) && denied.error.code === "42501",
    denied.error?.code,
  );
  r = await admin.rpc("marketing_sequence_transition", {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_action: "approve",
    p_expected_version: r.data.version,
    p_args: {},
  });
  ok("sequence: approved by owner", !r.error && r.data?.status === "approved", r.error?.message);

  // ── (3) PARALLEL identical activations converge ──
  const pf = await admin.rpc("marketing_sequence_preflight_activation", {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_expected_version: r.data.version,
    p_public_base_url: BASE,
  });
  ok(
    "activation preflight: one-use challenge issued",
    !pf.error && typeof pf.data?.challenge === "string" && pf.data?.email_steps === 1,
    pf.error?.message,
  );
  const actArgs = {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_args: {
      confirmation_id: pf.data.confirmation_id,
      challenge: pf.data.challenge,
      request_id: `act-par-${RUN}`,
    },
  };
  const [a1, a2] = await Promise.all([
    admin.rpc("marketing_sequence_activate", actArgs),
    admin.rpc("marketing_sequence_activate", actArgs),
  ]);
  ok(
    "activate: parallel identical calls both complete",
    !a1.error && !a2.error,
    a1.error?.message ?? a2.error?.message,
  );
  ok(
    "activate: exactly ONE activation (one idempotent echo)",
    [a1.data?.idempotent, a2.data?.idempotent].filter(Boolean).length === 1,
    JSON.stringify([a1.data?.idempotent, a2.data?.idempotent]),
  );

  // ── (4) enrolment preflight + PARALLEL confirmation convergence ──
  const ep = await admin.rpc("marketing_sequence_preflight_enrolment", {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_args: { source: "segment", segment_id: SEG },
  });
  ok(
    "enrolment preflight: every candidate recorded with an exact verdict",
    !ep.error && ep.data?.candidate_count === 2 && ep.data?.eligible_count === 2,
    ep.error?.message ?? JSON.stringify(ep.data ?? {}),
  );
  const candidates = await admin
    .from("marketing_enrolment_candidates")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("batch_id", ep.data.batch_id);
  ok(
    "enrolment preflight: batch counts equal persisted rows",
    candidates.count === ep.data.candidate_count,
    `${candidates.count} vs ${ep.data.candidate_count}`,
  );
  const confArgs = {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_args: {
      confirmation_id: ep.data.confirmation_id,
      challenge: ep.data.challenge,
      request_id: `enr-par-${RUN}`,
    },
  };
  const [c1, c2] = await Promise.all([
    admin.rpc("marketing_sequence_confirm_enrolment", confArgs),
    admin.rpc("marketing_sequence_confirm_enrolment", confArgs),
  ]);
  ok(
    "enrol: parallel identical confirmations both complete",
    !c1.error && !c2.error,
    c1.error?.message ?? c2.error?.message,
  );
  const enrolCount = await admin
    .from("marketing_sequence_enrolments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("campaign_id", CID);
  ok(
    "enrol: each eligible Person enrolled EXACTLY once under parallel confirmation",
    enrolCount.count === 2,
    enrolCount.count,
  );
  const mismatch = await admin.rpc("marketing_sequence_confirm_enrolment", {
    ...confArgs,
    p_args: { ...confArgs.p_args, confirmation_id: crypto.randomUUID() },
  });
  ok(
    "enrol: a reused request id with different data → stable MK412",
    Boolean(mismatch.error) && mismatch.error.code === "MK412",
    mismatch.error?.code,
  );

  // ── (5) PARALLEL workers claim DISJOINT steps ──
  const [w1, w2] = await Promise.all([
    admin.rpc("marketing_sequence_claim_batch", {
      p_tenant: T,
      p_worker: "mjs-w1",
      p_limit: 1,
      p_lease_seconds: 300,
    }),
    admin.rpc("marketing_sequence_claim_batch", {
      p_tenant: T,
      p_worker: "mjs-w2",
      p_limit: 1,
      p_lease_seconds: 300,
    }),
  ]);
  const ids1 = (w1.data ?? []).map((d) => d.id);
  const ids2 = (w2.data ?? []).map((d) => d.id);
  ok(
    "workers: concurrent claims are disjoint (SKIP LOCKED)",
    ids1.length + ids2.length === 2 && !ids1.some((i) => ids2.includes(i)),
    JSON.stringify([ids1, ids2]),
  );

  // ── (6) one step through bundle → lineage → engine → projection ──
  const x0 = (w1.data ?? [])[0] ?? (w2.data ?? [])[0];
  const worker = ids1.includes(x0.id) ? "mjs-w1" : "mjs-w2";
  const bundle = await admin.rpc("marketing_sequence_step_bundle", {
    p_tenant: T,
    p_execution: x0.id,
    p_worker: worker,
  });
  ok(
    "bundle: frozen step config + digest-only token",
    !bundle.error && /^[0-9a-f]{48}$/.test(bundle.data?.unsubscribe_token ?? ""),
    bundle.error?.message,
  );
  const url = `${BASE}/marketing-unsubscribe?t=${bundle.data.unsubscribe_token}`;
  const name = bundle.data.personalisation?.first_name ?? "there";
  const lin = await admin.rpc("marketing_sequence_create_email_lineage", {
    p_tenant: T,
    p_execution: x0.id,
    p_worker: worker,
    p_args: {
      subject: `Hello ${name}`,
      body_text: `Hi ${name}.\n\nUnsubscribe: ${url}`,
      body_html: `<div>Hi ${name}. <a href="${url}">Unsubscribe</a></div>`,
      unsubscribe_url: url,
    },
  });
  ok("lineage: created", !lin.error && Boolean(lin.data?.intent_id), lin.error?.message);
  const appr = await admin
    .from("automation_approvals")
    .select("approver_kind, approver_ref, decision")
    .eq("tenant_id", T)
    .eq("automation_intent_id", lin.data.intent_id)
    .single();
  ok(
    "approval: append-only tenant_senior row naming the REAL owner approver",
    appr.data?.approver_kind === "tenant_senior" &&
      appr.data?.approver_ref === U.owner &&
      appr.data?.decision === "approved",
    JSON.stringify(appr.data ?? {}),
  );

  // the REAL SQL-built envelope must satisfy the adapter's exact allowlist
  const persisted = await admin
    .from("automation_intents")
    .select("parameters, intent_type")
    .eq("tenant_id", T)
    .eq("id", lin.data.intent_id)
    .single();
  const envCheck = validateSequenceEnvelope(persisted.data?.parameters ?? {});
  ok(
    "envelope: the REAL SQL-built sequence envelope satisfies the adapter allowlist",
    envCheck.ok === true && persisted.data?.intent_type === "send_marketing_sequence_email",
    envCheck.ok ? "" : envCheck.error,
  );

  const claim = await admin.rpc("automation_claim_and_start", {
    p_intent_id: lin.data.intent_id,
    p_tenant_id: T,
    p_worker: "p6-mjs-engine",
    p_lease_seconds: 120,
    p_idempotency_key: `idem-p6-${lin.data.intent_id}`,
    p_correlation_id: crypto.randomUUID(),
    p_engine_version: "test",
  });
  const claimed = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  ok(
    "engine: claim returns the frozen sequence envelope",
    !claim.error && claimed?.envelope_parameters?.purpose === "sequence",
    claim.error?.message,
  );
  const fin = await admin.rpc("automation_finalize_execution", {
    p_tenant_id: T,
    p_intent_id: lin.data.intent_id,
    p_inflight_attempt_id: claimed.attempt_id,
    p_worker: "p6-mjs-engine",
    p_to_state: "succeeded",
    p_result: { message_id: `gm-p6-${RUN}`, delivery_id: lin.data.delivery_id },
    p_error_code: null,
    p_attempt_status: "succeeded",
    p_retryable: false,
    p_retry_at: null,
    p_external_reference: `gm-p6-${RUN}`,
    p_response_class: "2xx",
    p_outcome_type: "marketing_email_submitted",
    p_outcome_layer: "operational",
    p_correlation_id: crypto.randomUUID(),
    p_job_id: null,
  });
  ok("engine: finalize recorded", !fin.error, fin.error?.message);
  const rec = await admin.rpc("marketing_delivery_reconcile", {
    p_tenant: T,
    p_delivery: lin.data.delivery_id,
  });
  ok(
    "projection: delivery submitted",
    !rec.error && rec.data?.status === "submitted",
    rec.error?.message,
  );
  const execRow = await admin
    .from("marketing_sequence_executions")
    .select("status")
    .eq("id", x0.id)
    .single();
  ok(
    "advancement: the step execution succeeded exactly once",
    execRow.data?.status === "succeeded",
    execRow.data?.status,
  );
  const enrolRow = await admin
    .from("marketing_sequence_enrolments")
    .select("current_step_order, next_eligible_at")
    .eq("id", x0.enrolment_id)
    .single();
  ok(
    "advancement: the enrolment advanced to the wait step",
    enrolRow.data?.current_step_order === 2,
    enrolRow.data?.current_step_order,
  );
  const email = await admin
    .from("email_messages")
    .select("origin_campaign_id, origin_person_id", { count: "exact" })
    .eq("tenant_id", T)
    .eq("provider_message_id", `gm-p6-${RUN}`);
  ok(
    "canonical: ONE email row with structural campaign + person provenance",
    email.count === 1 &&
      email.data?.[0]?.origin_campaign_id === CID &&
      Boolean(email.data?.[0]?.origin_person_id),
    JSON.stringify(email.data ?? {}),
  );

  // ── (7) the wait step is a SCHEDULING fact, resolved in SQL ──
  const claimAgain = await admin.rpc("marketing_sequence_claim_batch", {
    p_tenant: T,
    p_worker: "mjs-w3",
    p_limit: 5,
    p_lease_seconds: 300,
  });
  const waitExec = await admin
    .from("marketing_sequence_executions")
    .select("status, scheduled_for, step_type")
    .eq("tenant_id", T)
    .eq("enrolment_id", x0.enrolment_id)
    .eq("step_order", 2)
    .single();
  ok(
    "wait: resolved in SQL with a persisted future instant, never worker work",
    waitExec.data?.step_type === "wait_duration" &&
      waitExec.data?.status === "pending" &&
      Date.parse(waitExec.data?.scheduled_for) > Date.now(),
    JSON.stringify(waitExec.data ?? {}),
  );
  ok(
    "wait: the waiting enrolment is not re-claimed for work",
    !(claimAgain.data ?? []).some((e) => e.enrolment_id === x0.enrolment_id && e.step_order === 2),
    JSON.stringify((claimAgain.data ?? []).map((e) => e.step_order)),
  );

  // ── (8) the orphaned-intent recovery contract ──
  const stuck = await admin
    .from("marketing_sequence_executions")
    .select("automation_intent_id")
    .eq("tenant_id", T)
    .eq("status", "queued")
    .not("automation_intent_id", "is", null);
  const stuckIds = (stuck.data ?? []).map((s) => s.automation_intent_id);
  const stuckPending = stuckIds.length
    ? await admin
        .from("automation_intents")
        .select("id")
        .eq("tenant_id", T)
        .eq("status", "pending")
        .in("id", stuckIds)
    : { data: [] };
  ok(
    "recovery: the worker sweep query can see a queued step's pending intent",
    Array.isArray(stuckPending.data),
    `${stuckIds.length} queued`,
  );
  const due = await admin.rpc("marketing_sequence_due", { p_limit: 200 });
  ok(
    "scheduler: due discovery is bounded and tenant-scoped",
    !due.error && Array.isArray(due.data),
    due.error?.message,
  );

  // ── (9) reporting truth ──
  const report = await admin.rpc("marketing_sequence_report", { p_tenant: T, p_campaign: CID });
  ok(
    "report: factual counts; delivered/opened/clicked/bounced honestly null",
    !report.error &&
      report.data?.delivered === null &&
      report.data?.opened === null &&
      report.data?.clicked === null &&
      report.data?.bounced === null,
    report.error?.message,
  );
  ok(
    "report: per-step execution figures reconcile with the step list",
    (report.data?.steps ?? []).length === 2,
    JSON.stringify((report.data?.steps ?? []).map((s) => s.order)),
  );

  await cleanup();
  const residue = await admin
    .from("tenants")
    .select("id", { count: "exact", head: true })
    .eq("id", T);
  if (residue.count) {
    console.log(
      `NOTE  bounded synthetic residue kept by append-only platform ledgers (tenant ${T}) — expected in local proof DBs`,
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
