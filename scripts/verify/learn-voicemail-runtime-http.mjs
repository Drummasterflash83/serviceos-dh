/** TEST auth/empty-route acceptance only. No provider access or data writes. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readVoicemailCatalog, voicemailInstalledSnapshot } from "./learn-voicemail-catalog.mjs";
if (
  process.argv.slice(2).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST boundary check required");
const manifest = JSON.parse(
  readFileSync("supabase/release/learn-test/073_voicemail_runtime.manifest.json"),
);
const stem = ".verification-results/voicemail-runtime-http",
  token = savedCliToken();
const schema = await readVoicemailCatalog(token),
  inventory = await edgeInventory(token);
const endpoint = inventory.find((e) => e.slug === "learn-voicemail-import");
if (
  manifest.projectRef !== TEST_PROJECT ||
  schema.fingerprint !== manifest.fullSchema ||
  endpoint?.version !== 1 ||
  endpoint.status !== "ACTIVE" ||
  endpoint.verify_jwt !== false
)
  throw Error("Exact deployed TEST voicemail required");
const snapshot = voicemailInstalledSnapshot(schema.catalog.phone),
  before = await communicationQuery(token, snapshot);
if (
  before.length !== 134 ||
  before.some((r) => r.name.startsWith("public.receptionist_") && r.count !== 0)
)
  throw Error("Empty voicemail configuration and full baseline required");
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
        plannedCalls: 4,
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
const internal = {
  Authorization: `Bearer ${service}`,
  apikey: service,
  "x-serviceos-internal-key": service,
  "x-internal-tenant-id": "ce420000-aaaa-4000-8000-000000000099",
};
const checks = [];
let failure = null;
try {
  for (const p of [
    {
      name: "missing_auth",
      headers: {},
      body: {},
      status: 403,
      code: "voicemail_internal_auth_required",
    },
    {
      name: "anon_auth",
      headers: { Authorization: `Bearer ${anon}`, apikey: anon },
      body: {},
      status: 403,
      code: "voicemail_internal_auth_required",
    },
    {
      name: "invalid_internal_request",
      headers: internal,
      body: {},
      status: 400,
      code: "voicemail_request_invalid",
    },
    {
      name: "missing_route_before_credentials",
      headers: internal,
      body: {
        routeId: "ce420000-aaaa-4000-8000-000000000098",
        accountId: "ce420000-aaaa-4000-8000-000000000097",
        messageId: "abcdef1234",
        internalDate: "1791705600000",
      },
      status: 503,
      code: "voicemail_route_unconfirmed",
    },
  ]) {
    const r = await fetch(
      `https://${TEST_PROJECT}.supabase.co/functions/v1/learn-voicemail-import`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...p.headers },
        body: JSON.stringify(p.body),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    const body = await r.text();
    let value;
    try {
      value = JSON.parse(body);
    } catch {}
    const found = {
      name: p.name,
      status: r.status,
      code: typeof value?.code === "string" ? value.code : null,
    };
    checks.push(found);
    if (r.status !== p.status || found.code !== p.code || value.success !== false) {
      writeFileSync(stem + "-unexpected-private.txt", body.slice(0, 20000), {
        flag: "wx",
        mode: 0o600,
      });
      throw Error("Unexpected " + p.name + " boundary response");
    }
  }
} catch (e) {
  failure = e.message;
}
const after = await communicationQuery(token, snapshot),
  afterSchema = await readVoicemailCatalog(token);
const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const preserved =
  stable(before) === stable(after) && afterSchema.fingerprint === schema.fingerprint;
const report = {
  state:
    !failure && checks.length === 4 && preserved
      ? "hosted_internal_boundaries_verified"
      : "requires_inspection",
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  endpointVersion: 1,
  checks,
  failure,
  preservedDatasets: preserved ? 134 : null,
  providerRequests: 0,
  usersCreated: 0,
  routesCreated: 0,
  credentialsStored: 0,
  productionChanged: false,
  limitations: [
    "No successful hosted voicemail import, Storage byte transport, live DNS/provider token mint or signed-in acceptance.",
  ],
};
writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
if (report.state !== "hosted_internal_boundaries_verified") process.exitCode = 1;
