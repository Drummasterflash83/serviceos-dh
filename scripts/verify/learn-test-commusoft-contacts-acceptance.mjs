/** Explicit hosted synthetic acceptance against the installed contacts release. */
import { readFileSync, writeFileSync } from "node:fs";
import { acceptCommusoftIngestion } from "./learn-test-commusoft-ingestion-acceptance.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
try {
  if (
    process.argv.length !== 6 ||
    process.argv.slice(2, 5).join(" ") !== "--run --existing-cli-login --plan" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit synthetic contacts TEST acceptance required");
  const result = await acceptCommusoftIngestion({
    allowProjectRef: TEST_PROJECT,
    token: savedCliToken(),
    includeContacts: true,
    contactFixturePlan: JSON.parse(readFileSync(process.argv[5], "utf8")),
  });
  writeFileSync(
    ".verification-results/commusoft-contacts-hosted-acceptance.json",
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.state !== "passed") process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : "Hosted contact acceptance unavailable");
  process.exitCode = 1;
}
