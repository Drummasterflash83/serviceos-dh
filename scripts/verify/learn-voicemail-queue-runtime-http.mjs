/** Hosted TEST worker boot/auth and empty queue RPC boundaries; no source reads. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readVoicemailQueueCatalog,
  voicemailQueueSnapshot,
} from "./learn-voicemail-queue-catalog.mjs";
const followup = process.argv.includes("--internal-header-followup");
if (
  process.argv.slice(2).join(" ") !==
    "--existing-cli-login" + (followup ? " --internal-header-followup" : "") ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST worker boundary check required");
const manifest = JSON.parse(
  readFileSync("supabase/release/learn-test/074_voicemail_queue_runtime.manifest.json"),
);
if (followup) {
  const previous = JSON.parse(
    readFileSync(".verification-results/voicemail-queue-runtime-http-result.json"),
  );
  if (
    previous.state !== "requires_inspection" ||
    previous.preservedDatasets !== 136 ||
    previous.checks.at(-1)?.name !== "empty_voicemail_worker" ||
    previous.checks.at(-1)?.status !== 403
  )
    throw Error("Confirmed prior auth denial with preservation required");
}
const stem =
    ".verification-results/voicemail-queue-runtime-http" + (followup ? "-internal-header" : ""),
  token = savedCliToken();
const schema = await readVoicemailQueueCatalog(token),
  inventory = await edgeInventory(token),
  endpoint = inventory.find((e) => e.slug === "platform-worker");
if (
  manifest.projectRef !== TEST_PROJECT ||
  schema.fingerprint !== manifest.fullSchema ||
  endpoint?.version !== 18 ||
  endpoint.status !== "ACTIVE" ||
  endpoint.verify_jwt !== false
)
  throw Error("Exact TEST 074 worker v18 required");
const snapshot = voicemailQueueSnapshot(schema.catalog.phone),
  before = await communicationQuery(token, snapshot);
if (
  before.length !== 136 ||
  before.some((r) => r.name.startsWith("public.receptionist_") && r.count !== 0)
)
  throw Error("Empty voicemail configuration and full baseline required");
// The generic worker reclaims expired jobs before it filters claims. Refuse this
// empty boundary check if it could alter any unrelated job or capture work.
const eligible = await communicationQuery(
  token,
  "select count(*)::int as count from platform_jobs where job_type='phone.voicemail_import' or (status='running' and lease_expires_at<clock_timestamp()+interval '2 minutes')",
);
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
        plannedCalls: 6,
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
  ...(followup ? { "x-serviceos-internal-key": service } : {}),
};
const anonHeaders = { Authorization: `Bearer ${anon}`, apikey: anon };
try {
  const probes = [
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
      (!p.empty ||
        (data?.success === true &&
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
  afterSchema = await readVoicemailQueueCatalog(token);
const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const preserved =
  stable(before) === stable(after) && afterSchema.fingerprint === schema.fingerprint;
const report = {
  state:
    !failure && checks.length === 6 && preserved
      ? "hosted_queue_boundaries_verified"
      : "requires_inspection",
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  endpointVersion: 18,
  exactInternalHeader: followup,
  checks,
  failure,
  preservedDatasets: preserved ? 136 : null,
  providerRequests: 0,
  usersCreated: 0,
  jobsCreated: 0,
  routesCreated: 0,
  productionChanged: false,
  limitations: [
    "Empty worker/auth/RPC checks only. No positive hosted queue import, live provider/credentials, scheduling, coverage or signed-in acceptance.",
  ],
};
writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
if (report.state !== "hosted_queue_boundaries_verified") process.exitCode = 1;
