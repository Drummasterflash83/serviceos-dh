/** Install matching alias discovery and capture in TEST; no activation or credentials. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const IDENTITY_ENDPOINTS = [
  { name: "platform-worker", verifyJwt: false },
  { name: "google-workspace-discover-mailboxes", verifyJwt: true },
];
export const IDENTITY_SHA = "00fa5d169357b6f63ad828a08b14e83510cee17ee9df10e279f4f9e101414ded";
export const IDENTITY_RUNTIME_SCHEMA = "f4ab90dd48dffac1a1d2330d136fd30a";
export const IDENTITY_FULL_SCHEMA = "2eec67c4d0bb0841283d17f7961a88f0";
export const workspaceIdentityBundle = () => edgeRuntimeBundle(IDENTITY_ENDPOINTS);
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
export async function deployWorkspaceIdentity(
  args,
  { catalog = readQueueCatalog, query = communicationQuery, deploy = deployPinnedTestRuntime } = {},
) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact TEST worker replacement only");
  if (workspaceIdentityBundle().sha256 !== IDENTITY_SHA)
    throw Error("Workspace identity source differs");
  const before = await catalog(args.token);
  if (before.fingerprint !== IDENTITY_FULL_SCHEMA) throw Error("TEST release 067 required");
  const guard = await query(
    args.token,
    "select md5(pg_get_functiondef('public.learn_workspace_identity_guard()'::regprocedure)) as digest",
  );
  if (guard[0]?.digest !== "25435b531474c2fd1e6fff02a686a889")
    throw Error("Verified identity guard required");
  const snapshot = queueInstalledSnapshot(before.catalog.phone),
    rows = await query(args.token, snapshot);
  if (rows.length !== 121 || new Set(rows.map((r) => r.name)).size !== 121)
    throw Error("Full preservation baseline required");
  const result = await deploy(
    {
      ...args,
      replaceVersions: { "platform-worker": 12, "google-workspace-discover-mailboxes": 2 },
      persistJournal: (journal) =>
        args.persistJournal({ ...journal, fullSchema: before.fingerprint, fullPreserved: rows }),
    },
    {
      bundle: workspaceIdentityBundle,
      endpoints: IDENTITY_ENDPOINTS,
      bundleSha: IDENTITY_SHA,
      databaseFingerprint: IDENTITY_RUNTIME_SCHEMA,
      version: "learn-workspace-identity-runtime/1",
      stagePrefix: "learn-workspace-identity-runtime-",
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
    const prefix = ".verification-results/workspace-identity-runtime-deploy";
    const result = await deployWorkspaceIdentity({
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
      "Workspace identity deployment unconfirmed; inspect journal and inventory before retry: " +
        e.message,
    );
    process.exitCode = 1;
  }
}
