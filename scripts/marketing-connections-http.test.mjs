// ServiceOS — Marketing provider-connections SERVED-HTTP proof + the
// three-tenant end-to-end journey. Runs against a genuinely SERVED local
// Edge runtime (`npx supabase functions serve --env-file <env>` with
// MARKETING_TEST_PROVIDER=enabled and WORKER_SECRET set) — every request
// below crosses the real HTTP boundary (CORS, JWT auth, body parsing,
// permission gates, RPC dispatch), and worker execution is driven through
// the REAL platform-worker function, exactly as production runs it.
//
// NO real provider is contacted: the only adapter is the deterministic
// 'serviceos_test_provider' simulator, env-gated, absent from the
// production catalogue.
//
//   BOUNDARY — CORS preflight; missing/malformed bearer; viewer without
//   marketing.view forbidden; malformed body; unknown action; unknown key;
//   the test provider REFUSED for creation when presented as any real
//   provider path; safe error shapes (no stack, no secret echo).
//   TENANT A (healthy) — create → credential 'sim:healthy' (stored once,
//   never echoed) → connect (connecting, validation queued) → worker →
//   connected + 2 discovered accounts + initial sync queued → worker →
//   facts recorded → report reconciles (spend 100.00, leads 5, CPL 20.00,
//   2 campaigns, healthy, metrics available) → duplicate sync request id
//   replays → repeat sync converges (identical report) → rotate credential
//   to 'sim:healthy_v2' → sync → incremental supersession (spend 101.50,
//   CPL 20.30) → freshness fresh.
//   TENANT B (degraded) — connect ok → sync → run failed
//   'metrics_unavailable' while the campaign feed survives → report
//   degraded + metrics-specific error → rotate to a working credential →
//   sync → healthy again, feed intact.
//   TENANT C (failure + security) — credential 'sim:invalid' → connect →
//   worker → error/'invalid_credential' (NEVER connected) → credential
//   replay stores nothing → revoke → sync refused → cross-tenant probes
//   read NOT_FOUND/zero.
//   RETRY — 'sim:flaky' leaves the run leased; forced lease expiry +
//   another worker tick burns attempt 2 (the attempts>=10 poison ceiling is
//   SQL-suite proven).
//
// The whole journey runs TWICE (fresh tenants) to prove deterministic
// replay and cleanup.
//
// Run:
//   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... WORKER_SECRET=... \
//     node scripts/marketing-connections-http.test.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const FN = `${URL}/functions/v1/marketing-provider-connections`;
const WORKER = `${URL}/functions/v1/platform-worker`;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const WORKER_SECRET = process.env.WORKER_SECRET;
if (!SR || !ANON || !WORKER_SECRET) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / WORKER_SECRET env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed += 1;
};
const rid = () => `http-${crypto.randomUUID()}`;

