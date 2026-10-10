import { openSync, writeSync, fsyncSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import { releaseRuntime, confirmRuntime } from "./learn-test-email-runtime-release.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const operation = process.argv[2]?.replace(/^--/, "");
const mode = operation?.replace(/^confirm-/, "");
const prefix = ".verification-results/email-runtime-";
try {
  if (
    process.argv.length !== 4 ||
    process.argv[3] !== "--existing-cli-login" ||
    !["rehearse", "apply", "confirm-rehearse", "confirm-apply"].includes(operation) ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST email runtime operation required");
  const result = operation.startsWith("confirm-")
    ? await confirmRuntime({
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        journal: JSON.parse(readFileSync(prefix + mode + "-journal.json")),
      })
    : await releaseRuntime({
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        mode,
        rehearsal:
          mode === "apply" ? JSON.parse(readFileSync(prefix + "rehearse-result.json")) : null,
        persistJournal: async (journal) => {
          const fd = openSync(prefix + mode + "-journal.json", "wx", 0o600);
          try {
            writeSync(fd, JSON.stringify(journal, null, 2));
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        },
      });
  writeFileSync(prefix + operation + "-result.json", JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  const { expectedCatalog, ...report } = result;
  console.log(JSON.stringify(report, null, 2));
  if (
    ![
      "rehearsed_and_rolled_back",
      "installed_needs_runtime_acceptance",
      "prior_state_confirmed",
    ].includes(result.state)
  )
    process.exitCode = 1;
} catch {
  console.error(
    "Email runtime release did not confirm; inspect its private journal and TEST state before any retry.",
  );
  process.exitCode = 1;
}
