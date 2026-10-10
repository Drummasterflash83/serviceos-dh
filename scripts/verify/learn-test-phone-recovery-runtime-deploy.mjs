/** Replace TEST worker v4 and add the manual Phone recovery endpoint. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { readPhonePublicationCatalog } from "./learn-phone-publication-catalog.mjs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

export const PHONE_RECOVERY_RUNTIME_DATABASE = "20303a1bf930ea5d60896b16d7c8c42f";
export const PHONE_RECOVERY_RUNTIME_ENDPOINTS = [
  { name: "platform-worker", verifyJwt: false },
  { name: "phone-process-pending", verifyJwt: true },
];
export const PHONE_RECOVERY_RUNTIME_SHA =
  "ba30442581d897ece5658d2b9f2ddb844034641df6d3bf7eb2805aeb47d1f672";
export const phoneRecoveryRuntimeBundle = () => edgeRuntimeBundle(PHONE_RECOVERY_RUNTIME_ENDPOINTS);
export const PHONE_RECOVERY_RUNTIME_SCHEMA = "dddd1851fbb564cd1f1252d8b1874d79";
export async function deployPhoneRecoveryRuntime(args) {
  if (Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Replacement versions are pinned to TEST worker v4");
  if (args.allowProjectRef !== TEST_PROJECT) throw Error("Explicit TEST project required");
  const schema = await readPhonePublicationCatalog(args.token, { fetcher: args.fetcher });
  if (schema.fingerprint !== PHONE_RECOVERY_RUNTIME_SCHEMA)
    throw Error("Exact phone publication schema required");
  const result = await deployPinnedTestRuntime(
    { ...args, replaceVersions: { "platform-worker": 4 } },
    {
      bundle: phoneRecoveryRuntimeBundle,
      endpoints: PHONE_RECOVERY_RUNTIME_ENDPOINTS,
      bundleSha: PHONE_RECOVERY_RUNTIME_SHA,
      databaseFingerprint: PHONE_RECOVERY_RUNTIME_DATABASE,
      version: "learn-phone-recovery-runtime-deploy/1",
      stagePrefix: "learn-phone-recovery-runtime-",
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
    const prefix = ".verification-results/phone-recovery-runtime-edge-deploy";
    const result = await deployPhoneRecoveryRuntime({
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
      "Phone recovery runtime unconfirmed; inspect retained journal and TEST inventory before any further attempt.",
    );
    process.exitCode = 1;
  }
}
