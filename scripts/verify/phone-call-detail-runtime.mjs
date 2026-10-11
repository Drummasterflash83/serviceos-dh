/** TEST-only retained call reader. No capture, credentials, accounts or schedules are created. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime } from "./learn-test-email-runtime-deploy.mjs";
import {
  readPhoneSavedResultsCatalog,
  phoneSavedResultsSourceQuery,
  PHONE_SAVED_RESULTS_PRESERVED,
} from "./learn-phone-saved-results-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
export const CALL_DETAIL_BUNDLE_SHA =
  "d5c27a9361382a955b4683c90c908174a9ace11e33c2de61d9ee133bbce115c5";
const SCHEMA = "6632f3df219ea27a9ccc3f668f198f00";
const endpoints = [{ name: "phone-call-detail", verifyJwt: true }];
const canonical = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
function validate(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== PHONE_SAVED_RESULTS_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !PHONE_SAVED_RESULTS_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation snapshot required");
  return canonical(rows);
}
export async function deployCallDetail(
  args,
  {
    catalog = readPhoneSavedResultsCatalog,
    query = communicationQuery,
    deploy = deployPinnedTestRuntime,
  } = {},
) {
  if (args.allowProjectRef !== TEST_PROJECT || Object.keys(args.replaceVersions ?? {}).length)
    throw Error("Exact new TEST endpoint required");
  const before = await catalog(args.token);
  if (before.fingerprint !== SCHEMA) throw Error("Exact saved-results TEST schema required");
  const sql = phoneSavedResultsSourceQuery(before.catalog.phone),
    rows = await query(args.token, sql),
    snapshot = validate(rows);
  const result = await deploy(
    {
      ...args,
      persistJournal: (j) =>
        args.persistJournal({ ...j, fullPreserved: rows, savedResultsSchema: SCHEMA }),
    },
    {
      bundle: () => edgeRuntimeBundle(endpoints),
      endpoints,
      bundleSha: CALL_DETAIL_BUNDLE_SHA,
      databaseFingerprint: "baee3642d040a87f807134d0cbe7de09",
      version: "phone-call-detail-runtime/2",
      stagePrefix: "phone-call-detail-runtime-",
    },
  );
  const after = await catalog(args.token),
    afterRows = await query(args.token, sql);
  const preserved = after.fingerprint === SCHEMA && validate(afterRows) === snapshot;
  return {
    ...result,
    state: preserved ? result.state : "requires_inspection",
    savedResultsSchema: after.fingerprint,
    fullPreservedDataSets: preserved ? rows.length : null,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("TEST deployment must be explicit");
    const prefix = ".verification-results/call-detail-runtime";
    const result = await deployCallDetail({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
      persistJournal: async (j) => {
        const fd = openSync(prefix + "-journal.json", "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify(j, null, 2));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      onProgress: (r) => console.log(JSON.stringify(r)),
    });
    writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(
      JSON.stringify({
        state: result.state,
        projectRef: result.projectRef,
        sourceBundleSha256: result.sourceBundleSha256,
        fullPreservedDataSets: result.fullPreservedDataSets,
      }),
    );
    if (result.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
  } catch {
    console.error("Call detail TEST deployment unconfirmed; inspect journal before any retry.");
    process.exitCode = 1;
  }
}
