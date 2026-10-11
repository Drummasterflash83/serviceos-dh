/** Install Gmail change tracking before schema activation in TEST; no activation or credentials. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { readQueueCatalog } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const CHANGES_ENDPOINTS = [{ name: "platform-worker", verifyJwt: false }];
export const CHANGES_SHA = "873a1166462c44749f8883b4cd968c093813903f561d2e1b9c8f600c7904edd5";
export const CHANGES_RUNTIME_SCHEMA = "b6cd41cce08668b208530a50b417a1dc";
export const CHANGES_FULL_SCHEMA = "a1131b60b5fc1c022c772147078365a3";
export const mailboxChangesBundle = () => edgeRuntimeBundle(CHANGES_ENDPOINTS);
import { mailboxChangesSnapshot } from "./learn-email-mailbox-changes-catalog.mjs";
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
export async function deployMailboxChanges(
  args,
  { catalog = readQueueCatalog, query = communicationQuery, deploy = deployPinnedTestRuntime } = {},
) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact TEST worker replacement only");
  if (mailboxChangesBundle().sha256 !== CHANGES_SHA) throw Error("Mailbox changes source differs");
  const before = await catalog(args.token);
  if (before.fingerprint !== CHANGES_FULL_SCHEMA) throw Error("TEST release 070 required");
  const guard = await query(
    args.token,
    "select md5(pg_get_functiondef('public.learn_card_projection_inputs(uuid,uuid)'::regprocedure)) as digest",
  );
  if (guard[0]?.digest !== "760b1f428c12940564d7d8fb571c27e4")
    throw Error("Verified draft guards required");
  const snapshot = mailboxChangesSnapshot(before.catalog.phone),
    rows = await query(args.token, snapshot);
  if (rows.length !== 123 || new Set(rows.map((r) => r.name)).size !== 123)
    throw Error("Full preservation baseline required");
  const result = await deploy(
    {
      ...args,
      replaceVersions: { "platform-worker": 16 },
      persistJournal: (journal) =>
        args.persistJournal({ ...journal, fullSchema: before.fingerprint, fullPreserved: rows }),
    },
    {
      bundle: mailboxChangesBundle,
      endpoints: CHANGES_ENDPOINTS,
      bundleSha: CHANGES_SHA,
      databaseFingerprint: CHANGES_RUNTIME_SCHEMA,
      version: "learn-email-mailbox-changes-runtime/1",
      stagePrefix: "learn-email-mailbox-changes-runtime-",
    },
  );
  const [after, afterRows] = await Promise.all([catalog(args.token), query(args.token, snapshot)]);
  const preserved = after.fingerprint === before.fingerprint && stable(rows) === stable(afterRows);
  return {
    ...result,
    state: preserved ? result.state : "requires_inspection",
    fullPreservedDatasets: preserved ? 123 : null,
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
    const prefix = ".verification-results/email-mailbox-changes-runtime-deploy";
    const result = await deployMailboxChanges({
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
      "Mailbox changes deployment unconfirmed; inspect journal and inventory before retry: " +
        e.message,
    );
    process.exitCode = 1;
  }
}
