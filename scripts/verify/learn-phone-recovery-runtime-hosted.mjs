/** TEST empty recovery acceptance. One retained job in the retired synthetic company.
 * No identities, grants, source recordings, provider requests or schedules created.
 */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readPhonePublicationCatalog, PHONE_SNAPSHOT } from "./learn-phone-publication-catalog.mjs";
import { assertNoPhoneCredentials } from "./learn-test-phone-deploy.mjs";
const tenant = "23665e71-465d-4548-b608-b81d80e95778",
  marker = "0be31171-a302-4840-80fd-f433726a7300";
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const same = (a, b) =>
  JSON.stringify([...a].sort((x, y) => x.name.localeCompare(y.name))) ===
  JSON.stringify([...b].sort((x, y) => x.name.localeCompare(y.name)));
try {
  check(
    process.argv.slice(2).join(" ") === "--verify --existing-cli-login" &&
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
    "Explicit TEST verification required",
  );
  const token = savedCliToken();
  await assertNoPhoneCredentials(token);
  const gate = (
    await communicationQuery(
      token,
      `select
 (select status='archived' and metadata->>'synthetic'='true' and metadata->>'learn_hosted_operator_session'='${marker}' from public.tenants where id='${tenant}') as fixture,
 (select count(*)::int from public.phone_recordings where tenant_id='${tenant}') as recordings,
 (select count(*)::int from public.platform_jobs where tenant_id='${tenant}') as fixture_jobs,
 (select count(*)::int from public.platform_jobs where status in ('queued','running','retrying')) as active_jobs`,
    )
  )[0];
  check(
    gate?.fixture === true &&
      gate.recordings === 0 &&
      gate.fixture_jobs === 0 &&
      gate.active_jobs === 0,
    "Empty retired synthetic fixture and idle TEST queue required",
  );
  const before = await readPhonePublicationCatalog(token),
    preserved = await communicationQuery(token, PHONE_SNAPSHOT);
  check(before.fingerprint === "dddd1851fbb564cd1f1252d8b1874d79", "TEST schema changed");
  const prior = JSON.parse(readFileSync(".verification-results/phone-recovery-runtime-prior.json"));
  check(same(prior.preserved, preserved), "Pre-deployment source fingerprints changed");
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
    const found = keys.filter((k) => k.name === role);
    check(found.length === 1, "Unique TEST key required");
    const key = found[0].api_key,
      claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
    check(claims.ref === TEST_PROJECT && claims.role === role, "TEST key scope differs");
    return key;
  };
  const anon = keyFor("anon"),
    service = keyFor("service_role");
  const serviceHeaders = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "x-serviceos-internal-key": service,
    "x-internal-tenant-id": tenant,
  };
  const checks = [];
  async function request(endpoint, method, headers, body) {
    const r = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/${endpoint}`, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    return { status: r.status, data: await r.json() };
  }
  for (const c of [
    {
      endpoint: "phone-process-pending",
      name: "missing JWT",
      method: "POST",
      headers: {},
      status: 401,
    },
    {
      endpoint: "phone-process-pending",
      name: "anonymous denied",
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      status: 401,
    },
    {
      endpoint: "phone-process-pending",
      name: "wrong method",
      method: "GET",
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      status: 405,
    },
    {
      endpoint: "platform-worker",
      name: "missing authority",
      method: "POST",
      headers: {},
      status: 403,
    },
    {
      endpoint: "platform-worker",
      name: "anonymous denied",
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      status: 403,
    },
    { endpoint: "platform-worker", name: "wrong method", method: "GET", headers: {}, status: 405 },
  ]) {
    const r = await request(c.endpoint, c.method, c.headers);
    check(r.status === c.status, `${c.name}: unexpected HTTP ${r.status}`);
    checks.push({ endpoint: c.endpoint, name: c.name, status: r.status, passed: true });
  }
  const idle = await request("platform-worker", "POST", serviceHeaders, {
    batch_size: 1,
    job_types: ["phone.process_pending"],
  });
  check(
    idle.status === 200 &&
      idle.data.success === true &&
      idle.data.claimed === 0 &&
      idle.data.unconfirmed === 0,
    "Worker must remain idle",
  );
  checks.push({
    endpoint: "platform-worker",
    name: "authorized idle queue",
    status: 200,
    claimed: 0,
    passed: true,
  });
  // Persist before the only request permitted to create a job; never resubmit an uncertain result.
  const journal = {
    projectRef: TEST_PROJECT,
    tenant,
    observedAt: new Date().toISOString(),
    action: "One empty manual recovery job in retired synthetic fixture",
    beforeFingerprint: before.fingerprint,
    preserved,
  };
  const fd = openSync(
    ".verification-results/phone-recovery-runtime-http-journal.json",
    "wx",
    0o600,
  );
  try {
    writeSync(fd, JSON.stringify(journal, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let result = null;
  try {
    result = await request("phone-process-pending", "POST", serviceHeaders, {
      tenant_id: tenant,
      limit: 1,
    });
  } catch {
    /* Inspect once, never resubmit. */
  }
  const jobs = await communicationQuery(
    token,
    `select id,status,attempt_count,records_processed,lease_expires_at,result from public.platform_jobs where tenant_id='${tenant}'`,
  );
  writeFileSync(
    ".verification-results/phone-recovery-runtime-http-observation.json",
    JSON.stringify({ status: result?.status ?? null, jobs }, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  check(
    jobs.length === 1 && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(jobs[0].id),
    "One identifiable synthetic recovery job required",
  );
  const job = jobs[0];
  check(
    result?.status === 200 &&
      result.data.success === true &&
      result.data.job_id === job.id &&
      result.data.processed === 0 &&
      result.data.eligible_backlog === 0 &&
      result.data.reason === "no_eligible_recordings",
    "Empty recovery HTTP result unconfirmed; inspect retained job before further action",
  );
  check(
    job.status === "succeeded" &&
      job.attempt_count === 1 &&
      job.records_processed === 0 &&
      job.lease_expires_at === null &&
      job.result.reason === "no_eligible_recordings",
    "Durable empty recovery outcome differs",
  );
  checks.push({
    endpoint: "phone-process-pending",
    name: "confirmed empty recovery lifecycle",
    status: 200,
    jobId: job.id,
    processed: 0,
    passed: true,
  });
  const after = await readPhonePublicationCatalog(token);
  const afterRows = await communicationQuery(
    token,
    PHONE_SNAPSHOT.replace(
      "from public.platform_jobs s",
      `from (select * from public.platform_jobs where id<>'${job.id}') s`,
    ),
  );
  check(
    after.fingerprint === before.fingerprint && same(preserved, afterRows),
    "Pre-existing TEST data changed",
  );
  const report = {
    version: "learn-phone-recovery-runtime-hosted/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "denials_idle_and_empty_recovery_verified",
    checks,
    preservedPreExistingDataSets: preserved.length,
    retainedSyntheticJobs: 1,
    providerRequests: 0,
    usersOrGrantsCreated: 0,
  };
  writeFileSync(
    ".verification-results/phone-recovery-runtime-http.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
