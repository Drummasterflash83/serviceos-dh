/** Install the recurring Slack scheduling endpoint in TEST. No grants, secrets or schedules. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

export const SLACK_SCHEDULE_DATABASE = "ff17abb65894813f89e2df1bda2a4624";
export const SLACK_SCHEDULE_ENDPOINTS = [{ name: "learn-slack-schedule", verifyJwt: true }];
export const SLACK_SCHEDULE_SHA =
  "bb84ca48755520f67b50b6ec1b7dac01119212b61428c79240735d62dcae679b";
export const slackScheduleBundle = () => edgeRuntimeBundle(SLACK_SCHEDULE_ENDPOINTS);
export function deploySlackSchedule(args) {
  if (Object.keys(args.replaceVersions ?? {}).length)
    throw Error("First installation only; review replacements separately");
  return deployPinnedTestRuntime(args, {
    bundle: slackScheduleBundle,
    endpoints: SLACK_SCHEDULE_ENDPOINTS,
    bundleSha: SLACK_SCHEDULE_SHA,
    databaseFingerprint: SLACK_SCHEDULE_DATABASE,
    version: "learn-slack-schedule-deploy/1",
    stagePrefix: "learn-slack-schedule-",
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST installation required");
    const prefix = ".verification-results/slack-schedule-edge-deploy";
    const result = await deploySlackSchedule({
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
      "Slack schedule installation unconfirmed; inspect retained journal and TEST inventory before any further attempt.",
    );
    process.exitCode = 1;
  }
}
