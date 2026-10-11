/** Install draft-safe card refresh in TEST; no activation or credentials. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const DRAFT_ENDPOINTS = [
  { name: "platform-worker", verifyJwt: false },
  { name: "customer-card-sync", verifyJwt: true },
];
export const DRAFT_SHA = "f687f26cf474ee5d171a4afc4aed5063ba20abe65c96b6f44b02f80fc7c5d1dc";
export const DRAFT_RUNTIME_SCHEMA = "b6cd41cce08668b208530a50b417a1dc";
export const DRAFT_FULL_SCHEMA = "a1131b60b5fc1c022c772147078365a3";
export const draftEligibilityBundle = () => edgeRuntimeBundle(DRAFT_ENDPOINTS);
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
export async function deployDraftEligibility(
  args,
  { catalog = readQueueCatalog, query = communicationQuery, deploy = deployPinnedTestRuntime } = {},
) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact TEST worker replacement only");
  if (draftEligibilityBundle().sha256 !== DRAFT_SHA)
    throw Error("Draft eligibility source differs");
  const before = await catalog(args.token);
  if (before.fingerprint !== DRAFT_FULL_SCHEMA) throw Error("TEST release 070 required");
  const guard = await query(
    args.token,
    "select md5(pg_get_functiondef('public.learn_card_projection_inputs(uuid,uuid)'::regprocedure)) as digest",
  );
  if (guard[0]?.digest !== "760b1f428c12940564d7d8fb571c27e4")
    throw Error("Verified draft guards required");
  const snapshot = queueInstalledSnapshot(before.catalog.phone),
    rows = await query(args.token, snapshot);
  if (rows.length !== 121 || new Set(rows.map((r) => r.name)).size !== 121)
    throw Error("Full preservation baseline required");
  const result = await deploy(
    {
      ...args,
      replaceVersions: { "platform-worker": 15, "customer-card-sync": 1 },
      persistJournal: (journal) =>
        args.persistJournal({ ...journal, fullSchema: before.fingerprint, fullPreserved: rows }),
    },
    {
      bundle: draftEligibilityBundle,
      endpoints: DRAFT_ENDPOINTS,
      bundleSha: DRAFT_SHA,
      databaseFingerprint: DRAFT_RUNTIME_SCHEMA,
      version: "learn-card-draft-runtime/1",
      stagePrefix: "learn-card-draft-runtime-",
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
    const prefix = ".verification-results/card-draft-runtime-deploy";
    const result = await deployDraftEligibility({
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
      "Draft eligibility deployment unconfirmed; inspect journal and inventory before retry: " +
        e.message,
    );
    process.exitCode = 1;
  }
}
