/** Pinned TEST transaction. Rehearsal is rolled back; apply needs its exact receipt. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readRuntimeCatalog,
  RUNTIME_SNAPSHOT_QUERY,
  RUNTIME_PRESERVED,
} from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export const RUNTIME_SHA = "7f6f701b3a7e38915bd43be895cddbc15b56eed468361b41b16ca4a26e13c100";
export const RUNTIME_MARKER = "learn-email-runtime/1";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sorted = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function runtimePackage() {
  const prefix = new URL("../../supabase/release/learn-test/033_email_runtime", import.meta.url);
  const sql = readFileSync(prefix.pathname + ".sql", "utf8");
  const manifest = JSON.parse(readFileSync(prefix.pathname + ".manifest.json"));
  if (
    hash(sql) !== RUNTIME_SHA ||
    manifest.sha256 !== RUNTIME_SHA ||
    manifest.projectRef !== TEST_PROJECT
  )
    throw Error("Pinned email runtime package changed");
  for (const source of manifest.sources)
    if (hash(readFileSync(new URL("../../" + source.path, import.meta.url))) !== source.sha256)
      throw Error("Email runtime source changed after packaging");
  return { sql, manifest };
}
function validateSources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== RUNTIME_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== RUNTIME_PRESERVED.length ||
    rows.some(
      (r) =>
        !RUNTIME_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete source fingerprints required");
  return sorted(rows);
}
/** Inspect an uncertain attempt without submitting its SQL again. */
export async function confirmRuntime({ allowProjectRef, token, journal, fetcher = fetch }) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    journal?.projectRef !== TEST_PROJECT ||
    journal?.version !== RUNTIME_MARKER ||
    journal?.sourceSha256 !== RUNTIME_SHA ||
    !["rehearse", "apply"].includes(journal?.mode) ||
    typeof token !== "string" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token)
  )
    throw Error("Matching TEST runtime journal required");
  const { manifest } = runtimePackage();
  if (journal.priorFingerprint !== manifest.priorFingerprint)
    throw Error("Journal prerequisites differ");
  const sources = validateSources(journal.sources);
  const [after, currentSources] = await Promise.all([
    readRuntimeCatalog(token, { fetcher }),
    communicationQuery(token, RUNTIME_SNAPSHOT_QUERY, { fetcher }),
  ]);
  const preserved = same(validateSources(currentSources), sources);
  const installed =
    journal.mode === "apply" &&
    after.fingerprint === journal.expectedFingerprint &&
    after.catalog.ledger.some(
      (r) =>
        r.migration_name === "learn_email_runtime_v1" &&
        r.source_sha256 === RUNTIME_SHA &&
        r.project_ref === TEST_PROJECT,
    );
  return {
    version: RUNTIME_MARKER,
    projectRef: TEST_PROJECT,
    sourceSha256: RUNTIME_SHA,
    mode: journal.mode,
    observedAt: new Date().toISOString(),
    state:
      preserved && installed
        ? "installed_needs_runtime_acceptance"
        : preserved && after.fingerprint === journal.priorFingerprint
          ? "prior_state_confirmed"
          : "requires_inspection",
    writeAttempted: false,
    preservedDataSets: preserved ? sources.length : null,
  };
}
export async function releaseRuntime({
  allowProjectRef,
  token,
  mode,
  rehearsal,
  persistJournal,
  fetcher = fetch,
}) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    !["rehearse", "apply"].includes(mode) ||
    typeof persistJournal !== "function" ||
    typeof token !== "string" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token)
  )
    throw Error("Explicit TEST operation, saved login and durable journal required");
  const { sql, manifest } = runtimePackage();
  if (
    mode === "apply" &&
    (rehearsal?.state !== "rehearsed_and_rolled_back" ||
      rehearsal.sourceSha256 !== RUNTIME_SHA ||
      rehearsal.projectRef !== TEST_PROJECT ||
      !/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint ?? ""))
  )
    throw Error("Matching confirmed rehearsal required");
  const options = { fetcher };
  const before = await readRuntimeCatalog(token, options);
  if (before.fingerprint !== manifest.priorFingerprint)
    throw Error("TEST email prerequisites changed; inspect before release");
  const sources = validateSources(await communicationQuery(token, RUNTIME_SNAPSHOT_QUERY, options));
  const journal = {
    version: RUNTIME_MARKER,
    mode,
    projectRef: TEST_PROJECT,
    sourceSha256: RUNTIME_SHA,
    priorFingerprint: before.fingerprint,
    sources,
    observedAt: new Date().toISOString(),
    expectedFingerprint: mode === "apply" ? rehearsal.expectedFingerprint : null,
  };
  await persistJournal(journal);
  let command = sql.replace(
    "\nbegin;\n",
    `\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${RUNTIME_SHA}';\n`,
  );
  if (mode === "rehearse") command = command.replace("\ncommit;\n", "\nrollback;\n");
  let rows;
  try {
    rows = await communicationQuery(token, command, { fetcher, readOnly: false });
  } catch {
    return { ...journal, state: "unconfirmed", writeAttempted: true };
  }
  const receipt = rows?.find((r) => r.marker === RUNTIME_MARKER);
  if (
    !receipt ||
    !/^[a-f0-9]{32}$/.test(receipt.fingerprint ?? "") ||
    receipt.catalog?.ledger?.length !== 34 ||
    !receipt.catalog.ledger.some(
      (r) =>
        r.migration_name === "learn_email_runtime_v1" &&
        r.source_sha256 === RUNTIME_SHA &&
        r.project_ref === TEST_PROJECT,
    ) ||
    !same(validateSources(receipt.preserved), sources)
  )
    return { ...journal, state: "unconfirmed", writeAttempted: true };
  if (mode === "apply" && receipt.fingerprint !== rehearsal.expectedFingerprint)
    return { ...journal, state: "requires_inspection", writeAttempted: true };
  const [after, afterSources] = await Promise.all([
    readRuntimeCatalog(token, options),
    communicationQuery(token, RUNTIME_SNAPSHOT_QUERY, options),
  ]);
  const expected = mode === "rehearse" ? before.fingerprint : receipt.fingerprint;
  const confirmed = after.fingerprint === expected && same(validateSources(afterSources), sources);
  return {
    version: RUNTIME_MARKER,
    projectRef: TEST_PROJECT,
    mode,
    sourceSha256: RUNTIME_SHA,
    observedAt: new Date().toISOString(),
    state: confirmed
      ? mode === "rehearse"
        ? "rehearsed_and_rolled_back"
        : "installed_needs_runtime_acceptance"
      : "requires_inspection",
    writeAttempted: true,
    priorFingerprint: before.fingerprint,
    expectedFingerprint: receipt.fingerprint,
    preservedDataSets: sources.length,
    expectedCatalog: receipt.catalog,
  };
}
