// ServiceOS — Meta adapter SERVED-HTTP proof: the complete Meta fixture
// journey through the genuinely served Edge boundary + the REAL
// platform-worker, exactly as production runs it. EVERY provider response is
// a META CONTRACT FIXTURE (NOT LIVE DATA) — no live Meta request is made,
// and nothing here may be read as a Meta connection.
//
// Requires `npx supabase functions serve --env-file <env>` with
// MARKETING_TEST_PROVIDER=enabled (which also unlocks meta-fixture:*
// credentials) and WORKER_SECRET set.
//
//   JOURNEY (run TWICE, fresh tenants): submit token → validate via worker →
//   discover TWO ad accounts (currency-labelled) → select act_111000111 →
//   connected (never before adapter verification) → initial sync → report
//   reconciles to the fixture (spend 100.00 GBP, leads 5, campaigns 2,
//   ad sets + ads present in facts) → repeat sync idempotent → incremental
//   restatement via rotation to the v2 fixture (101.50 / CPL 20.30) →
//   metrics degradation (degraded token) on a second connection → recovery →
//   invalid token NEVER connects → missing scope NEVER connects → rate
//   limit leaves the run leased/retryable → revoke blocks sync → cross-
//   tenant isolation.
//
// Run:
//   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... WORKER_SECRET=... \
//     node scripts/marketing-meta-http.test.mjs

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
const rid = () => `meta-${crypto.randomUUID()}`;

