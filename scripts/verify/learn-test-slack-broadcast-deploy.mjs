/** Replace only TEST Slack worker v6 with broadcast retention and capture admission. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

export const SLACK_BROADCAST_DATABASE = "ff17abb65894813f89e2df1bda2a4624";
export const SLACK_BROADCAST_ENDPOINTS = [{ name: "learn-slack-worker", verifyJwt: true }];
export const SLACK_BROADCAST_SHA =
  "3edcadf65ebcde648d4009e89d2ca08b946643fd645cdc80cde55ebdab8c7636";
export const slackBroadcastBundle = () => edgeRuntimeBundle(SLACK_BROADCAST_ENDPOINTS);
export function deploySlackBroadcast(args) {
  if (Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Replacement version is pinned to TEST worker v6");
  return deployPinnedTestRuntime({ ...args, replaceVersions: { "learn-slack-worker": 6 } }, {
    bundle: slackBroadcastBundle,
    endpoints: SLACK_BROADCAST_ENDPOINTS,
    bundleSha: SLACK_BROADCAST_SHA,
    databaseFingerprint: SLACK_BROADCAST_DATABASE,
    version: "learn-slack-broadcast-deploy/1",
    stagePrefix: "learn-slack-broadcast-",
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST replacement required");
    const prefix = ".verification-results/slack-broadcast-edge-deploy";
    const result = await deploySlackBroadcast({
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
