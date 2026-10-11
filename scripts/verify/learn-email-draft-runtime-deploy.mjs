/** Install draft-safe email capture in TEST; no activation or credentials. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const DRAFT_ENDPOINTS = [{ name: "platform-worker", verifyJwt: false }];
export const DRAFT_SHA = "2f5394bee7c44cff277bd4069bef0088fe8970ad981cb062399847b30957eb55";
export const DRAFT_RUNTIME_SCHEMA = "719d72c810edd37a47a55c672038824f";
export const DRAFT_FULL_SCHEMA = "db53a9b09d1cf3b70dea70278c1b7338";
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
  if (before.fingerprint !== DRAFT_FULL_SCHEMA) throw Error("TEST release 069 required");
  const guard = await query(
    args.token,
    "select md5(pg_get_functiondef('public.learn_email_is_draft(public.email_messages)'::regprocedure)||pg_get_functiondef('public.learn_interaction_is_draft(uuid,text,uuid)'::regprocedure)) as digest",
  );
  if (guard[0]?.digest !== "b8c89f1b2c8c5bb6f396366e7b2ba537")
    throw Error("Verified draft guards required");
  const snapshot = queueInstalledSnapshot(before.catalog.phone),
    rows = await query(args.token, snapshot);
  if (rows.length !== 121 || new Set(rows.map((r) => r.name)).size !== 121)
    throw Error("Full preservation baseline required");
  const result = await deploy(
    {
      ...args,
      replaceVersions: { "platform-worker": 14 },
      persistJournal: (journal) =>
        args.persistJournal({ ...journal, fullSchema: before.fingerprint, fullPreserved: rows }),
    },
    {
      bundle: draftEligibilityBundle,
      endpoints: DRAFT_ENDPOINTS,
      bundleSha: DRAFT_SHA,
      databaseFingerprint: DRAFT_RUNTIME_SCHEMA,
      version: "learn-email-draft-runtime/1",
      stagePrefix: "learn-email-draft-runtime-",
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
    const prefix = ".verification-results/email-draft-runtime-deploy";
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
