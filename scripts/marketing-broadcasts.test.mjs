// ServiceOS — Marketing Phase 5 RPC-boundary proof (PostgREST + real GoTrue JWTs).
//
// Proves at the REAL service boundary (no Edge runtime, no network to Google,
// no email — provider results are STUBBED through the engine's own finalize
// RPC exactly as the SQL suite does):
//   1. Every Phase-5 campaign/broadcast RPC is SERVICE-ROLE ONLY (authenticated
//      JWTs → 42501) and direct table writes are denied to browser roles.
//   2. The full lifecycle over PostgREST: draft → review → approve → preflight
//      (immutable snapshot + one-use challenge) → launch.
//   3. TRUE CONCURRENCY: PARALLEL identical launch calls converge on ONE
//      active campaign + one dispatch per included member; PARALLEL workers
//      claim DISJOINT recipients (FOR UPDATE SKIP LOCKED).
//   4. The stubbed engine path projects submitted + ONE canonical email row
//      with structural campaign/person provenance, and completion derives
//      from recipient facts.
// Random-id synthetic tenant; cleanup removes everything deletable and
// reports the bounded residue the append-only platform ledgers retain
// (engine attempts + communication preferences are undeletable by design).

import { createClient } from "@supabase/supabase-js";
import { validateBroadcastEnvelope } from "../supabase/functions/_shared/marketing_email.ts";

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
const BASE = "https://unsub.p5-proof.test/functions/v1";

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of Object.values(U)) await admin.auth.admin.deleteUser(id).catch(() => {});
  for (const table of [
    "marketing_unsubscribe_tokens",
    "marketing_broadcast_dispatches",
    "marketing_launch_confirmations",
    "marketing_delivery_events",
    "marketing_deliveries",
    "marketing_audience_members",
    "marketing_audience_snapshots",
    "marketing_campaign_events",
    "marketing_campaign_approvals",
    "marketing_campaign_revisions",
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
    "contact_suppressions",
    "communication_preferences",
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
  await admin.from("tenants").insert({ id: T, slug: `p5-proof-${RUN}`, display_name: "P5 Proof" });
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}-${RUN}@p5-proof.test`,
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
    email_address: "sender@p5-proof.test",
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
    p_args: { source_kind: "gmail_oauth", source_id: ACC, label: "P5 Sender" },
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
      display_name: `P5MJS Alpha ${RUN}`,
      first_name: "Alpha",
      primary_email: `alpha-${RUN}@x.test`,
    },
    {
      id: P2,
      tenant_id: T,
      display_name: `P5MJS Beta ${RUN}`,
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
    name: "P5MJS",
    definition: { field: "search", value: "P5MJS" },
    definition_version: 1,
    status: "active",
  });

  // ── (1) service-role-only boundary over real JWTs ──
  if (ANON) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await anon.auth.signInWithPassword({
      email: `owner-${RUN}@p5-proof.test`,
      password: "Proof-Passw0rd!",
    });
    const asOwner = createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${si.data.session.access_token}` } },
    });
    for (const [fn, args] of [
      ["marketing_campaign_create", { p_tenant: T, p_actor: U.owner, p_args: {} }],
      [
        "marketing_campaign_transition",
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
        "marketing_campaign_preflight",
        {
          p_tenant: T,
          p_actor: U.owner,
          p_campaign: SEG,
          p_expected_version: 1,
          p_public_base_url: BASE,
        },
      ],
      ["marketing_campaign_launch", { p_tenant: T, p_actor: U.owner, p_campaign: SEG, p_args: {} }],
      [
        "marketing_broadcast_claim_batch",
        { p_tenant: T, p_worker: "x", p_limit: 1, p_lease_seconds: 60 },
      ],
      ["marketing_broadcast_recipient_bundle", { p_tenant: T, p_dispatch: SEG, p_worker: "x" }],
      [
        "marketing_broadcast_create_lineage",
        { p_tenant: T, p_dispatch: SEG, p_worker: "x", p_args: {} },
      ],
      ["marketing_broadcast_send_authority", { p_tenant: T, p_delivery: SEG }],
      ["marketing_unsubscribe_apply", { p_token: "0".repeat(48) }],
      ["marketing_campaign_report", { p_tenant: T, p_campaign: SEG }],
      ["marketing_broadcast_health", { p_tenant: T }],
    ]) {
      const res = await asOwner.rpc(fn, args);
      ok(
        `boundary: ${fn} denied to an authenticated JWT`,
        Boolean(res.error) && res.error.code === "42501",
        res.error?.code ?? "no error",
      );
    }
    const w1 = await asOwner.from("marketing_campaigns").insert({ tenant_id: T, name: "x" });
    ok("boundary: browser cannot write campaigns", Boolean(w1.error), w1.error?.code);
    const w2 = await asOwner
      .from("marketing_audience_members")
      .update({ included: false })
      .eq("tenant_id", T);
    ok("boundary: browser cannot rewrite audience evidence", Boolean(w2.error), w2.error?.code);
  } else {
    console.log("SKIP  JWT boundary (no SUPABASE_ANON_KEY)");
  }

  // ── (2) lifecycle to APPROVED over PostgREST ──
  r = await admin.rpc("marketing_campaign_create", {
    p_tenant: T,
    p_actor: U.ops,
    p_args: {
      name: "P5 concurrency proof",
      sender_id: senderId,
      segment_id: SEG,
      subject: "Hello {{first_name}}",
      body_authored: "Hi {{first_name}}, plain news.",
    },
  });
  ok("campaign: drafted by ops", !r.error && r.data?.status === "draft", r.error?.message);
  const CID = r.data?.id;
  r = await admin.rpc("marketing_campaign_transition", {
    p_tenant: T,
    p_actor: U.ops,
    p_campaign: CID,
    p_action: "submit_review",
    p_expected_version: r.data.version,
    p_args: {},
  });
  const denied = await admin.rpc("marketing_campaign_transition", {
    p_tenant: T,
    p_actor: U.ops,
    p_campaign: CID,
    p_action: "approve",
    p_expected_version: r.data?.version,
    p_args: {},
  });
  ok(
    "authority: ops cannot approve even via direct service RPC",
    Boolean(denied.error) && denied.error.code === "42501",
    denied.error?.code,
  );
  r = await admin.rpc("marketing_campaign_transition", {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_action: "approve",
    p_expected_version: r.data.version,
    p_args: {},
  });
  ok("campaign: approved by owner", !r.error && r.data?.status === "approved", r.error?.message);

  // ── (3) preflight + PARALLEL identical launches converge ──
  const pf = await admin.rpc("marketing_campaign_preflight", {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_expected_version: r.data.version,
    p_public_base_url: BASE,
  });
  ok(
    "preflight: immutable snapshot with 2 included",
    !pf.error && pf.data?.included_count === 2 && typeof pf.data?.challenge === "string",
    pf.error?.message ?? JSON.stringify(pf.data ?? {}),
  );
  const launchArgs = {
    p_tenant: T,
    p_actor: U.owner,
    p_campaign: CID,
    p_args: {
      confirmation_id: pf.data.confirmation_id,
      challenge: pf.data.challenge,
      request_id: `req-par-${RUN}`,
      mode: "immediate",
    },
  };
  const [a, b] = await Promise.all([
    admin.rpc("marketing_campaign_launch", launchArgs),
    admin.rpc("marketing_campaign_launch", launchArgs),
  ]);
  ok(
    "launch: parallel identical calls both complete",
    !a.error && !b.error,
    a.error?.message ?? b.error?.message,
  );
  ok(
    "launch: exactly ONE launch (one idempotent echo)",
    [a.data?.idempotent, b.data?.idempotent].filter(Boolean).length === 1,
    JSON.stringify([a.data?.idempotent, b.data?.idempotent]),
  );
  const disp = await admin
    .from("marketing_broadcast_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("campaign_id", CID);
  ok("launch: one dispatch per included member (no duplicates)", disp.count === 2, disp.count);
  const mismatch = await admin.rpc("marketing_campaign_launch", {
    ...launchArgs,
    p_args: {
      ...launchArgs.p_args,
      mode: "scheduled",
      schedule_local: "2027-01-01 09:00",
      timezone: "Europe/London",
    },
  });
  ok(
    "launch: reused request id with different data → stable MK412",
    Boolean(mismatch.error) && mismatch.error.code === "MK412",
    mismatch.error?.code,
  );

  // ── (4) PARALLEL workers claim DISJOINT recipients ──
  const [c1, c2] = await Promise.all([
    admin.rpc("marketing_broadcast_claim_batch", {
      p_tenant: T,
      p_worker: "mjs-w1",
      p_limit: 1,
      p_lease_seconds: 120,
    }),
    admin.rpc("marketing_broadcast_claim_batch", {
      p_tenant: T,
      p_worker: "mjs-w2",
      p_limit: 1,
      p_lease_seconds: 120,
    }),
  ]);
  const ids1 = (c1.data ?? []).map((d) => d.id);
  const ids2 = (c2.data ?? []).map((d) => d.id);
  ok(
    "workers: concurrent claims are disjoint (SKIP LOCKED)",
    ids1.length + ids2.length === 2 && !ids1.some((i) => ids2.includes(i)),
    JSON.stringify([ids1, ids2]),
  );

  // ── (5) one recipient through bundle → lineage → engine → projection ──
  const d0 = (c1.data ?? [])[0] ?? (c2.data ?? [])[0];
  const worker = ids1.includes(d0.id) ? "mjs-w1" : "mjs-w2";
  const bundle = await admin.rpc("marketing_broadcast_recipient_bundle", {
    p_tenant: T,
    p_dispatch: d0.id,
    p_worker: worker,
  });
  ok(
    "bundle: frozen content + digest-only token",
    !bundle.error && /^[0-9a-f]{48}$/.test(bundle.data?.unsubscribe_token ?? ""),
    bundle.error?.message,
  );
  const url = `${BASE}/marketing-unsubscribe?t=${bundle.data.unsubscribe_token}`;
  const name = bundle.data.personalisation?.first_name ?? "there";
  const lin = await admin.rpc("marketing_broadcast_create_lineage", {
    p_tenant: T,
    p_dispatch: d0.id,
    p_worker: worker,
    p_args: {
      subject: `Hello ${name}`,
      body_text: `Hi ${name}, plain news.\n\nUnsubscribe: ${url}`,
      body_html: `<div>Hi ${name}, plain news. <a href="${url}">Unsubscribe</a></div>`,
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

  // AUDIT: the envelope the SQL lineage builder actually persists must satisfy
  // the SAME exact allowlist the adapter enforces. A drift between the two
  // (one field renamed or added on either side) would only ever surface as
  // every real send failing payload validation at execution time.
  const persistedIntent = await admin
    .from("automation_intents")
    .select("parameters, intent_type")
    .eq("tenant_id", T)
    .eq("id", lin.data.intent_id)
    .single();
  const envelopeCheck = validateBroadcastEnvelope(persistedIntent.data?.parameters ?? {});
  ok(
    "envelope: the REAL SQL-built envelope satisfies the adapter's exact allowlist",
    envelopeCheck.ok === true &&
      persistedIntent.data?.intent_type === "send_marketing_broadcast_email",
    envelopeCheck.ok ? "" : envelopeCheck.error,
  );

  const claim = await admin.rpc("automation_claim_and_start", {
    p_intent_id: lin.data.intent_id,
    p_tenant_id: T,
    p_worker: "p5-mjs-engine",
    p_lease_seconds: 120,
    p_idempotency_key: `idem-p5-${lin.data.intent_id}`,
    p_correlation_id: crypto.randomUUID(),
    p_engine_version: "test",
  });
  const claimed = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  ok(
    "engine: claim returns the frozen broadcast envelope",
    !claim.error && claimed?.envelope_parameters?.purpose === "broadcast",
    claim.error?.message,
  );
  const fin = await admin.rpc("automation_finalize_execution", {
    p_tenant_id: T,
    p_intent_id: lin.data.intent_id,
    p_inflight_attempt_id: claimed.attempt_id,
    p_worker: "p5-mjs-engine",
    p_to_state: "succeeded",
    p_result: { message_id: `gm-p5-${RUN}`, delivery_id: lin.data.delivery_id },
    p_error_code: null,
    p_attempt_status: "succeeded",
    p_retryable: false,
    p_retry_at: null,
    p_external_reference: `gm-p5-${RUN}`,
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
  const email = await admin
    .from("email_messages")
    .select("origin_campaign_id, origin_person_id", { count: "exact" })
    .eq("tenant_id", T)
    .eq("provider_message_id", `gm-p5-${RUN}`);
  ok(
    "canonical: ONE email row with structural campaign + person provenance",
    email.count === 1 &&
      email.data?.[0]?.origin_campaign_id === CID &&
      Boolean(email.data?.[0]?.origin_person_id),
    JSON.stringify(email.data ?? {}),
  );
  const camp = await admin.from("marketing_campaigns").select("status").eq("id", CID).single();
  ok(
    "completion: still active while the second recipient is pending",
    camp.data?.status === "active",
    camp.data?.status,
  );
  const report = await admin.rpc("marketing_campaign_report", { p_tenant: T, p_campaign: CID });
  ok(
    "report: factual counts; clicked honestly null",
    !report.error && report.data?.dispatch?.submitted === 1 && report.data?.clicked === null,
    report.error?.message ?? JSON.stringify(report.data?.dispatch ?? {}),
  );

  // ── (6) AUDIT: CONCURRENT first use of ONE unsubscribe token converges ──
  // Two clicks (or a one-click POST racing the visible link) must produce
  // exactly one preference fact, one active suppression and one event.
  const tokenPlain = Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tokenPlain));
  const tokenDigest = Array.from(new Uint8Array(digestBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const cpRow = await admin
    .from("contact_points")
    .select("id, normalized_value")
    .eq("tenant_id", T)
    .eq("person_id", d0.person_id)
    .single();
  const tokIns = await admin.from("marketing_unsubscribe_tokens").insert({
    tenant_id: T,
    token_digest: tokenDigest,
    campaign_id: CID,
    person_id: d0.person_id,
    contact_point_id: cpRow.data.id,
    destination: cpRow.data.normalized_value,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  ok("unsubscribe: digest-only token minted for the race", !tokIns.error, tokIns.error?.message);
  const [u1, u2, u3] = await Promise.all([
    admin.rpc("marketing_unsubscribe_apply", { p_token: tokenPlain }),
    admin.rpc("marketing_unsubscribe_apply", { p_token: tokenPlain }),
    admin.rpc("marketing_unsubscribe_apply", { p_token: tokenPlain }),
  ]);
  ok(
    "unsubscribe: every concurrent use returns the SAME generic response",
    !u1.error &&
      !u2.error &&
      !u3.error &&
      JSON.stringify(u1.data) === JSON.stringify(u2.data) &&
      JSON.stringify(u2.data) === JSON.stringify(u3.data),
    JSON.stringify([u1.data, u2.data, u3.data]),
  );
  const prefCount = await admin
    .from("communication_preferences")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("person_id", d0.person_id)
    .eq("state", "unsubscribed");
  const supCount = await admin
    .from("contact_suppressions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("normalized_value", cpRow.data.normalized_value)
    .eq("active", true);
  const evCount = await admin
    .from("platform_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("event_type", "marketing.unsubscribe.recorded")
    .eq("subject_id", d0.person_id);
  ok(
    "unsubscribe: concurrent first use converges to ONE preference, ONE suppression, ONE event",
    prefCount.count === 1 && supCount.count === 1 && evCount.count === 1,
    JSON.stringify({ pref: prefCount.count, sup: supCount.count, ev: evCount.count }),
  );
  const elig = await admin.rpc("marketing_endpoint_eligibility", {
    p_tenant: T,
    p_person: d0.person_id,
    p_channel: "email",
    p_contact_point: cpRow.data.id,
  });
  ok(
    "unsubscribe: the new fact is visible IMMEDIATELY to the send authority",
    !elig.error && elig.data === "suppressed",
    elig.error?.message ?? String(elig.data),
  );

  // ── (7) AUDIT: the orphaned-intent recovery contract ──
  // A crash between the lineage transaction committing and the execution
  // enqueue leaves a QUEUED dispatch whose intent is still pending. No claim
  // query would ever look at it again, so both the scheduler scan and the
  // worker's repair sweep must be able to see it by their own queries.
  //
  // Build that exact state with the SECOND leased recipient: prepare its full
  // lineage and then deliberately do NOT enqueue the execution job.
  const d1 = ids1.includes(d0.id) ? (c2.data ?? [])[0] : (c1.data ?? [])[0];
  // Release the original lease and take a fresh long one, so this proof never
  // depends on how long the steps above happened to take. Releasing a lease is
  // the legal preparing → pending transition the worker itself uses.
  await admin
    .from("marketing_broadcast_dispatches")
    .update({ status: "pending", lease_worker: null, lease_expires_at: null })
    .eq("tenant_id", T)
    .eq("id", d1.id)
    .eq("status", "preparing");
  const worker1 = "mjs-w3";
  const reclaim = await admin.rpc("marketing_broadcast_claim_batch", {
    p_tenant: T,
    p_worker: worker1,
    p_limit: 5,
    p_lease_seconds: 600,
  });
  ok(
    "recovery: the released recipient is re-claimable by a fresh worker",
    (reclaim.data ?? []).some((x) => x.id === d1.id),
    JSON.stringify((reclaim.data ?? []).map((x) => x.id)),
  );
  const bundle1 = await admin.rpc("marketing_broadcast_recipient_bundle", {
    p_tenant: T,
    p_dispatch: d1.id,
    p_worker: worker1,
  });
  const url1 = `${BASE}/marketing-unsubscribe?t=${bundle1.data.unsubscribe_token}`;
  const name1 = bundle1.data.personalisation?.first_name ?? "there";
  const lin1 = await admin.rpc("marketing_broadcast_create_lineage", {
    p_tenant: T,
    p_dispatch: d1.id,
    p_worker: worker1,
    p_args: {
      subject: `Hello ${name1}`,
      body_text: `Hi ${name1}, plain news.\n\nUnsubscribe: ${url1}`,
      body_html: `<div>Hi ${name1}, plain news. <a href="${url1}">Unsubscribe</a></div>`,
      unsubscribe_url: url1,
    },
  });
  ok(
    "recovery: an orphan (lineage committed, execution never enqueued) exists",
    !lin1.error && Boolean(lin1.data?.intent_id),
    lin1.error?.message,
  );

  const schedulerScan = await admin
    .from("marketing_broadcast_dispatches")
    .select("tenant_id, marketing_campaigns!inner(status)")
    .in("status", ["pending", "queued"])
    .eq("marketing_campaigns.status", "active")
    .eq("tenant_id", T);
  ok(
    "recovery: the scheduler scan surfaces a tenant whose only work is QUEUED",
    !schedulerScan.error && (schedulerScan.data ?? []).length > 0,
    schedulerScan.error?.message ?? String((schedulerScan.data ?? []).length),
  );
  const sweep = await admin
    .from("marketing_broadcast_dispatches")
    .select("automation_intent_id")
    .eq("tenant_id", T)
    .eq("status", "queued")
    .not("automation_intent_id", "is", null);
  const sweepIds = (sweep.data ?? []).map((d) => d.automation_intent_id);
  const sweepPending = sweepIds.length
    ? await admin
        .from("automation_intents")
        .select("id")
        .eq("tenant_id", T)
        .eq("status", "pending")
        .in("id", sweepIds)
    : { data: [] };
  ok(
    "recovery: the worker repair sweep finds the pending intent behind a queued dispatch",
    (sweepPending.data ?? []).length > 0,
    JSON.stringify({ queued: sweepIds.length, pending: (sweepPending.data ?? []).length }),
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
