/** Replace only TEST phone sync v4 endpoints with atomic page publication. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { readPhonePublicationCatalog } from "./learn-phone-publication-catalog.mjs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

export const PHONE_PUBLICATION_DATABASE = "f7fffea21974b6725fc6e4a26df28a2a";
export const PHONE_PUBLICATION_ENDPOINTS = [
  { name: "simwood-sync-calls", verifyJwt: true },
  { name: "simwood-sync-recordings", verifyJwt: true },
];
export const PHONE_PUBLICATION_SHA =
  "7bc5b81b3770806e975b9dc742f1b05e295a38fddbc9ab319b7916165171f285";
export const phonePublicationBundle = () => edgeRuntimeBundle(PHONE_PUBLICATION_ENDPOINTS);
export const PHONE_PUBLICATION_SCHEMA = "0fb6d70902c76e37549ef65c157b8be9";
export async function deployPhonePublication(args) {
  if (Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Replacement versions are pinned to TEST phone sync v4");
  if (args.allowProjectRef !== TEST_PROJECT) throw Error("Explicit TEST project required");
  const schema = await readPhonePublicationCatalog(args.token, { fetcher: args.fetcher });
  if (schema.fingerprint !== PHONE_PUBLICATION_SCHEMA)
    throw Error("Exact phone publication schema required");
  const result = await deployPinnedTestRuntime(
    { ...args, replaceVersions: { "simwood-sync-calls": 4, "simwood-sync-recordings": 4 } },
    {
      bundle: phonePublicationBundle,
      endpoints: PHONE_PUBLICATION_ENDPOINTS,
      bundleSha: PHONE_PUBLICATION_SHA,
      databaseFingerprint: PHONE_PUBLICATION_DATABASE,
      version: "learn-phone-publication-deploy/1",
      stagePrefix: "learn-phone-publication-",
    },
  );
  const after = await readPhonePublicationCatalog(args.token, { fetcher: args.fetcher });
  return after.fingerprint === schema.fingerprint
    ? result
    : { ...result, state: "requires_inspection" };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST replacement required");
    const prefix = ".verification-results/phone-publication-edge-deploy";
    const result = await deployPhonePublication({
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
      onProgress: (p) => console.log(JSON.stringify(p)),
    });
    writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
  } catch {
    console.error(
      "Phone sync replacement unconfirmed; inspect retained journal and TEST inventory before any further attempt.",
    );
    process.exitCode = 1;
  }
}
