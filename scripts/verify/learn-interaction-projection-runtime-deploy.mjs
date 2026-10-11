/** Install the atomic projection/card worker in TEST; no provider or capture activation. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import {
  readProjectionCatalog,
  projectionInstalledSnapshot,
} from "./learn-interaction-projection-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const PROJECTION_ENDPOINTS = [{ name: "platform-worker", verifyJwt: false }];
export const PROJECTION_SHA = "d753dd2b43b478c5b898f065d7f68391afbc5804ab054ed30a43077e231d6405";
export const PROJECTION_RUNTIME_SCHEMA = "7a9d0dd337966f88d721ed6007ba9e47";
export const PROJECTION_FULL_SCHEMA = "537f21e8392a8c3034434120d7fc35a7";
export const projectionBundle = () => edgeRuntimeBundle(PROJECTION_ENDPOINTS);
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
export async function deployProjectionDelivery(
  args,
  {
    catalog = readProjectionCatalog,
    query = communicationQuery,
    deploy = deployPinnedTestRuntime,
  } = {},
) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact TEST worker replacement only");
  if (projectionBundle().sha256 !== PROJECTION_SHA)
    throw Error("Projection delivery source differs");
  const before = await catalog(args.token);
  if (before.fingerprint !== PROJECTION_FULL_SCHEMA) throw Error("TEST release 063 required");
  const snapshot = projectionInstalledSnapshot(before.catalog.phone),
    rows = await query(args.token, snapshot);
  if (rows.length !== 117 || new Set(rows.map((r) => r.name)).size !== 117)
    throw Error("Full preservation baseline required");
  const result = await deploy(
    {
      ...args,
      replaceVersions: { "platform-worker": 9 },
      persistJournal: (journal) =>
        args.persistJournal({ ...journal, fullSchema: before.fingerprint, fullPreserved: rows }),
    },
    {
      bundle: projectionBundle,
      endpoints: PROJECTION_ENDPOINTS,
      bundleSha: PROJECTION_SHA,
      databaseFingerprint: PROJECTION_RUNTIME_SCHEMA,
      version: "learn-interaction-projection-runtime/1",
      stagePrefix: "learn-interaction-projection-runtime-",
    },
  );
  const [after, afterRows] = await Promise.all([catalog(args.token), query(args.token, snapshot)]);
  const preserved = after.fingerprint === before.fingerprint && stable(rows) === stable(afterRows);
  return {
    ...result,
    state: preserved ? result.state : "requires_inspection",
    fullPreservedDatasets: preserved ? 117 : null,
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
    const prefix = ".verification-results/interaction-projection-runtime-deploy";
    const result = await deployProjectionDelivery({
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
      "Projection delivery deployment unconfirmed; inspect journal and inventory before retry: " +
        e.message,
    );
    process.exitCode = 1;
  }
}
