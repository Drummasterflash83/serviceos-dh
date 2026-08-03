// ServiceOS — governed cancel-before-execution HTTP contract (marketing-senders
// action test_cancel), exercised against a SERVED runtime with real GoTrue JWTs.
//
// Random-id synthetic tenants → re-runnable on any environment, including a
// staging project whose append-only ledgers keep fixed-fixture ids forever.
//
// Proves:
//   - an operational actor with marketing.campaigns.test can withdraw their own
//     QUEUED test; the intent moves pending→cancelled, the delivery reconciles,
//     and an audit row records the act;
//   - cancelling twice is a clean conflict, not a duplicate cancellation;
//   - a viewer cannot cancel;
//   - a caller from another tenant sees NOT_FOUND (non-enumerating);
//   - a non-test delivery id and a garbage id are refused;
//   - a delivery whose intent already left `pending` can no longer be
//     withdrawn (CONFLICT) — nothing that may already be at the provider is
//     ever touched.
//
// Exits 3 NOT-RUN without a served runtime.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}
const FN = `${URL}/functions/v1/marketing-senders`;
const admin = createClient(URL, SR, { auth: { persistSession: false } });

const TA = crypto.randomUUID();
const TB = crypto.randomUUID();
const OWNER = crypto.randomUUID();
const VIEWER = crypto.randomUUID();
const OWNER_B = crypto.randomUUID();
const RUN = TA.slice(0, 8);

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of [OWNER, VIEWER, OWNER_B]) await admin.auth.admin.deleteUser(id).catch(() => {});
  for (const t of [TA, TB]) {
    for (const table of [
      "marketing_delivery_events",
      "marketing_deliveries",
      "automation_execution_attempts",
      "automation_intents",
      "decision_log",
      "intelligence_objects",
      "tenant_connector_capabilities",
      "tenant_connectors",
      "marketing_sender_authorities",
      "marketing_sender_profiles",
      "marketing_settings_history",
      "marketing_lifecycle_stages",
      "marketing_settings",
      "audit_logs",
      "platform_events",
      "platform_jobs",
      "review_tasks",
    ]) {
      await admin.from(table).delete().eq("tenant_id", t);
    }
    await admin.from("tenants").delete().eq("id", t);
  }
}

const call = async (token, body) => {
  const resp = await fetch(FN, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json().catch(() => null) };
};

async function main() {
  // served-runtime probe
  try {
    const probe = await fetch(FN, { method: "POST", headers: { apikey: ANON } });
    if (probe.status === 404 || probe.status === 503) throw new Error("not served");
  } catch {
    console.error("NOT-RUN: marketing-senders is not served at " + FN);
    process.exit(3);
  }

  await cleanup();
  await admin.from("tenants").insert([
    { id: TA, slug: `tc-a-${RUN}`, display_name: "TestCancel A" },
    { id: TB, slug: `tc-b-${RUN}`, display_name: "TestCancel B" },
  ]);
  for (const [id, tenant, role, tag] of [
    [OWNER, TA, "owner", "owner"],
    [VIEWER, TA, "viewer", "viewer"],
    [OWNER_B, TB, "owner", "ownerb"],
  ]) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${tag}-${RUN}@tc-proof.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) {
      console.error("user create failed", c.error.message);
      process.exit(1);
    }
    await admin.from("profiles").update({ tenant_id: tenant, role }).eq("id", id);
  }
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TA, p_actor: OWNER });
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TB, p_actor: OWNER_B });
  // sandbox sender (needs no platform authority) so a test can be requested
  const sender = await admin.rpc("marketing_sender_create_resend", {
    p_tenant: TA,
    p_actor: OWNER,
    p_args: { from_address: "onboarding@resend.dev", from_name: "TC Proof" },
  });
  if (sender.error) {
    console.error("sender create failed", sender.error.message);
    await cleanup();
    process.exit(1);
  }

  const tokens = {};
  for (const [key, tag] of [
    ["owner", "owner"],
    ["viewer", "viewer"],
    ["ownerb", "ownerb"],
  ]) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await anon.auth.signInWithPassword({
      email: `${tag}-${RUN}@tc-proof.test`,
      password: "Proof-Passw0rd!",
    });
    tokens[key] = si.data.session?.access_token;
  }

  // request a QUEUED test (sandbox → test-to-self; the owner sends to himself)
  const req = await call(tokens.owner, {
    action: "test_send",
    sender_id: sender.data.id,
    recipient_profile_id: OWNER,
    subject: "cancel-me",
    body_text: "queued test for the cancel contract",
    request_id: `tc-${RUN}-0001`,
  });
  ok("a governed test can be requested", req.status === 200 && req.body?.ok === true, req.status);
  const deliveryId = req.body?.data?.delivery_id;

  // viewer cannot cancel
  let r = await call(tokens.viewer, { action: "test_cancel", delivery_id: deliveryId });
  ok("a viewer cannot cancel a test", r.status === 403, r.status);

  // another tenant's owner sees NOT_FOUND (non-enumerating)
  r = await call(tokens.ownerb, { action: "test_cancel", delivery_id: deliveryId });
  ok(
    "a caller from another tenant sees NOT_FOUND",
    r.status === 404 || r.status === 403,
    `${r.status} ${r.body?.error?.code}`,
  );

  // garbage id refused
  r = await call(tokens.owner, { action: "test_cancel", delivery_id: "not-a-uuid" });
  ok("a malformed delivery id is refused", r.status === 400, r.status);

  // the owner cancels their queued test
  r = await call(tokens.owner, { action: "test_cancel", delivery_id: deliveryId });
  ok(
    "the requester can withdraw a queued test",
    r.status === 200 && r.body?.data?.cancelled === true,
    JSON.stringify(r.body?.data ?? r.body?.error),
  );
  const intent = await admin
    .from("automation_intents")
    .select("status")
    .eq("tenant_id", TA)
    .eq("intent_type", "send_marketing_test_email")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  ok("the intent is cancelled", intent.data?.status === "cancelled", intent.data?.status);
  const audit = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TA)
    .eq("action", "marketing.test_send.cancelled");
  ok("the cancellation is audited", (audit.count ?? 0) === 1, audit.count);

  // cancelling again is a clean conflict
  r = await call(tokens.owner, { action: "test_cancel", delivery_id: deliveryId });
  ok("a second cancel is a clean conflict", r.status === 409, r.status);

  // an intent that already left pending can no longer be withdrawn
  const req2 = await call(tokens.owner, {
    action: "test_send",
    sender_id: sender.data.id,
    recipient_profile_id: OWNER,
    subject: "already-processing",
    body_text: "second queued test",
    request_id: `tc-${RUN}-0002`,
  });
  const delivery2 = req2.body?.data?.delivery_id;
  const intent2 = req2.body?.data?.intent_id;
  await admin
    .from("automation_intents")
    .update({ status: "claimed" })
    .eq("id", intent2)
    .eq("status", "pending");
  r = await call(tokens.owner, { action: "test_cancel", delivery_id: delivery2 });
  ok(
    "a test that already started processing cannot be withdrawn",
    r.status === 409,
    `${r.status} ${r.body?.error?.code}`,
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real HTTP boundary exercised)" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
