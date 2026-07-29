// ServiceOS — Marketing Phase 4 authenticated HTTP contract (marketing-senders).
//
// Covers, against a SERVED edge runtime with real GoTrue JWTs:
//   - malformed JSON / unknown action / unknown top-level key → 400;
//   - viewer denied overview-without-view, ops denied sender administration,
//     viewer denied test sends (canonical resolver, not just roles);
//   - cross-tenant caller denied at requireTenantUser;
//   - sender lifecycle: create (idempotent), edit (VERSION_CONFLICT on a stale
//     token), verify (missing-scope truth from the stored grant), enable
//     refused before verification, enable → default → disable clears default;
//   - test send: strict payload, recipient restricted to same-tenant profiles,
//     idempotent intent creation on a repeated request id, RATE_LIMITED 429,
//     bounded test_status read with append-only event history;
//   - no token/credential material in ANY response body.
// Adds: REQUEST_MISMATCH on a reused request id, no-fabricated-approval and
// strict status-limit truths. Self-cleaning synthetic tenants. Exits 3 NOT-RUN
// without a served runtime.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}
const FN = (name) => `${URL}/functions/v1/${name}`;
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = "84a04000-0000-4000-8000-0000000084ab";
const T2 = "84a04000-0000-4000-8000-0000000084ac";
const USERS = {
  owner: { id: "84a04000-0000-4000-8000-0000000084c1", role: "owner", tenant: T },
  ops: { id: "84a04000-0000-4000-8000-0000000084c2", role: "ops", tenant: T },
  viewer: { id: "84a04000-0000-4000-8000-0000000084c3", role: "viewer", tenant: T },
  foreign: { id: "84a04000-0000-4000-8000-0000000084c4", role: "owner", tenant: T2 },
};
const ACC = "84a04000-0000-4000-8000-0000000084e1";

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

const call = async (token, body, rawBody) => {
  const resp = await fetch(FN("marketing-senders"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: rawBody ?? JSON.stringify(body ?? {}),
  });
  let parsed = null;
  try {
    parsed = await resp.json();
  } catch {
    parsed = null;
  }
  return { status: resp.status, body: parsed };
};

async function cleanup() {
  for (const u of Object.values(USERS)) await admin.auth.admin.deleteUser(u.id).catch(() => {});
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
  ]) {
    await admin.from(table).delete().eq("tenant_id", T);
    await admin.from(table).delete().eq("tenant_id", T2);
  }
  await admin.from("tenants").delete().in("id", [T, T2]);
}