async function call(token, body) {
  const res = await fetch(FN, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

async function tickWorker(n = 1) {
  for (let i = 0; i < n; i += 1) {
    const res = await fetch(WORKER, {
      method: "POST",
      headers: { "content-type": "application/json", "x-schedule-secret": WORKER_SECRET },
      body: JSON.stringify({ batch_size: 10 }),
    });
    if (res.status !== 200) {
      console.error("platform-worker tick failed", res.status, await res.text());
      process.exit(1);
    }
    await res.json();
  }
}

async function makeTenant(run, key, role) {
  const tenant = crypto.randomUUID();
  const user = crypto.randomUUID();
  await admin.from("tenants").insert({
    id: tenant,
    slug: `p10h-${key}-${run}`,
    display_name: `P10 HTTP ${key}`,
  });
  const c = await admin.auth.admin.createUser({
    id: user,
    email: `${key}-${run}@p10h-proof.test`,
    password: "Proof-Passw0rd!",
    email_confirm: true,
  });
  if (c.error) {
    console.error("user create failed", c.error.message);
    process.exit(1);
  }
  await admin.from("profiles").update({ tenant_id: tenant, role }).eq("id", user);
  await admin.rpc("marketing_materialise_defaults", { p_tenant: tenant, p_actor: user });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({
    email: `${key}-${run}@p10h-proof.test`,
    password: "Proof-Passw0rd!",
  });
  if (s.error) {
    console.error("sign-in failed", s.error.message);
    process.exit(1);
  }
  return {
    tenant,
    user,
    token: s.data.session.access_token,
    email: `${key}-${run}@p10h-proof.test`,
  };
}

async function cleanupTenant(t) {
  await admin.auth.admin.deleteUser(t.user).catch(() => {});
  for (const table of [
    "marketing_provider_facts",
    "marketing_provider_sync_runs",
    "marketing_provider_account_versions",
    "marketing_provider_accounts",
    "marketing_request_keys",
    "marketing_access_grants",
    "marketing_lifecycle_stages",
    "marketing_settings",
    "platform_jobs",
    "platform_events",
    "audit_logs",
  ]) {
    await admin.from(table).delete().eq("tenant_id", t.tenant);
  }
  await admin.from("tenants").delete().eq("id", t.tenant);
}

async function connectAccount(t, displayName, credential) {
  const created = await call(t.token, {
    action: "account_create",
    provider: "serviceos_test_provider",
    display_name: displayName,
    request_id: rid(),
  });
  ok(`${displayName}: account created`, created.status === 200 && created.body?.ok === true);
  const id = created.body?.data?.id;
  const cred = await call(t.token, {
    action: "credential_set",
    account_id: id,
    expected_version: created.body?.data?.version ?? 1,
    credential,
    request_id: rid(),
  });
  ok(
    `${displayName}: credential stored once`,
    cred.status === 200 && cred.body?.data?.stored === true,
  );
  ok(
    `${displayName}: credential value never echoed`,
    !JSON.stringify(cred.body).includes(credential),
  );
  const listed = await call(t.token, { action: "list" });
  const row = (listed.body?.data?.accounts ?? []).find((a) => a.id === id);
  const conn = await call(t.token, {
    action: "connect",
    account_id: id,
    expected_version: row?.version,
    request_id: rid(),
  });
  ok(
    `${displayName}: connect enters connecting with queued validation`,
    conn.status === 200 && conn.body?.data?.status === "connecting",
    conn.body?.data?.status,
  );
  await tickWorker(1); // runs marketing.provider_connect
  const after = await call(t.token, { action: "list" });
  const arow = (after.body?.data?.accounts ?? []).find((a) => a.id === id);
  return { id, row: arow };
}

async function syncNow(t, id, label, ticks = 1) {
  const req = await call(t.token, { action: "sync_request", account_id: id, request_id: rid() });
  ok(`${label}: sync queued`, req.status === 200 && req.body?.data?.status === "queued");
  await tickWorker(ticks);
  return req.body?.data?.run_id;
}

async function journey(round) {
  const run = crypto.randomUUID().slice(0, 8);
  console.log(`\n── round ${round} (${run}) ─────────────────────────────`);
  const A = await makeTenant(run, "ownera", "owner");
  const B = await makeTenant(run, "adminb", "admin");
  const C = await makeTenant(run, "ownerc", "owner");
  const V = await makeTenant(run, "viewer", "viewer");
  await admin.from("profiles").update({ tenant_id: A.tenant, role: "viewer" }).eq("id", V.user);

  /* ── boundary checks (once per round) ─────────────────────────────────── */
  const pre = await fetch(FN, { method: "OPTIONS" });
  ok("CORS preflight answers 200", pre.status === 200);
  const noauth = await call(null, { action: "list" });
  ok("missing bearer refused", noauth.status === 401 || noauth.status === 400, noauth.status);
  const badtok = await call("not-a-jwt", { action: "list" });
  ok("malformed bearer refused", badtok.status === 401, badtok.status);
  const viewer = await call(V.token, { action: "list" });
  ok("viewer without marketing.view is FORBIDDEN", viewer.status === 403, viewer.status);
  const badbody = await call(A.token, "{nope");
  ok("malformed body refused", badbody.status === 400);
  const badaction = await call(A.token, { action: "explode" });
  ok("unknown action refused", badaction.status === 400);
  const badkey = await call(A.token, { action: "list", surprise: 1 });
  ok("unknown key refused", badkey.status === 400);
  ok(
    "error shape is safe (no stack, no service detail)",
    !JSON.stringify(badaction.body).match(/stack|postgres|service_role/i),
  );
  // REGRESSION LOCK (Phase 10A visual-QA finding): the allowed marketing-access
  // verdict must carry the caller's OWN role — without it the owner/admin
  // affordance mirror (Ads/Connections management) can never render.
  const accessRes = await fetch(`${URL}/functions/v1/marketing-access`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${A.token}`,
    },
    body: JSON.stringify({ action: "access" }),
  });
  const accessBody = await accessRes.json();
  ok(
    "marketing-access allowed verdict carries the caller's own role",
    accessBody?.data?.can_view === true && accessBody?.data?.role === "owner",
    accessBody?.data?.role,
  );

  /* ── TENANT A — healthy ───────────────────────────────────────────────── */
  const a = await connectAccount(A, "A healthy", "sim:healthy");
  ok(
    "A: genuinely connected after adapter validation",
    a.row?.status === "connected",
    a.row?.status,
  );
  ok("A: two external accounts discovered", (a.row?.discovered_accounts ?? []).length === 2);
  const sel = await call(A.token, {
    action: "external_select",
    account_id: a.id,
    expected_version: a.row?.version,
    external_ref: "acct-100",
    request_id: rid(),
  });
  ok(
    "A: external account selected",
    sel.status === 200 && sel.body?.data?.external_account_name === "Sim Account 100",
  );
  // the initial sync was queued by the seam — drain it
  await tickWorker(2);
  let rep = await call(A.token, { action: "report", account_id: a.id });
  ok(
    "A: report spend reconciles to 100.00",
    rep.body?.data?.totals?.spend === 100,
    rep.body?.data?.totals?.spend,
  );
  ok("A: report leads reconcile to 5", rep.body?.data?.totals?.leads === 5);
  ok("A: CPL is exactly 20.00", rep.body?.data?.cpl?.value === 20);
  ok("A: two campaigns project", (rep.body?.data?.campaigns ?? []).length === 2);
  ok("A: health healthy", rep.body?.data?.health === "healthy", rep.body?.data?.health);
  ok("A: metrics available", rep.body?.data?.metrics_status?.state === "available");

  // duplicate request id replays the SAME run
  const dupId = rid();
  const s1 = await call(A.token, { action: "sync_request", account_id: a.id, request_id: dupId });
  const s2 = await call(A.token, { action: "sync_request", account_id: a.id, request_id: dupId });
  ok(
    "A: duplicate sync request id converges on one run",
    s1.body?.data?.run_id === s2.body?.data?.run_id && s2.body?.data?.replayed === true,
  );
  await tickWorker(2);
  rep = await call(A.token, { action: "report", account_id: a.id });
  ok("A: repeated sync is idempotent (spend still 100.00)", rep.body?.data?.totals?.spend === 100);

  // incremental: rotate the credential to the v2 fixture and sync
  const afterList = await call(A.token, { action: "list" });
  const aRow2 = (afterList.body?.data?.accounts ?? []).find((x) => x.id === a.id);
  const rot = await call(A.token, {
    action: "credential_set",
    account_id: a.id,
    expected_version: aRow2?.version,
    credential: "sim:healthy_v2",
    request_id: rid(),
  });
  ok("A: rotation stored", rot.status === 200 && rot.body?.data?.rotated === true);
  await syncNow(A, a.id, "A incremental", 2);
  rep = await call(A.token, { action: "report", account_id: a.id });
  ok(
    "A: incremental supersession — spend 101.50",
    rep.body?.data?.totals?.spend === 101.5,
    rep.body?.data?.totals?.spend,
  );
  ok("A: incremental CPL 20.30", rep.body?.data?.cpl?.value === 20.3);
  const freshList = await call(A.token, { action: "list" });
  const aRow3 = (freshList.body?.data?.accounts ?? []).find((x) => x.id === a.id);
  ok("A: freshness is fresh", aRow3?.freshness?.state === "fresh", aRow3?.freshness?.state);

  /* ── TENANT B — degraded ──────────────────────────────────────────────── */
  const b = await connectAccount(B, "B degraded", "sim:degraded");
  ok("B: connected", b.row?.status === "connected", b.row?.status);
  await tickWorker(2); // initial sync: feed ok, metrics fail
  let repB = await call(B.token, { action: "report", account_id: b.id });
  ok("B: health degraded", repB.body?.data?.health === "degraded", repB.body?.data?.health);
  ok(
    "B: metrics-specific error shown",
    repB.body?.data?.metrics_status?.state === "unavailable" &&
      repB.body?.data?.metrics_status?.reason === "metrics_unavailable",
  );
  ok("B: campaign feed survives", (repB.body?.data?.campaigns ?? []).length === 2);
  ok(
    "B: spend honestly unavailable, never zero",
    repB.body?.data?.totals?.spend === null &&
      repB.body?.data?.totals?.spend_unavailable_reason === "no_spend_facts",
  );
  // recovery: rotate to a working credential; a later retry succeeds
  const bList = await call(B.token, { action: "list" });
  const bRow = (bList.body?.data?.accounts ?? []).find((x) => x.id === b.id);
  await call(B.token, {
    action: "credential_set",
    account_id: b.id,
    expected_version: bRow?.version,
    credential: "sim:healthy",
    request_id: rid(),
  });
  await syncNow(B, b.id, "B recovery", 2);
  repB = await call(B.token, { action: "report", account_id: b.id });
  ok("B: recovered to healthy", repB.body?.data?.health === "healthy", repB.body?.data?.health);
  ok(
    "B: earlier feed data preserved through recovery",
    (repB.body?.data?.campaigns ?? []).length >= 2,
  );

  /* ── TENANT C — failure + security ────────────────────────────────────── */
  const c = await connectAccount(C, "C failing", "sim:invalid");
  ok("C: NEVER connected on an invalid credential", c.row?.status === "error", c.row?.status);
  ok("C: the reason is exact", c.row?.status_reason === "invalid_credential", c.row?.status_reason);
  // credential replay stores nothing and rotates nothing
  const credRid = rid();
  const c1 = await call(C.token, {
    action: "credential_set",
    account_id: c.id,
    expected_version: c.row?.version,
    credential: "sim:invalid",
    request_id: credRid,
  });
  const c2 = await call(C.token, {
    action: "credential_set",
    account_id: c.id,
    expected_version: c.row?.version,
    credential: "sim:invalid",
    request_id: credRid,
  });
  ok(
    "C: credential replay is inert",
    c1.body?.data?.stored === true &&
      c2.body?.data?.stored === false &&
      c2.body?.data?.replayed === true,
  );
  const cList = await call(C.token, { action: "list" });
  const cRow = (cList.body?.data?.accounts ?? []).find((x) => x.id === c.id);
  const rev = await call(C.token, {
    action: "revoke",
    account_id: c.id,
    expected_version: cRow?.version,
    request_id: rid(),
  });
  ok("C: revoked", rev.status === 200 && rev.body?.data?.status === "revoked");
  const syncAfterRevoke = await call(C.token, {
    action: "sync_request",
    account_id: c.id,
    request_id: rid(),
  });
  ok("C: sync refused after revocation", syncAfterRevoke.status === 422, syncAfterRevoke.status);

  // cross-tenant probes: A cannot see or touch B/C material
  const xReport = await call(A.token, { action: "report", account_id: c.id });
  ok("cross-tenant report reads NOT_FOUND", xReport.status === 404, xReport.status);
  const xSync = await call(A.token, {
    action: "sync_request",
    account_id: b.id,
    request_id: rid(),
  });
  ok("cross-tenant sync reads NOT_FOUND", xSync.status === 404, xSync.status);
  const xRuns = await call(A.token, { action: "runs", account_id: c.id });
  ok("cross-tenant runs list is EMPTY", (xRuns.body?.data?.runs ?? []).length === 0);

  /* ── retry semantics through the real worker ──────────────────────────── */
  const f = await connectAccount(A, "A flaky", "sim:flaky");
  ok("flaky: connected (validation succeeds)", f.row?.status === "connected", f.row?.status);
  await tickWorker(1); // initial sync claim: adapter fails retryably → stays leased
  const runsA = await admin
    .from("marketing_provider_sync_runs")
    .select("id, status, attempts")
    .eq("tenant_id", A.tenant)
    .eq("account_id", f.id);
  const flakyRun = (runsA.data ?? [])[0];
  ok(
    "flaky: retryable failure leaves the run leased at attempt 1",
    flakyRun?.status === "running" && flakyRun?.attempts === 1,
    JSON.stringify(flakyRun),
  );
  await admin
    .from("marketing_provider_sync_runs")
    .update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", flakyRun.id);
  // re-prime the drain (the continuation job completed while the lease held)
  await call(A.token, { action: "sync_request", account_id: f.id, request_id: rid() }).catch(
    () => {},
  );
  await admin.rpc("marketing_provider_sync_enqueue_due", { p_tenant: A.tenant });
  const job = await admin.from("platform_jobs").insert({
    tenant_id: A.tenant,
    module_id: "marketing.connections",
    job_type: "marketing.provider_sync",
    job_key: `mkpsync-retry:${A.tenant}`,
    status: "queued",
    priority: 100,
    max_attempts: 5,
    payload: {},
  });
  ok("flaky: drain re-primed", !job.error, job.error?.message);
  await tickWorker(1);
  const runsA2 = await admin
    .from("marketing_provider_sync_runs")
    .select("attempts, status")
    .eq("id", flakyRun.id)
    .single();
  ok(
    "flaky: expired lease reclaimed, attempt 2 burned (poison ceiling is SQL-proven)",
    runsA2.data?.attempts === 2,
    JSON.stringify(runsA2.data),
  );

  for (const t of [A, B, C, V]) await cleanupTenant(t);
}

async function main() {
  await journey(1);
  await journey(2);
  console.log(failed === 0 ? "\nALL PASS (both rounds)" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
