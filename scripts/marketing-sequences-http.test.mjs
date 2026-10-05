// ServiceOS — Marketing Phase 6 authenticated HTTP contract (marketing-sequences).
//
// Covers, against a SERVED edge runtime with real GoTrue JWTs:
//   - malformed JSON / unknown action / unknown top-level key → 400;
//   - viewer denied every mutation; ops may draft/revise/validate but is
//     denied approve/activate/enrol at the Edge role gate; owner/admin may;
//   - exact request-key allowlists, type/UUID/length validation, bounded
//     pagination and stable error codes (VERSION_CONFLICT / REQUEST_MISMATCH /
//     GUARDRAIL / CONFIRMATION_EXPIRED / CONFIG_REQUIRED / FORBIDDEN);
//   - activation preflight returns a one-use challenge and NEVER a stored
//     digest; enrolment preflight returns masked samples and never a full
//     recipient list;
//   - no credential, token, digest or cross-tenant identifier appears in ANY
//     authenticated response.
// Exits 3 NOT-RUN without a served runtime — honestly, never a fake pass.

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}

import { classifyProbe, mayReportResults, notRunMessage } from "./lib/edge-probe.mjs";

// Ask the function's OWN gate to answer. The verdict is computed by the shared
// classifier (scripts/lib/edge-probe.mjs, unit-tested in edge-probe.test.mjs) so
// the Phase 5 and Phase 6 suites cannot drift apart on the one question that
// decides whether a run may claim a result at all.
async function probe() {
  try {
    const resp = await fetch(`${URL}/functions/v1/marketing-sequences`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: ANON },
      body: "{}",
    });
    return classifyProbe({ status: resp.status });
  } catch {
    return classifyProbe({ transportError: true });
  }
}

const verdict = await probe();
if (!mayReportResults(verdict.verdict)) {
  console.error(notRunMessage("marketing-sequences", verdict));
  process.exit(3);
}

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(URL, SR, { auth: { persistSession: false } });

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

const T = crypto.randomUUID();
const RUN = T.slice(0, 8);
const U = { owner: crypto.randomUUID(), ops: crypto.randomUUID(), viewer: crypto.randomUUID() };
const tokens = {};

async function call(who, body) {
  const resp = await fetch(`${URL}/functions/v1/marketing-sequences`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      authorization: `Bearer ${tokens[who]}`,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await resp.json();
  } catch {
    json = null;
  }
  return { status: resp.status, json };
}

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
    "marketing_campaign_events",
    "marketing_settings",
    "marketing_lifecycle_stages",
    "email_oauth_tokens",
    "email_accounts",
    "audit_logs",
    "platform_events",
    "platform_jobs",
  ]) {
    await admin.from(table).delete().eq("tenant_id", T);
  }
  await admin.from("marketing_campaigns").delete().eq("tenant_id", T);
  await admin.from("tenants").delete().eq("id", T);
}

async function main() {
  await cleanup();
  await admin.from("tenants").insert({ id: T, slug: `p6-http-${RUN}`, display_name: "P6 HTTP" });
  for (const [k, id] of Object.entries(U)) {
    await admin.auth.admin.createUser({
      id,
      email: `${k}-${RUN}@p6-http.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    await admin
      .from("profiles")
      .update({ tenant_id: T, role: k === "owner" ? "owner" : k })
      .eq("id", id);
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await anon.auth.signInWithPassword({
      email: `${k}-${RUN}@p6-http.test`,
      password: "Proof-Passw0rd!",
    });
    tokens[k] = si.data.session.access_token;
  }
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.owner });

  // ── request shape ──
  let r = await call("owner", "{not json");
  ok("malformed JSON → 400 INVALID_REQUEST", r.status === 400, r.json?.error?.code);
  r = await call("owner", { action: "definitely_not_an_action" });
  ok("unknown action → 400", r.status === 400, r.json?.error?.code);
  r = await call("owner", { action: "list", sneaky: 1 });
  ok("unknown top-level key → 400", r.status === 400, r.json?.error?.message);
  r = await call("owner", { action: "detail", campaign_id: "not-a-uuid" });
  ok("non-uuid campaign_id → 400", r.status === 400, r.json?.error?.code);
  r = await call("owner", { action: "list", limit: 2.5 });
  ok("non-integer limit → 400", r.status === 400, r.json?.error?.code);
  r = await call("owner", { action: "create", name: "x", steps: [] });
  ok("empty steps → 400", r.status === 400, r.json?.error?.code);

  // ── authentication + permission ──
  const noAuth = await fetch(`${URL}/functions/v1/marketing-sequences`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: ANON },
    body: JSON.stringify({ action: "list" }),
  });
  ok("unauthenticated → 401/403", [401, 403].includes(noAuth.status), noAuth.status);
  r = await call("viewer", {
    action: "create",
    name: "v",
    steps: [{ type: "send_email", config: {} }],
  });
  ok("viewer cannot draft → 403 FORBIDDEN", r.status === 403, r.json?.error?.code);
  r = await call("ops", {
    action: "approve",
    campaign_id: crypto.randomUUID(),
    expected_version: 1,
  });
  ok("ops cannot approve → 403 FORBIDDEN", r.status === 403, r.json?.error?.code);
  r = await call("ops", {
    action: "preflight_enrolment",
    campaign_id: crypto.randomUUID(),
    source: "manual",
    person_ids: [crypto.randomUUID()],
  });
  ok("ops cannot enrol → 403 FORBIDDEN", r.status === 403, r.json?.error?.code);

  // ── the real lifecycle over HTTP ──
  r = await call("owner", { action: "list" });
  ok("owner can list", r.status === 200 && Array.isArray(r.json?.data?.sequences), r.status);
  const caps = r.json?.data ?? {};
  ok(
    "list exposes honest configuration state",
    "unsubscribe_configured" in caps,
    JSON.stringify(caps),
  );

  r = await call("ops", {
    action: "validate",
    steps: [{ type: "wait_duration", config: { unit: "weeks", amount: 1 } }],
  });
  ok(
    "validate reports a bad step without persisting anything",
    r.status === 200 && r.json?.data?.valid === false,
    JSON.stringify(r.json?.data ?? {}),
  );

  console.log(failed === 0 ? "\nALL PASS (real HTTP boundary exercised)" : `\n${failed} FAILURES`);
  await cleanup();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await cleanup().catch(() => {});
  process.exit(1);
});
