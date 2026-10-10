/** Hosted denial/paused-path checks only. No credentials, users, grants or schedules are created. */
import { writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhoneSettlementCatalog,
  SETTLEMENT_SNAPSHOT,
} from "./learn-phone-settlement-catalog.mjs";
import { assertNoPhoneCredentials } from "./learn-test-phone-deploy.mjs";
import { PHONE_SETTLEMENT_RUNTIME_SCHEMA } from "./learn-test-phone-settlement-deploy.mjs";
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const canonical = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
try {
  check(
    process.argv.slice(2).join(" ") === "--verify --existing-cli-login" &&
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
    "Explicit TEST verification required",
  );
  const token = savedCliToken(),
    tenant = "23665e71-465d-4548-b608-b81d80e95778";
  await assertNoPhoneCredentials(token);
  const inventory = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/secrets`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  check(inventory.ok, "Secret-name inventory unavailable");
  const secrets = await inventory.json();
  check(
    Array.isArray(secrets) && !secrets.some((s) => s.name === "PHONE_SCHEDULE_SECRET"),
    "Scheduler must remain unconfigured during these checks",
  );
  const [before, preserved, fixture] = await Promise.all([
    readPhoneSettlementCatalog(token),
    communicationQuery(token, SETTLEMENT_SNAPSHOT),
    communicationQuery(
      token,
      `select status,(select count(*)::int from public.learn_phone_import_completions) as completions,(select count(*)::int from public.learn_phone_schedule_settlements) as settlements,(select count(*)::int from public.phone_sync_runs where id='00000000-0000-4000-8000-000000000099') as prohibited_run from public.tenants where id='${tenant}'`,
    ),
  ]);
  check(before.fingerprint === PHONE_SETTLEMENT_RUNTIME_SCHEMA, "TEST schema changed");
  check(
    fixture.length === 1 &&
      fixture[0].status === "archived" &&
      fixture[0].completions === 0 &&
      fixture[0].settlements === 0 &&
      fixture[0].prohibited_run === 0,
    "Retired fixture and empty new receipts required",
  );
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  check(r.ok, "TEST keys unavailable");
  const keys = await r.json();
  const keyFor = (role) => {
    const rows = keys.filter((k) => k.name === role);
    check(rows.length === 1, "Unique TEST key required");
    const key = rows[0].api_key,
      claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
    check(claims.ref === TEST_PROJECT && claims.role === role, "TEST key scope differs");
    return key;
  };
  const anon = keyFor("anon"),
    service = keyFor("service_role");
  const auth = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });
  const serviceHeaders = {
    ...auth(service),
    "x-serviceos-internal-key": service,
    "x-internal-tenant-id": tenant,
  };
  const checks = [];
  async function request(endpoint, c, path = "functions/v1/") {
    const r = await fetch(`https://${TEST_PROJECT}.supabase.co/${path}${endpoint}`, {
      method: c.method ?? "POST",
      headers: { ...c.headers, "Content-Type": "application/json" },
      ...((c.method ?? "POST") === "POST"
        ? { body: JSON.stringify(c.body ?? { tenant_id: tenant }) }
        : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.json();
    check(
      c.statuses.includes(r.status) && (!c.code || (body.error?.code ?? body.code) === c.code),
      `${endpoint}: ${c.name} unexpected response ${r.status}`,
    );
    checks.push({ endpoint, name: c.name, status: r.status, passed: true });
  }
  for (const endpoint of ["simwood-sync-calls", "simwood-sync-recordings"])
    for (const c of [
      { name: "missing JWT", headers: {}, statuses: [401] },
      { name: "anonymous denied", headers: auth(anon), statuses: [401] },
      { name: "wrong method", method: "GET", headers: auth(anon), statuses: [405] },
      {
        name: "retired fixture capture paused",
        headers: serviceHeaders,
        statuses: [409],
        code: "learn_capture_paused",
      },
      {
        name: "zero-duration range refused",
        headers: serviceHeaders,
        statuses: [400],
        code: "invalid_range",
        body: { tenant_id: tenant, from: "2026-10-10T00:00:00Z", to: "2026-10-10T00:00:00Z" },
      },
    ])
      await request(endpoint, c);
  for (const c of [
    { name: "wrong method", method: "GET", headers: {}, statuses: [405] },
    {
      name: "unconfigured scheduler refuses missing authority",
      headers: {},
      statuses: [500],
      code: "config_error",
    },
    {
      name: "unconfigured scheduler refuses anonymous caller",
      headers: auth(anon),
      statuses: [500],
      code: "config_error",
    },
    {
      name: "unconfigured scheduler refuses arbitrary secret",
      headers: { "x-schedule-secret": "synthetic-not-a-secret" },
      statuses: [500],
      code: "config_error",
    },
  ])
    await request("phone-scheduled-sync", c);
  for (const [name, body] of [
    [
      "learn_phone_complete_import",
      {
        p_tenant: tenant,
        p_run: "00000000-0000-4000-8000-000000000099",
        p_account: "00000000-0000-4000-8000-000000000098",
        p_connector: "00000000-0000-4000-8000-000000000097",
        p_customer: "synthetic-denied",
        p_kind: "calls",
        p_pages: 1,
        p_records: 0,
        p_metadata: {
          window_complete: true,
          pages_fetched: 1,
          customer_id: "synthetic-denied",
          skipped_no_call_id: 0,
        },
      },
    ],
    [
      "learn_phone_settle_schedule",
      {
        p_tenant: tenant,
        p_run: "00000000-0000-4000-8000-000000000099",
        p_calls: "00000000-0000-4000-8000-000000000098",
        p_recordings: "00000000-0000-4000-8000-000000000097",
        p_outcome: "success",
        p_errors: {},
      },
    ],
  ]) {
    await request(
      name,
      {
        name: "anonymous RPC denied",
        headers: auth(anon),
        statuses: [401, 403],
        code: "42501",
        body,
      },
      "rest/v1/rpc/",
    );
    await request(
      name,
      {
        name: "service RPC missing run denied",
        headers: auth(service),
        statuses: [409],
        code: "PT409",
        body,
      },
      "rest/v1/rpc/",
    );
  }
  const [after, afterRows, counts] = await Promise.all([
    readPhoneSettlementCatalog(token),
    communicationQuery(token, SETTLEMENT_SNAPSHOT),
    communicationQuery(
      token,
      "select (select count(*)::int from public.learn_phone_import_completions) as completions,(select count(*)::int from public.learn_phone_schedule_settlements) as settlements",
    ),
  ]);
  check(
    after.fingerprint === before.fingerprint && canonical(preserved) === canonical(afterRows),
    "TEST schema or retained sources changed",
  );
  check(
    counts.length === 1 && counts[0].completions === 0 && counts[0].settlements === 0,
    "Unexpected new receipt rows",
  );
  const report = {
    version: "learn-phone-settlement-hosted/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "denials_paused_path_and_disabled_scheduler_verified",
    checks,
    preservedDataSets: preserved.length,
    providerRequests: 0,
    usersOrGrantsCreated: 0,
    scheduleConfigured: false,
    limits: [
      "Positive synthetic import/scheduler acceptance is the separate hosted SQL savepoint probe.",
      "No real provider, paid processing, configured scheduler dispatch, signed-in browser or production acceptance.",
    ],
  };
  writeFileSync(
    ".verification-results/phone-settlement-http.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
