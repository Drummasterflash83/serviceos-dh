/** Replace only TEST phone sync v3 endpoints with per-page capture/account rechecks. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

export const PHONE_PAGE_GUARDS_DATABASE = "3e03c2984897d524c9fb25b45b93abc1";
export const PHONE_PAGE_GUARDS_ENDPOINTS = [
  { name: "simwood-sync-calls", verifyJwt: true },
  { name: "simwood-sync-recordings", verifyJwt: true },
];
export const PHONE_PAGE_GUARDS_SHA =
  "0259b59652f40ada10317612172f31fc99400afa6bd82186216d10d3a2c4d611";
export const phonePageGuardsBundle = () => edgeRuntimeBundle(PHONE_PAGE_GUARDS_ENDPOINTS);
export function deployPhonePageGuards(args) {
  if (Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Replacement versions are pinned to TEST phone sync v3");
  return deployPinnedTestRuntime(
    { ...args, replaceVersions: { "simwood-sync-calls": 3, "simwood-sync-recordings": 3 } },
    {
      bundle: phonePageGuardsBundle,
      endpoints: PHONE_PAGE_GUARDS_ENDPOINTS,
      bundleSha: PHONE_PAGE_GUARDS_SHA,
      databaseFingerprint: PHONE_PAGE_GUARDS_DATABASE,
      version: "learn-phone-page-guards-deploy/1",
      stagePrefix: "learn-phone-page-guards-",
    },
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST replacement required");
    const prefix = ".verification-results/phone-page-guards-edge-deploy";
    const result = await deployPhonePageGuards({
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