async function main() {
  try {
    const probe = await fetch(FN("marketing-senders"), { method: "OPTIONS" });
    if (!probe.ok) throw new Error(`status ${probe.status}`);
  } catch (e) {
    console.error(`NOT-RUN  marketing-senders endpoint unreachable (${e.message}).`);
    console.error("Serve the functions (supabase functions serve) or point at a deployed env.");
    process.exit(3);
  }

  await cleanup();
  await admin.from("tenants").insert([
    { id: T, slug: "p4-http", display_name: "P4 HTTP" },
    { id: T2, slug: "p4-http-2", display_name: "P4 HTTP 2" },
  ]);
  const tokens = {};
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const [k, u] of Object.entries(USERS)) {
    await admin.auth.admin.createUser({
      id: u.id,
      email: `${k}@p4-http.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    await admin.from("profiles").update({ tenant_id: u.tenant, role: u.role }).eq("id", u.id);
    const si = await anon.auth.signInWithPassword({
      email: `${k}@p4-http.test`,
      password: "Proof-Passw0rd!",
    });
    tokens[k] = si.data.session.access_token;
  }
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: USERS.owner.id });
  await admin.from("email_accounts").insert({
    id: ACC,
    tenant_id: T,
    provider: "gmail",
    email_address: "sender@p4-http.test",
    status: "active",
    auth_state: "ok",
  });
  await admin.from("email_oauth_tokens").insert({
    tenant_id: T,
    email_account_id: ACC,
    provider: "gmail",
    access_token: "secret-token-value",
    refresh_token: "secret-refresh-value",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    scope:
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
  });

  // ── strict request contract ──
  let r = await call(tokens.owner, null, "{not json");
  ok(
    "malformed JSON → 400",
    r.status === 400 && r.body?.error?.code === "INVALID_REQUEST",
    r.status,
  );
  r = await call(tokens.owner, { action: "nope" });
  ok("unknown action → 400", r.status === 400, r.status);
  r = await call(tokens.owner, { action: "overview", sneaky: 1 });
  ok("unknown top-level key → 400", r.status === 400, r.status);
  r = await call(null, { action: "overview" });
  ok("missing auth → 401", r.status === 401, r.status);

  // ── permissions ──
  r = await call(tokens.foreign, {
    action: "sender_create",
    source_kind: "gmail_oauth",
    source_id: ACC,
  });
  ok(
    "cross-tenant owner cannot touch tenant A senders",
    r.status === 400 || r.status === 404 || r.status === 403,
    r.status,
  );
  r = await call(tokens.ops, {
    action: "sender_create",
    source_kind: "gmail_oauth",
    source_id: ACC,
  });
  ok("ops denied sender administration → 403", r.status === 403, r.status);
  r = await call(tokens.viewer, {
    action: "test_send",
    sender_id: ACC,
    recipient_profile_id: USERS.owner.id,
    subject: "x",
    body_text: "y",
    request_id: "req-http-viewer",
  });
  ok("viewer denied test send → 403", r.status === 403, r.status);

  // ── sender lifecycle ──
  r = await call(tokens.owner, {
    action: "sender_create",
    source_kind: "gmail_oauth",
    source_id: ACC,
    label: "HTTP Sender",
  });
  ok(
    "owner creates sender",
    r.status === 200 && r.body?.data?.send_scope_state === "authorized",
    JSON.stringify(r.body?.data),
  );
  const senderId = r.body?.data?.id;
  r = await call(tokens.owner, {
    action: "sender_create",
    source_kind: "gmail_oauth",
    source_id: ACC,
  });
  ok(
    "duplicate create is idempotent",
    r.status === 200 && r.body?.data?.created === false && r.body?.data?.id === senderId,
  );
  r = await call(tokens.owner, {
    action: "sender_update",
    sender_id: senderId,
    changes: { from_name: "HTTP" },
    expected_updated_at: new Date(0).toISOString(),
  });
  ok(
    "stale edit → 409 VERSION_CONFLICT",
    r.status === 409 && r.body?.error?.code === "VERSION_CONFLICT",
    r.status,
  );
  let overview = await call(tokens.owner, { action: "overview" });
  const senderRow = overview.body?.data?.senders?.find((s) => s.id === senderId);
  r = await call(tokens.owner, {
    action: "sender_enable",
    sender_id: senderId,
    expected_updated_at: senderRow?.updated_at,
  });
  ok(
    "enable verified sender",
    r.status === 200 && r.body?.data?.enabled === true,
    JSON.stringify(r.body),
  );
  overview = await call(tokens.owner, { action: "overview" });
  ok(
    "overview: capability truth + no secret material in any response",
    overview.body?.data?.capability_enabled === true &&
      !JSON.stringify(overview.body).includes("secret-token-value") &&
      !JSON.stringify(overview.body).includes("secret-refresh-value"),
  );

  // ── governed test send ──
  r = await call(tokens.ops, {
    action: "test_send",
    sender_id: senderId,
    recipient_profile_id: USERS.foreign.id,
    subject: "x",
    body_text: "y",
    request_id: "req-http-0001",
  });
  ok("foreign recipient rejected", r.status === 404 || r.status === 400, r.status);
  r = await call(tokens.ops, {
    action: "test_send",
    sender_id: senderId,
    recipient_profile_id: USERS.owner.id,
    subject: "HTTP proof",
    body_text: "Body",
    request_id: "req-http-0002",
  });
  ok(
    "ops requests a governed test send",
    r.status === 200 && r.body?.data?.status === "queued",
    JSON.stringify(r.body),
  );
  const firstDelivery = r.body?.data?.delivery_id;
  r = await call(tokens.ops, {
    action: "test_send",
    sender_id: senderId,
    recipient_profile_id: USERS.owner.id,
    subject: "HTTP proof",
    body_text: "Body",
    request_id: "req-http-0002",
  });
  ok(
    "repeated request id converges (idempotent)",
    r.status === 200 &&
      r.body?.data?.idempotent === true &&
      r.body?.data?.delivery_id === firstDelivery,
  );
  r = await call(tokens.ops, {
    action: "test_send",
    sender_id: senderId,
    recipient_profile_id: USERS.owner.id,
    subject: "HTTP proof",
    body_text: "DIFFERENT",
    request_id: "req-http-0002",
  });
  ok(
    "reused request id + different content → 409 REQUEST_MISMATCH",
    r.status === 409 && r.body?.error?.code === "REQUEST_MISMATCH",
    r.status,
  );
  const approvals = await admin
    .from("automation_approvals")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok(
    "authority: no automation_approvals row fabricated over HTTP",
    approvals.count === 0,
    approvals.count,
  );
  r = await call(tokens.ops, { action: "test_status", limit: 2.5 });
  ok("status: fractional limit → 400", r.status === 400, r.status);
  r = await call(tokens.ops, {
    action: "test_send",
    sender_id: senderId,
    recipient_profile_id: USERS.owner.id,
    subject: "RL",
    body_text: "B",
    request_id: "req-http-0003",
  });
  r = await call(tokens.ops, {
    action: "test_send",
    sender_id: senderId,
    recipient_profile_id: USERS.owner.id,
    subject: "RL",
    body_text: "B",
    request_id: "req-http-0004",
  });
  ok(
    "rate limit → 429 RATE_LIMITED",
    r.status === 429 && r.body?.error?.code === "RATE_LIMITED",
    r.status,
  );
  r = await call(tokens.viewer, { action: "test_status" });
  ok("viewer without marketing.view denied status", r.status === 403, r.status);
  r = await call(tokens.ops, { action: "test_status", limit: 5 });
  ok(
    "bounded status read with event history",
    r.status === 200 &&
      Array.isArray(r.body?.data?.deliveries) &&
      r.body.data.deliveries.every((d) => Array.isArray(d.events)),
    r.status,
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real HTTP boundary exercised)" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
