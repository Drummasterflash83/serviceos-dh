/** Install mailbox-wide email capture in TEST; no activation or credentials. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const COVERAGE_ENDPOINTS = [{ name: "platform-worker", verifyJwt: false }];
export const COVERAGE_SHA = "6eb6c7c205ff224c1087dc3aee6ed7c834d0a661fef39ef8bf10a2d35bf5049d";
export const COVERAGE_RUNTIME_SCHEMA = "49b4fa34452b9c3dd4492f3995784084";
export const COVERAGE_FULL_SCHEMA = "a857c9a1556d4c5db53f063f30c19d33";
export const mailboxCoverageBundle = () => edgeRuntimeBundle(COVERAGE_ENDPOINTS);
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
export async function deployMailboxCoverage(
  args,
  { catalog = readQueueCatalog, query = communicationQuery, deploy = deployPinnedTestRuntime } = {},
) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact TEST worker replacement only");
  if (mailboxCoverageBundle().sha256 !== COVERAGE_SHA)
    throw Error("Mailbox coverage source differs");
  const before = await catalog(args.token);
  if (before.fingerprint !== COVERAGE_FULL_SCHEMA) throw Error("TEST release 068 required");
  const guard = await query(
    args.token,
    "select md5(pg_get_functiondef('public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure)) as digest",
  );
  if (guard[0]?.digest !== "86e7d695a88d91a22472882e15d2de0d")
    throw Error("Verified mailbox transition required");
  const snapshot = queueInstalledSnapshot(before.catalog.phone),
    rows = await query(args.token, snapshot);
  if (rows.length !== 121 || new Set(rows.map((r) => r.name)).size !== 121)
    throw Error("Full preservation baseline required");
  const result = await deploy(
    {
      ...args,
      replaceVersions: { "platform-worker": 13 },
      persistJournal: (journal) =>
        args.persistJournal({ ...journal, fullSchema: before.fingerprint, fullPreserved: rows }),
    },
    {
      bundle: mailboxCoverageBundle,
      endpoints: COVERAGE_ENDPOINTS,
      bundleSha: COVERAGE_SHA,
      databaseFingerprint: COVERAGE_RUNTIME_SCHEMA,
      version: "learn-email-mailbox-coverage-runtime/1",
      stagePrefix: "learn-email-mailbox-coverage-runtime-",
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
    const prefix = ".verification-results/email-mailbox-coverage-runtime-deploy";
    const result = await deployMailboxCoverage({
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
      "Mailbox coverage deployment unconfirmed; inspect journal and inventory before retry: " +
        e.message,
    );
    process.exitCode = 1;
  }
}
