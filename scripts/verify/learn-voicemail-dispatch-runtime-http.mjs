/** Hosted TEST worker boot/auth and empty queue RPC boundaries; no source reads. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readVoicemailDispatchCatalog,
  voicemailDispatchSnapshot,
} from "./learn-voicemail-dispatch-catalog.mjs";
if (
  process.argv.slice(2).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST dispatch boundary check required");
const manifest = JSON.parse(
  readFileSync("supabase/release/learn-test/076_voicemail_dispatch_runtime.manifest.json"),
);
const stem = ".verification-results/voicemail-dispatch-runtime-http",
  token = savedCliToken();
const schema = await readVoicemailDispatchCatalog(token),
  inventory = await edgeInventory(token),
  endpoint = inventory.find((e) => e.slug === "platform-worker");
if (
  manifest.projectRef !== TEST_PROJECT ||
  schema.fingerprint !== manifest.fullSchema ||
  endpoint?.version !== 19 ||
  endpoint.status !== "ACTIVE" ||
  endpoint.verify_jwt !== false
)
  throw Error("Exact TEST 076 worker v19 required");
const snapshot = voicemailDispatchSnapshot(schema.catalog.phone),
  before = await communicationQuery(token, snapshot);
if (before.length !== 140) throw Error("Full preservation baseline required");
// The generic worker reclaims expired jobs before it filters claims. Refuse this
// empty boundary check if it could alter any unrelated job or capture work.
const eligible = await communicationQuery(
  token,
  "select count(*)::int as count from platform_jobs where (job_type='phone.voicemail_import' and status in('queued','retrying','running')) or (status='running' and lease_expires_at<clock_timestamp()+interval '2 minutes')",
);
const enabledRoutes = await communicationQuery(
  token,
  "select count(*)::int as count from receptionist_voicemail_email_routes where enabled",
);
if (enabledRoutes.length !== 1 || enabledRoutes[0].count !== 0)
  throw Error("No enabled routes required for no-capture probe");
const importer = inventory.find((e) => e.slug === "learn-voicemail-import");
if (importer?.version !== 2 || importer.status !== "ACTIVE" || importer.verify_jwt !== false)
  throw Error("Exact import endpoint v2 required");
if (eligible.length !== 1 || eligible[0].count !== 0)
  throw Error("No voicemail or near-expired running jobs required");
const fd = openSync(stem + "-journal.json", "wx", 0o600);
try {
  writeSync(
    fd,
    JSON.stringify(
      {
        projectRef: TEST_PROJECT,
        startedAt: new Date().toISOString(),
        schemaFingerprint: schema.fingerprint,
        before,
        plannedCalls: 10,
      },
      null,
      2,
    ),
  );
  fsyncSync(fd);
} finally {
  closeSync(fd);
}
const response = await fetch(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok) throw Error("TEST credential retrieval unavailable");
const keys = await response.json();
function key(name) {
  const matched = keys.filter((k) => k.name === name);
  if (matched.length !== 1 || typeof matched[0].api_key !== "string")
    throw Error("Unique TEST credential required");
  const value = matched[0].api_key,
    claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url"));
  if (claims.ref !== TEST_PROJECT || claims.role !== name) throw Error("Credential target differs");
  return value;
}
const service = key("service_role"),
  anon = key("anon");

const checks = [];
let failure = null;
const serviceHeaders = {
  Authorization: `Bearer ${service}`,
  apikey: service,
  "x-serviceos-internal-key": service,
};
const anonHeaders = { Authorization: `Bearer ${anon}`, apikey: anon };
try {
  const probes = [
    {
      name: "anonymous_dispatch_denied",
      path: "rest/v1/rpc/voicemail_schedule_tick",
      headers: anonHeaders,
      body: {},
      statuses: [401, 403],
      code: "42501",
    },
    {
      name: "service_idle_dispatch",
      path: "rest/v1/rpc/voicemail_schedule_tick",
      headers: serviceHeaders,
      body: {},
      status: 200,
      idle: true,
    },
    {
      name: "import_missing_auth",
      path: "functions/v1/learn-voicemail-import",
      headers: {},
      body: {},
      status: 403,
      code: "voicemail_internal_auth_required",
    },
    {
      name: "import_invalid_scope",
      path: "functions/v1/learn-voicemail-import",
      headers: serviceHeaders,
      body: {},
      status: 400,
      code: "voicemail_request_invalid",
    },
    {
      name: "missing_worker_auth",
      path: "functions/v1/platform-worker",
      headers: {},
      body: { job_types: ["phone.voicemail_import"], batch_size: 1 },
      status: 403,
      code: "forbidden",
    },
    {
      name: "anon_worker_auth",
      path: "functions/v1/platform-worker",
      headers: anonHeaders,
      body: { job_types: ["phone.voicemail_import"], batch_size: 1 },
      status: 403,
      code: "forbidden",
    },
    {
      name: "empty_voicemail_worker",
      path: "functions/v1/platform-worker",
      headers: serviceHeaders,
      body: { job_types: ["phone.voicemail_import"], batch_size: 1 },
      status: 200,
      empty: true,
    },
    {
      name: "service_empty_recovery",
      path: "rest/v1/rpc/voicemail_queue_recover",
      headers: serviceHeaders,
      body: {},
      status: 200,
      zero: true,
    },
    {
      name: "service_missing_claim",
      path: "rest/v1/rpc/voicemail_queue_step",
      headers: serviceHeaders,
      body: {
        p_tenant: "ce740000-aaaa-4000-8000-000000000001",
        p_job: "ce740000-aaaa-4000-8000-000000000002",
        p_worker: "synthetic-missing-claim",
        p_attempt: 1,
        p_operation: "bind",
        p_args: {},
      },
      status: 409,
      code: "PT409",
    },
    {
      name: "anon_queue_denied",
      path: "rest/v1/rpc/voicemail_queue_recover",
      headers: anonHeaders,
      body: {},
      statuses: [401, 403],
      code: "42501",
    },
  ];
  for (const p of probes) {
    const r = await fetch(`https://${TEST_PROJECT}.supabase.co/${p.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...p.headers },
      body: JSON.stringify(p.body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {}
    const code = data?.error?.code ?? data?.code ?? null;
    const passed =
      (p.statuses ? p.statuses.includes(r.status) : r.status === p.status) &&
      (!p.code || code === p.code) &&
      (!p.zero || data === 0) &&
      (!p.idle ||
        (data?.state === "idle" &&
          data?.routes_attempted === 0 &&
          data?.coverage_complete === false)) &&
      (!p.empty ||
        (data?.success === true &&
          data?.voicemail_discovery?.state === "idle" &&
          data?.voicemail_discovery?.coverageComplete === false &&
          [
            "claimed",
            "succeeded",
            "waiting",
            "unconfirmed",
            "retrying",
            "dead_lettered",
            "failed",
          ].every((k) => data[k] === 0)));
    checks.push({
      name: p.name,
      status: r.status,
      code,
      passed,
      ...(p.empty ? { claimed: data?.claimed ?? null } : {}),
      ...(p.zero ? { reclaimed: data } : {}),
    });
    if (!passed) {
      writeFileSync(stem + "-unexpected-private.txt", text.slice(0, 20000), {
        flag: "wx",
        mode: 0o600,
      });
      throw Error("Unexpected " + p.name + " response");
    }
  }
} catch (e) {
  failure = e.message;
}
const after = await communicationQuery(token, snapshot),
  afterSchema = await readVoicemailDispatchCatalog(token);
const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const preserved =
  stable(before) === stable(after) && afterSchema.fingerprint === schema.fingerprint;
const report = {
  state:
    !failure && checks.length === 10 && preserved
      ? "hosted_dispatch_boundaries_verified"
      : "requires_inspection",
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  endpointVersions: { "platform-worker": 19, "learn-voicemail-import": 2 },
  exactInternalHeader: true,
  checks,
  failure,
  preservedDatasets: preserved ? 140 : null,
  providerRequests: 0,
  usersCreated: 0,
  jobsCreated: 0,
  routesCreated: 0,
  productionChanged: false,
  limitations: [
    "Idle discovery/worker and importer auth checks only. No positive hosted scheduled import, live providers, schedule activation, complete coverage or signed-in acceptance.",
  ],
};
writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
if (report.state !== "hosted_dispatch_boundaries_verified") process.exitCode = 1;
