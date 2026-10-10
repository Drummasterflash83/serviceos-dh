/** Explicit deploy/confirm entrypoint. A durable journal prevents repeat submission. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import {
  deployVerification,
  inspectVerificationDeployment,
  VERIFICATION_ENDPOINT_SHA,
} from "./learn-test-commusoft-verification-deploy.mjs";
import { readConnectionSetupCatalog, CONNECTION_TABLES } from "./learn-commusoft-setup-catalog.mjs";
import { CONNECTION_PRESERVED_TABLES } from "./learn-test-commusoft-setup-hosted.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
const tables = [...CONNECTION_PRESERVED_TABLES, ...CONNECTION_TABLES.map((n) => "public." + n)];
const snapshotQuery = tables
  .map(
    (n) =>
      `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
  )
  .join(" union all ");
const prefix = ".verification-results/commusoft-verification-endpoint-";
const read = (n) => JSON.parse(readFileSync(prefix + n + ".json"));
const save = (n, v) =>
  writeFileSync(prefix + n + ".json", JSON.stringify(v, null, 2) + "\n", { mode: 0o600 });
const normalize = (rows) => {
  if (
    !Array.isArray(rows) ||
    rows.length !== tables.length ||
    new Set(rows.map((r) => r.name)).size !== tables.length ||
    rows.some(
      (r) =>
        !tables.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Source snapshot incomplete");
  return rows.sort((a, b) => a.name.localeCompare(b.name));
};
try {
  const a = process.argv.slice(2);
  if (
    a.length !== 2 ||
    !["--deploy", "--confirm"].includes(a[0]) ||
    a[1] !== "--existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST deployment operation required");
  const token = savedCliToken(),
    args = { allowProjectRef: TEST_PROJECT, token };
  const snapshot = async () => normalize(await communicationQuery(token, snapshotQuery));
  let result, journal;
  if (a[0] === "--deploy") {
    result = await deployVerification({
      ...args,
      beforeDeploy: async (before) => {
        journal = {
          version: "learn-verification-deploy-journal/1",
          projectRef: TEST_PROJECT,
          sourceBundleSha256: VERIFICATION_ENDPOINT_SHA,
          observedAt: new Date().toISOString(),
          before,
          sourceBefore: await snapshot(),
        };
        const fd = openSync(prefix + "journal.json", "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify(journal, null, 2) + "\n");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
    });
    save("deployment", result);
  } else {
    journal = read("journal");
    const deployment = read("deployment");
    if (
      journal.projectRef !== TEST_PROJECT ||
      journal.sourceBundleSha256 !== VERIFICATION_ENDPOINT_SHA ||
      deployment.projectRef !== TEST_PROJECT ||
      deployment.sourceBundleSha256 !== VERIFICATION_ENDPOINT_SHA
    )
      throw Error("Matching TEST deployment evidence required");
    const after = await readConnectionSetupCatalog(args);
    result = {
      ...inspectVerificationDeployment({
        before: journal.before,
        after,
        status: deployment.cliExitStatus,
      }),
      writeAttempted: false,
    };
    save("catalog-confirmed", after);
  }
  let sourceAfter = null;
  try {
    sourceAfter = await snapshot();
  } catch {}
  const preserved =
    sourceAfter !== null &&
    JSON.stringify(normalize(journal.sourceBefore)) === JSON.stringify(sourceAfter);
  const report = {
    ...result,
    state: preserved ? result.state : "requires_inspection",
    preExistingSourcesPreserved: preserved,
    sourceBefore: journal.sourceBefore,
    sourceAfter,
  };
  save(a[0] === "--deploy" ? "result" : "confirmation", report);
  console.log(JSON.stringify({ ...report, sourceBefore: undefined, sourceAfter: undefined }));
  if (report.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
} catch (e) {
  console.error(e.message);
  console.error(
    "Inspect the retained TEST journal; do not repeat deployment after an uncertain result.",
  );
  process.exitCode = 1;
}
