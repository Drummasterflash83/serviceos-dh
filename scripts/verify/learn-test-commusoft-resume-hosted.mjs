/** Durable single-attempt release entrypoint. Confirmation performs only reads. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { releaseResume, confirmResume } from "./learn-test-commusoft-resume-release.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const prefix = ".verification-results/commusoft-resume-hosted-";
const save = (n, v) =>
  writeFileSync(prefix + n + ".json", JSON.stringify(v, null, 2) + "\n", { mode: 0o600 });
try {
  const a = process.argv.slice(2);
  if (
    a.length !== 2 ||
    !["--rehearse", "--apply", "--confirm-rehearse", "--confirm-apply"].includes(a[0]) ||
    a[1] !== "--existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST continuation operation required");
  const args = { allowProjectRef: TEST_PROJECT, token: savedCliToken() },
    mode = a[0].includes("rehearse") ? "rehearse" : "apply";
  let result;
  if (a[0].startsWith("--confirm-")) {
    const journal = JSON.parse(readFileSync(prefix + mode + "-journal.json"));
    const c = await confirmResume({ ...args, journal });
    save(mode + "-confirmed-catalog", c.catalog);
    result = c.report;
  } else
    result = await releaseResume({
      ...args,
      rehearse: mode === "rehearse",
      rehearsal:
        mode === "apply" ? JSON.parse(readFileSync(prefix + "rehearse-result.json")) : null,
      persistJournal: async (journal) => {
        const fd = openSync(prefix + mode + "-journal.json", "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify(journal, null, 2) + "\n");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
    });
  save(mode + (a[0].startsWith("--confirm-") ? "-confirmation" : "-result"), result);
  console.log(JSON.stringify(result, null, 2));
  if (
    ![
      "rehearsed_and_rolled_back",
      "prior_state_confirmed",
      "installed_needs_authenticated_acceptance",
      "already_installed",
    ].includes(result.state)
  )
    process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : "Continuation release unavailable");
  process.exitCode = 1;
}
