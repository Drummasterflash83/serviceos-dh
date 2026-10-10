/** TEST denial/paused-path acceptance only; no identity or provider setup. */
import { readFileSync, writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { assertNoPhoneCredentials } from "./learn-test-phone-deploy.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readAutoCatalog, AUTO_SNAPSHOT } from "./learn-slack-auto-threads-catalog.mjs";
const check = (ok, msg) => {
  if (!ok) throw Error(msg);
};
try {
  check(
    process.argv.slice(2).join(" ") === "--verify --existing-cli-login" &&
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
    "Explicit TEST verification required",
  );
  const token = savedCliToken(),
    tenant = "23665e71-465d-4548-b608-b81d80e95778";
  await assertNoPhoneCredentials(token);
  const state = await communicationQuery(
    token,
    `select status from public.tenants where id='${tenant}'`,
  );
  check(state.length === 1 && state[0].status === "archived", "Retired fixture must remain paused");
  const before = await readAutoCatalog(token),
    preserved = await communicationQuery(token, AUTO_SNAPSHOT);
  check(before.fingerprint === "528d0756cc0d2388d6f0dc098b653e0d", "TEST schema changed");
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  check(response.ok, "TEST keys unavailable");
  const keys = await response.json();
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
  const body = JSON.stringify({ tenant_id: tenant });
  const cases = [
    { name: "missing JWT", headers: {}, method: "POST", status: 401 },
    {
      name: "anonymous caller",
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      method: "POST",
      status: 401,
    },
    {
      name: "wrong method",
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      method: "GET",
      status: 405,
    },
    {
      name: "retired fixture capture paused",
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "x-serviceos-internal-key": service,
        "x-internal-tenant-id": tenant,
      },
      method: "POST",
      status: 409,
      code: "learn_capture_paused",
    },
  ];
  const checks = [];
  for (const endpoint of ["simwood-sync-calls", "simwood-sync-recordings"])
    for (const c of cases) {
      const r = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/${endpoint}`, {
        method: c.method,
        headers: { ...c.headers, "Content-Type": "application/json" },
        ...(c.method === "POST" ? { body } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      check(
        r.status === c.status && (!c.code || data.error?.code === c.code),
        `${endpoint}: ${c.name} unexpected status ${r.status}`,
      );
      checks.push({ endpoint, name: c.name, status: r.status, passed: true });
    }
  const after = await readAutoCatalog(token),
    afterRows = await communicationQuery(token, AUTO_SNAPSHOT);
  const sort = (x) => JSON.stringify([...x].sort((a, b) => a.name.localeCompare(b.name)));
  const prior = JSON.parse(readFileSync(".verification-results/phone-page-guards-prior.json"));
  check(
    after.fingerprint === before.fingerprint &&
      sort(preserved) === sort(afterRows) &&
      sort(prior.preserved) === sort(afterRows),
    "TEST retained sources changed",
  );
  const report = {
    version: "learn-phone-page-guards-hosted/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "denials_and_paused_path_verified",
    checks,
    preservedDataSets: preserved.length,
    providerRequests: 0,
    usersOrGrantsCreated: 0,
  };
  writeFileSync(
    ".verification-results/phone-page-guards-http.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
