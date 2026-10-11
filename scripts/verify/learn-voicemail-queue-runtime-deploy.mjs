/** Update only the pinned TEST worker with the voicemail queue path. No routes, secrets or schedules. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime, edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readVoicemailQueueCatalog,
  voicemailQueueSnapshot,
} from "./learn-voicemail-queue-catalog.mjs";
const endpoints = [{ name: "platform-worker", verifyJwt: false }];
const schemaReceipt = JSON.parse(
  readFileSync(".verification-results/voicemail-queue-release-apply-result.json"),
);
if (
  schemaReceipt.projectRef !== TEST_PROJECT ||
  schemaReceipt.state !== "installed_empty_queue_schema_verified" ||
  schemaReceipt.preservedDatasets !== 134
)
  throw Error("Verified queue schema installation required");
const fullSchema = schemaReceipt.afterFingerprint;
const path = "supabase/release/learn-test/074_voicemail_queue_runtime.manifest.json";
const mode = process.argv[2];
if (
  !["--prepare", "--deploy"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit fixed TEST runtime scope required");
const token = savedCliToken(),
  bundle = edgeRuntimeBundle(endpoints);
const before = await readVoicemailQueueCatalog(token);
if (before.fingerprint !== fullSchema) throw Error("Exact installed TEST 074 required");
const snapshot = voicemailQueueSnapshot(before.catalog.phone),
  rows = await communicationQuery(token, snapshot);
if (rows.length !== 136 || new Set(rows.map((r) => r.name)).size !== 136)
  throw Error("Full preservation snapshot required");
if (rows.some((r) => r.name.startsWith("public.receptionist_") && r.count !== 0))
  throw Error("Empty voicemail configuration required before first runtime deployment");
const prior = await edgeInventory(token);
const current = prior.find((r) => r.slug === "platform-worker");
if (current?.version !== 17 || current.status !== "ACTIVE" || current.verify_jwt !== false)
  throw Error("Exact platform worker v17 required; inspect before retry");
if (mode === "--prepare") {
  const runtime = await readRuntimeCatalog(token);
  const manifest = {
    projectRef: TEST_PROJECT,
    bundleSha256: bundle.sha256,
    fullSchema,
    runtimeSchema: runtime.fingerprint,
    endpoints,
    modules: bundle.files.length,
    external: bundle.external,
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ state: "prepared", ...manifest }, null, 2));
} else {
  const manifest = JSON.parse(readFileSync(path));
  if (
    manifest.projectRef !== TEST_PROJECT ||
    manifest.bundleSha256 !== bundle.sha256 ||
    manifest.fullSchema !== fullSchema ||
    JSON.stringify(manifest.endpoints) !== JSON.stringify(endpoints)
  )
    throw Error("Pinned runtime differs");
  const stem = ".verification-results/voicemail-queue-runtime-deploy";
  const result = await deployPinnedTestRuntime(
    {
      allowProjectRef: TEST_PROJECT,
      token,
      replaceVersions: { "platform-worker": 17 },
      persistJournal: async (j) => {
        const fd = openSync(stem + "-journal.json", "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify({ ...j, fullSchema, fullPreserved: rows }, null, 2));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      onProgress: (r) => console.log(JSON.stringify(r)),
    },
    {
      bundle: () => edgeRuntimeBundle(endpoints),
      endpoints,
      bundleSha: manifest.bundleSha256,
      databaseFingerprint: manifest.runtimeSchema,
      version: "learn-voicemail-queue-runtime/1",
      stagePrefix: "learn-voicemail-queue-runtime-",
    },
  );
  const after = await readVoicemailQueueCatalog(token),
    afterRows = await communicationQuery(token, snapshot);
  const stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
  const preserved = after.fingerprint === before.fingerprint && stable(rows) === stable(afterRows);
  const report = {
    ...result,
    state: preserved ? result.state : "requires_inspection",
    fullPreservedDatasets: preserved ? 136 : null,
    fullSchemaUnchanged: after.fingerprint === before.fingerprint,
    routesCreated: 0,
    credentialsUploaded: 0,
    schedulesActivated: 0,
    providerRequests: 0,
    productionChanged: false,
  };
  writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
}
