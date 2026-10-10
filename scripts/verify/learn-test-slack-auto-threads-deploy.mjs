/** Replace only TEST Slack worker v7 with recurring thread authority rechecks. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

export const SLACK_AUTO_THREADS_DATABASE = "3e03c2984897d524c9fb25b45b93abc1";
export const SLACK_AUTO_THREADS_ENDPOINTS = [{ name: "learn-slack-worker", verifyJwt: true }];
export const SLACK_AUTO_THREADS_SHA =
  "80e0f6166c3d5489978c2007bde7a672d6e3a73be8ddfd5583b98a872a1d04ca";
export const slackAutoThreadsBundle = () => edgeRuntimeBundle(SLACK_AUTO_THREADS_ENDPOINTS);
export function deploySlackAutoThreads(args) {
  if (Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Replacement version is pinned to TEST worker v7");
  return deployPinnedTestRuntime(
    { ...args, replaceVersions: { "learn-slack-worker": 7 } },
    {
      bundle: slackAutoThreadsBundle,
      endpoints: SLACK_AUTO_THREADS_ENDPOINTS,
      bundleSha: SLACK_AUTO_THREADS_SHA,
      databaseFingerprint: SLACK_AUTO_THREADS_DATABASE,
      version: "learn-slack-auto-threads-deploy/1",
      stagePrefix: "learn-slack-auto-threads-",
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
    const prefix = ".verification-results/slack-auto-threads-edge-deploy";
    const result = await deploySlackAutoThreads({
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
      "Slack worker replacement unconfirmed; inspect retained journal and TEST inventory before any further attempt.",
    );
    process.exitCode = 1;
  }
}