async function call(token, body) {
  const res = await fetch(FN, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function tick(n = 1) {
  for (let i = 0; i < n; i += 1) {
    const res = await fetch(WORKER, {
      method: "POST",
      headers: { "content-type": "application/json", "x-schedule-secret": WORKER_SECRET },
      body: JSON.stringify({ batch_size: 10 }),
    });
    if (res.status !== 200) {
      console.error("worker tick failed", res.status, await res.text());
      process.exit(1);
    }
    await res.json();
  }
}

async function makeTenant(run, key) {
  const tenant = crypto.randomUUID();
  const user = crypto.randomUUID();
  await admin
    .from("tenants")
    .insert({ id: tenant, slug: `meta-${key}-${run}`, display_name: `Meta ${key}` });
  const c = await admin.auth.admin.createUser({
    id: user,
    email: `${key}-${run}@meta-proof.test`,
    password: "Proof-Passw0rd!",
    email_confirm: true,
  });
  if (c.error) {
    console.error("user create failed", c.error.message);
    process.exit(1);
  }
  await admin.from("profiles").update({ tenant_id: tenant, role: "owner" }).eq("id", user);
  await admin.rpc("marketing_materialise_defaults", { p_tenant: tenant, p_actor: user });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({
    email: `${key}-${run}@meta-proof.test`,
    password: "Proof-Passw0rd!",
  });
  return { tenant, user, token: s.data.session.access_token };
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

async function metaConnect(t, name, credential, autoSelect = false) {
  const created = await call(t.token, {
    action: "account_create",
    provider: "meta",
    display_name: name,
    request_id: rid(),
  });
  ok(`${name}: meta account created`, created.status === 200 && created.body?.ok === true);
  const id = created.body?.data?.id;
  const cred = await call(t.token, {
    action: "credential_set",
    account_id: id,
    expected_version: created.body?.data?.version ?? 1,
    credential,
    request_id: rid(),
  });
  ok(
    `${name}: token stored once, never echoed`,
    cred.status === 200 &&
      cred.body?.data?.stored === true &&
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
    `${name}: connect queues adapter validation (never optimistic)`,
    conn.status === 200 && conn.body?.data?.status === "connecting",
  );
  await tick(1);
  let after = await call(t.token, { action: "list" });
  let arow = (after.body?.data?.accounts ?? []).find((a) => a.id === id);
  if (autoSelect && arow?.status === "connected" && (arow.discovered_accounts ?? []).length > 0) {
    await call(t.token, {
      action: "external_select",
      account_id: id,
      expected_version: arow.version,
      external_ref: arow.discovered_accounts[0].ref,
      request_id: rid(),
    });
    after = await call(t.token, { action: "list" });
    arow = (after.body?.data?.accounts ?? []).find((a) => a.id === id);
  }
  return { id, row: arow };
}

async function journey(round) {
  const run = crypto.randomUUID().slice(0, 8);
  console.log(`\n── meta round ${round} (${run}) ─────────────────────────`);
  const A = await makeTenant(run, "ownera");
  const X = await makeTenant(run, "ownerx");

  // catalogue truth over the served boundary
  const cat = await call(A.token, { action: "catalogue" });
  const metaDesc = (cat.body?.data?.providers ?? []).find((p) => p.provider === "meta");
  ok(
    "catalogue: meta implemented + fixture_tested over HTTP",
    metaDesc?.connectImplemented === true && metaDesc?.verification === "fixture_tested",
  );
  ok(
    "catalogue: nothing claims live verification",
    !(cat.body?.data?.providers ?? []).some((p) => p.verification === "live_verified"),
  );

  /* ── healthy journey ─────────────────────────────────────────────────── */
  const a = await metaConnect(A, "Meta healthy", "meta-fixture:healthy");
  ok(
    "healthy: connected ONLY after adapter verification",
    a.row?.status === "connected",
    a.row?.status,
  );
  ok("healthy: TWO ad accounts discovered", (a.row?.discovered_accounts ?? []).length === 2);
  ok(
    "healthy: discovery is currency-labelled",
    (a.row?.discovered_accounts ?? [])[0]?.name?.includes("(GBP)"),
  );
  const sel = await call(A.token, {
    action: "external_select",
    account_id: a.id,
    expected_version: a.row?.version,
    external_ref: "act_111000111",
    request_id: rid(),
  });
  ok("healthy: GBP ad account selected", sel.status === 200);
  await tick(2); // initial sync
  let rep = await call(A.token, { action: "report", account_id: a.id });
  ok(
    "healthy: spend reconciles to the fixture (100.00 GBP)",
    rep.body?.data?.totals?.spend === 100,
    rep.body?.data?.totals?.spend,
  );
  ok("healthy: leads reconcile (5)", rep.body?.data?.totals?.leads === 5);
  ok("healthy: CPL exact (20.00)", rep.body?.data?.cpl?.value === 20);
  ok("healthy: both campaigns (two pages) present", (rep.body?.data?.campaigns ?? []).length === 2);
  const factKinds = await admin
    .from("marketing_provider_facts")
    .select("fact_kind")
    .eq("tenant_id", A.tenant)
    .eq("account_id", a.id);
  const kinds = (factKinds.data ?? []).map((r) => r.fact_kind);
  ok("healthy: ad sets mapped to canonical ad_group facts", kinds.includes("ad_group"));
  ok("healthy: ads mapped to canonical ad facts", kinds.includes("ad"));
  ok("healthy: health healthy", rep.body?.data?.health === "healthy");

  // repeat sync converges
  await call(A.token, { action: "sync_request", account_id: a.id, request_id: rid() });
  await tick(2);
  rep = await call(A.token, { action: "report", account_id: a.id });
  ok(
    "healthy: repeat sync is idempotent (spend still 100.00)",
    rep.body?.data?.totals?.spend === 100,
  );

  // incremental restatement via v2 fixture
  const list2 = await call(A.token, { action: "list" });
  const aRow2 = (list2.body?.data?.accounts ?? []).find((x) => x.id === a.id);
  await call(A.token, {
    action: "credential_set",
    account_id: a.id,
    expected_version: aRow2?.version,
    credential: "meta-fixture:healthy_v2",
    request_id: rid(),
  });
  await call(A.token, { action: "sync_request", account_id: a.id, request_id: rid() });
  await tick(2);
  rep = await call(A.token, { action: "report", account_id: a.id });
  ok(
    "healthy: provider restatement supersedes (101.50 / CPL 20.30)",
    rep.body?.data?.totals?.spend === 101.5 && rep.body?.data?.cpl?.value === 20.3,
    rep.body?.data?.totals?.spend,
  );

  /* ── selection is REQUIRED before any provider sync ──────────────────── */
  const un = await metaConnect(A, "Meta unselected", "meta-fixture:healthy");
  ok("unselected: connected", un.row?.status === "connected");
  await tick(2); // seam-queued initial sync runs WITHOUT a selection
  const unRuns = await admin
    .from("marketing_provider_sync_runs")
    .select("status, error_class")
    .eq("tenant_id", A.tenant)
    .eq("account_id", un.id);
  ok(
    "unselected: initial sync fails HONESTLY as no_external_account (no provider access)",
    unRuns.data?.[0]?.status === "failed" &&
      unRuns.data?.[0]?.error_class === "no_external_account",
    JSON.stringify(unRuns.data?.[0]),
  );

  /* ── degraded + recovery ─────────────────────────────────────────────── */
  const d = await metaConnect(A, "Meta degraded", "meta-fixture:degraded", true);
  ok("degraded: connected (validation succeeds)", d.row?.status === "connected");
  await tick(2);
  let repD = await call(A.token, { action: "report", account_id: d.id });
  ok(
    "degraded: health degraded with a metrics-specific reason",
    repD.body?.data?.health === "degraded" &&
      repD.body?.data?.metrics_status?.reason === "metrics_unavailable",
  );
  ok("degraded: campaign feed survives", (repD.body?.data?.campaigns ?? []).length === 2);
  const listD = await call(A.token, { action: "list" });
  const dRow = (listD.body?.data?.accounts ?? []).find((x) => x.id === d.id);
  await call(A.token, {
    action: "credential_set",
    account_id: d.id,
    expected_version: dRow?.version,
    credential: "meta-fixture:healthy",
    request_id: rid(),
  });
  await call(A.token, { action: "sync_request", account_id: d.id, request_id: rid() });
  await tick(2);
  repD = await call(A.token, { action: "report", account_id: d.id });
  ok("degraded: recovery clears only the error", repD.body?.data?.health === "healthy");

  /* ── invalid + missing scope: NEVER connected ────────────────────────── */
  const inv = await metaConnect(A, "Meta invalid", "meta-fixture:invalid");
  ok(
    "invalid: expired token NEVER connects (190/463 → invalid_credential)",
    inv.row?.status === "error" && inv.row?.status_reason === "invalid_credential",
    inv.row?.status_reason,
  );
  const ns = await metaConnect(A, "Meta noscope", "meta-fixture:noscope");
  ok(
    "noscope: missing ads_read NEVER connects (10 → missing_scope)",
    ns.row?.status === "error" && ns.row?.status_reason === "missing_scope",
    ns.row?.status_reason,
  );

  /* ── rate limit: run stays retryable, nothing duplicated ─────────────── */
  const rl = await metaConnect(A, "Meta ratelimit", "meta-fixture:ratelimit", true);
  ok("ratelimit: connected (validation ok)", rl.row?.status === "connected");
  await tick(1); // initial sync claim: insights rate-limited → stays leased
  const rlRuns = await admin
    .from("marketing_provider_sync_runs")
    .select("status, attempts")
    .eq("tenant_id", A.tenant)
    .eq("account_id", rl.id);
  ok(
    "ratelimit: run left leased/retryable at attempt 1 (backoff, not failure)",
    rlRuns.data?.[0]?.status === "running" && rlRuns.data?.[0]?.attempts === 1,
    JSON.stringify(rlRuns.data?.[0]),
  );
  const rlFacts = await admin
    .from("marketing_provider_facts")
    .select("id")
    .eq("tenant_id", A.tenant)
    .eq("account_id", rl.id);
  ok("ratelimit: no facts ingested under throttle", (rlFacts.data ?? []).length === 0);

  /* ── revoke blocks sync; cross-tenant isolation ──────────────────────── */
  const listR = await call(A.token, { action: "list" });
  const invRow = (listR.body?.data?.accounts ?? []).find((x) => x.id === inv.id);
  const rev = await call(A.token, {
    action: "revoke",
    account_id: inv.id,
    expected_version: invRow?.version,
    request_id: rid(),
  });
  ok("revoke: lands terminal", rev.status === 200 && rev.body?.data?.status === "revoked");
  const syncRevoked = await call(A.token, {
    action: "sync_request",
    account_id: inv.id,
    request_id: rid(),
  });
  ok("revoke: sync refused after revocation", syncRevoked.status === 422);
  const xRep = await call(X.token, { action: "report", account_id: a.id });
  ok("isolation: foreign tenant reads NOT_FOUND", xRep.status === 404);
  const xList = await call(X.token, { action: "list" });
  ok(
    "isolation: foreign tenant sees zero meta connections",
    (xList.body?.data?.accounts ?? []).length === 0,
  );

  for (const t of [A, X]) await cleanupTenant(t);
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
