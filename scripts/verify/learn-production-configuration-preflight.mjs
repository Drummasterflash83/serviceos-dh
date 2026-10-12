/** Read-only preparation. Reuse the existing production service credential's
 * digest for explicit internal trigger bindings, as in TEST. Never save its value.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
import {
  configurationRuntimeMetadata,
  configurationSecretMetadata,
  productionConfigurationTransport,
  loadConfigurationAdapter,
} from "./learn-production-configuration-adapter.mjs";
const project = "tgbnakbxwcqjeimygroz",
  output = process.argv[2];
if (
  process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT !== project ||
  !/^\.verification-results\/[a-z0-9-]+\.json$/.test(output ?? "")
)
  throw Error("Explicit read-only production target and private output required");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const bytes = readFileSync("supabase/release/learn-production/runtime-candidate.manifest.json");
const operations = JSON.parse(
  readFileSync("supabase/release/learn-production/release-operations.manifest.json"),
);
const op = operations.operations.find((o) => o.id === "matching-server-configuration");
const token = savedCliToken(),
  api = productionConfigurationTransport(token);
const secrets = configurationSecretMetadata(
  await api({ method: "GET", path: `/v1/projects/${project}/secrets` }),
);
const functions = (await api({ method: "GET", path: `/v1/projects/${project}/functions` })).map(
  configurationRuntimeMetadata,
);
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/api-keys?reveal=true`,
  {
    headers: { Authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok) throw Error("Existing internal credential unavailable");
const matches = (await response.json()).filter((r) => r.name === "service_role");
if (matches.length !== 1 || typeof matches[0].api_key !== "string")
  throw Error("Unique existing service credential required");
let key = matches[0].api_key;
const parts = key.split(".");
if (parts.length !== 3) throw Error("Existing service credential format differs");
const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
if (
  claims.ref !== project ||
  claims.role !== "service_role" ||
  !Number.isSafeInteger(claims.exp) ||
  claims.exp * 1000 <= Date.now()
)
  throw Error("Existing credential binding differs");
const keyDigest = sha(key);
key = "";
matches[0].api_key = "";
const desiredSecretDigests = {
  LEARN_COMMUSOFT_WORKER_KEY: keyDigest,
  LEARN_SLACK_WORKER_KEY: keyDigest,
};
const baseline = {
  projectRef: project,
  candidateSha256: sha(bytes),
  stepId: op.id,
  stepPinSha256: op.pinSha256,
  secrets,
  functions,
};
const adapter = loadConfigurationAdapter(api, { baseline, desiredSecretDigests });
const inspection = await adapter.inspect();
const report = {
  version: "learn-production-configuration-preflight/1",
  observedAt: new Date().toISOString(),
  baseline,
  desiredSecretDigests,
  inspection,
  existingServiceCredentialReused: true,
  secretValuesIncluded: false,
  productionChanges: 0,
  providerCalls: 0,
  limitations: [
    "Read-only preparation; no secrets provisioned or dispatch enabled.",
    "Release approval is recorded separately; current drain, recovery, database receipts and positive caller checks remain required.",
    "Secret readback does not prove that a deployed worker received the new environment.",
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(
  JSON.stringify({
    state: inspection.state,
    projectRef: project,
    changedNames: inspection.changedNames,
    runtimeCount: inspection.runtimeCount,
    existingServiceCredentialReused: true,
    secretValuesIncluded: false,
    productionChanges: 0,
    providerCalls: 0,
  }),
);
