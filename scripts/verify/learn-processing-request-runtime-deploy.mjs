/** Install the atomic projection/card worker in TEST; no provider or capture activation. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const REQUEST_ENDPOINTS = [
  { name: "platform-worker", verifyJwt: false },
  { name: "interactions-sync", verifyJwt: true },
  { name: "identity-resolve", verifyJwt: true },
];
export const REQUEST_SHA = "3fc4bbbc2b146921b984dafdce70dc609218c728c81d4ffc14bf15d60ba7e402";
export const PROCESSING_RUNTIME_SCHEMA = "f61c44af9524734e27b1a748cd790116";
export const PROCESSING_FULL_SCHEMA = "e7897de65753b003869960b6b054215d";
export const processingRequestBundle = () => edgeRuntimeBundle(REQUEST_ENDPOINTS);
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
export async function deployProcessingRequest(
  args,
  { catalog = readQueueCatalog, query = communicationQuery, deploy = deployPinnedTestRuntime } = {},
) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact TEST worker replacement only");
  if (processingRequestBundle().sha256 !== REQUEST_SHA)
    throw Error("Processing queue source differs");
  const before = await catalog(args.token);
  if (before.fingerprint !== PROCESSING_FULL_SCHEMA) throw Error("TEST release 066 required");
  const snapshot = queueInstalledSnapshot(before.catalog.phone),
    rows = await query(args.token, snapshot);
  if (rows.length !== 121 || new Set(rows.map((r) => r.name)).size !== 121)
    throw Error("Full preservation baseline required");
  const result = await deploy(
    {
      ...args,
      replaceVersions: { "platform-worker": 11 },
      persistJournal: (journal) =>
        args.persistJournal({ ...journal, fullSchema: before.fingerprint, fullPreserved: rows }),
    },
    {
      bundle: processingRequestBundle,
      endpoints: REQUEST_ENDPOINTS,
      bundleSha: REQUEST_SHA,
      databaseFingerprint: PROCESSING_RUNTIME_SCHEMA,
      version: "learn-processing-request-runtime/1",
      stagePrefix: "learn-processing-request-runtime-",
    },
  );
  const [after, afterRows] = await Promise.all([catalog(args.token), query(args.token, snapshot)]);
  const preserved = after.fingerprint === before.fingerprint && stable(rows) === stable(afterRows);
  return {
    ...result,
    state: preserved ? result.state : "requires_inspection",
    fullPreservedDatasets: preserved ? 121 : null,
    fullSchemaUnchanged: after.fingerprint === before.fingerprint,
    secretsCreated: 0,
    schedulesActivated: 0,
    providerRequests: 0,
    productionChanged: false,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST deployment required");
    const prefix = ".verification-results/processing-request-runtime-deploy";
    const result = await deployProcessingRequest({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
      persistJournal: async (journal) => {
        const fd = openSync(prefix + "-journal.json", "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify(journal, null, 2));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      onProgress: (r) => console.log(JSON.stringify(r)),
    });
    writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
  } catch (e) {
    console.error(
      "Processing queue deployment unconfirmed; inspect journal and inventory before retry: " +
        e.message,
    );
    process.exitCode = 1;
  }
}
