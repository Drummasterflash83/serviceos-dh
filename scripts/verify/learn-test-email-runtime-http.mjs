/** Hosted boundary/empty-worker checks. Credentials remain in memory only. */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { RUNTIME_SNAPSHOT_QUERY, readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import { EMAIL_RUNTIME_DATABASE, edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { EMAIL_RUNTIME_ENDPOINTS } from "./learn-email-runtime-edge-bundle.mjs";
const checks = [];
let phase = "preflight";
try {
  if (
    process.argv.slice(2).join(" ") !== "--existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("TEST operation required");
  const token = savedCliToken();
  const [schema, endpoints, before, active] = await Promise.all([
    readRuntimeCatalog(token),
    edgeInventory(token),
    communicationQuery(token, RUNTIME_SNAPSHOT_QUERY),
    communicationQuery(
      token,
      "select count(*)::int as count from public.platform_jobs where status in ('queued','running','retrying')",
    ),
  ]);
  if (
    schema.fingerprint !== EMAIL_RUNTIME_DATABASE ||
    active[0].count !== 0 ||
    !EMAIL_RUNTIME_ENDPOINTS.every((e) =>
      endpoints.some(
        (r) =>
          r.slug === e.name &&
          r.version === 4 &&
          r.status === "ACTIVE" &&
          r.verify_jwt === e.verifyJwt,
      ),
    )
  )
    throw Error("Exact runtime and idle queue required");
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!r.ok) throw Error("Keys unavailable");
  const keys = await r.json();
  function key(name) {
    const matches = keys.filter((k) => k.name === name);
    if (matches.length !== 1) throw Error("Unique TEST key required");
    const value = matches[0].api_key;
    const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url"));
    if (claims.ref !== TEST_PROJECT || claims.role !== name) throw Error("Wrong key scope");
    return value;
  }
  const service = key("service_role"),
    anon = key("anon");
  async function probe(name, headers, body, status, code) {
    phase = name + ":" + (code ?? "empty-worker");
    const response = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    const observed = {
      name,
      status: response.status,
      code: typeof value?.error?.code === "string" ? value.error.code : null,
    };
    checks.push(observed);
    if (response.status !== status || (code && value?.error?.code !== code))
      throw Error("Unexpected boundary response");
    return value;
  }
  await probe("platform-worker", {}, {}, 403, "forbidden");
  await probe(
    "platform-worker",
    { Authorization: `Bearer ${anon}`, "x-serviceos-internal-key": "wrong" },
    {},
    403,
    "forbidden",
  );
  const internal = {
    Authorization: `Bearer ${service}`,
    apikey: service,
    "x-serviceos-internal-key": service,
  };
  const empty = await probe(
    "platform-worker",
    internal,
    { job_types: ["acceptance." + randomUUID()], batch_size: 1 },
    200,
  );
  if (empty.claimed !== 0 || empty.failed !== 0 || !empty.success)
    throw Error("Worker probe differs");
  for (const name of EMAIL_RUNTIME_ENDPOINTS.filter((e) => e.name !== "platform-worker").map(
    (e) => e.name,
  )) {
    await probe(name, {}, {}, 401);
    await probe(name, internal, { email_account_id: randomUUID() }, 403, "forbidden");
    await probe(
      name,
      { ...internal, "x-internal-tenant-id": randomUUID() },
      { email_account_id: randomUUID() },
      409,
      "learn_capture_paused",
    );
    await probe(
      name,
      { ...internal, "x-internal-tenant-id": randomUUID() },
      { email_account_id: randomUUID(), tenant_id: randomUUID() },
      403,
      "tenant_mismatch",
    );
  }
  phase = "preservation";
  const after = await communicationQuery(token, RUNTIME_SNAPSHOT_QUERY);
  const normalize = (rows) => JSON.stringify(rows.sort((a, b) => a.name.localeCompare(b.name)));
  if (normalize(before) !== normalize(after)) throw Error("Source preservation differs");
  const report = {
    version: "learn-email-runtime-http/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "boundary_checks_passed",
    checks,
    emptyWorker: empty,
    preservedDataSets: after.length,
    limitations: [
      "No signed-in tenant-user session or provider capture tested; existing credentials remain in memory only.",
      "No source records, credentials, secrets, schedules or production changes.",
    ],
  };
  writeFileSync(
    "docs/operations/evidence/learn-email-runtime-http-2026-10-10.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch {
  writeFileSync(
    ".verification-results/email-runtime-http-unconfirmed.json",
    JSON.stringify({ state: "unconfirmed", phase, checks }, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.error(
    "TEST HTTP checks did not confirm at " +
      phase +
      "; inspect the saved safe status report before retrying.",
  );
  process.exitCode = 1;
}
