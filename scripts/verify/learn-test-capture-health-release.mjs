/** Pinned TEST capture health release. Unknown outcomes require read-only confirmation. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  readCaptureCatalog,
  CAPTURE_FUNCTIONS,
  CAPTURE_BASE_TABLES,
} from "./learn-capture-health-catalog.mjs";
import { installedResume, resumeFingerprint } from "./learn-test-commusoft-resume-release.mjs";
import { CONTACT_PRESERVED_TABLES } from "./learn-test-commusoft-contacts-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export const CAPTURE_PRESERVED_TABLES = [
  ...new Set([...CONTACT_PRESERVED_TABLES, "public.email_accounts"]),
];
export const CAPTURE_SNAPSHOT_QUERY = CAPTURE_PRESERVED_TABLES.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export function normalizedCaptureSources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== CAPTURE_PRESERVED_TABLES.length ||
    new Set(rows.map((r) => r.name)).size !== CAPTURE_PRESERVED_TABLES.length ||
    rows.some(
      (r) =>
        !CAPTURE_PRESERVED_TABLES.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete capture source snapshot required");
  return rows
    .map(({ name, count, fingerprint }) => ({ name, count, fingerprint }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const CAPTURE_RELEASE = "learn_capture_health_v1";
export const CAPTURE_SHA = "180d21a3befd7c97a14d7221a285873060466a9d376afb334d253a08000362c3";
const marker = "learn-test-capture-health/1";
const hashes = {
  manifest: "104a40ab7d65f75f416b0bc6ca87ed5086413977ad86e00ef9304abc1df20777",
  expected: "82a71b95488052dc8cc6325a4401e3f9507fb64c0181357a48d43ed9c1524cd7",
  prerequisites: "99947cae7578d7469e8d06703990a66d0490322a44651afed66d53e4ed864b77",
};
function checked(ext, sha) {
  const raw = readFileSync(
    new URL("../../supabase/release/learn-test/031_capture_health." + ext, import.meta.url),
  );
  if (createHash("sha256").update(raw).digest("hex") !== sha)
    throw Error("Reviewed capture health package differs");
  return raw.toString();
}
export const capturePrior = () => JSON.parse(checked("prerequisites.json", hashes.prerequisites));
export const captureExpected = () => JSON.parse(checked("expected.json", hashes.expected));
export const captureFingerprint = (c) =>
  digest({
    prior: resumeFingerprint(c),
    functions: c.captureFunctions,
    grants: c.captureGrants,
    tables: c.tables.filter((t) => CAPTURE_BASE_TABLES.includes(t.name)),
  });
export function capturePrerequisites(c) {
  const p = capturePrior();
  return (
    installedResume(c) &&
    digest(c.captureFunctions) === digest(p.functions) &&
    digest(c.captureGrants) === digest(p.grants) &&
    digest(c.tables.filter((t) => CAPTURE_BASE_TABLES.includes(t.name))) === digest(p.tables)
  );
}
const compact = (f) => ({
  name: f.name,
  arguments: f.arguments,
  securityDefiner: f.securityDefiner,
  authenticatedExecute: f.authenticatedExecute,
  anonExecute: f.anonExecute,
});
export function withoutCapture(c) {
  const out = structuredClone(c);
  out.captureFunctions = out.captureFunctions.filter((f) => !CAPTURE_FUNCTIONS.includes(f.name));
  out.base.inventory.functions = out.base.inventory.functions.filter(
    (f) => !CAPTURE_FUNCTIONS.includes(f.name),
  );
  for (const r of [out.readiness, out.base.report])
    r.customMigrationEntries = r.customMigrationEntries.filter(
      (e) => e.migration_name !== CAPTURE_RELEASE,
    );
  out.readinessCatalogSha256 = catalogFingerprint(out.base);
  return out;
}
export function installedCapture(c) {
  const expected = captureExpected();
  const receipt = (rows) =>
    Array.isArray(rows) &&
    rows.length === 32 &&
    rows.filter(
      (r) =>
        r.migration_name === CAPTURE_RELEASE &&
        r.source_sha256 === CAPTURE_SHA &&
        r.project_ref === TEST_PROJECT,
    ).length === 1;
  if (
    !receipt(c.readiness?.customMigrationEntries) ||
    !receipt(c.base?.report?.customMigrationEntries) ||
    !Array.isArray(c.captureFunctions) ||
    digest(c.captureFunctions.filter((f) => CAPTURE_FUNCTIONS.includes(f.name))) !==
      digest(expected.functions) ||
    digest(c.base.inventory.functions.filter((f) => CAPTURE_FUNCTIONS.includes(f.name))) !==
      digest(expected.functions.map(compact))
  )
    return false;
  return capturePrerequisites(withoutCapture(c));
}
export function captureSql(rehearse) {
  captureExpected();
  const m = JSON.parse(checked("manifest.json", hashes.manifest));
  if (m.sha256 !== CAPTURE_SHA) throw Error("Capture health checksum differs");
  for (const s of m.sources)
    if (
      createHash("sha256")
        .update(readFileSync(new URL("../../" + s.path, import.meta.url)))
        .digest("hex") !== s.sha256
    )
      throw Error("Capture health source changed since packaging");
  let sql = checked("sql", CAPTURE_SHA);
  if (sql.split("\nbegin;\n").length !== 2 || sql.split("\ncommit;\n").length !== 2)
    throw Error("Capture health transaction framing differs");
  sql = sql.replace(
    "\nbegin;\n",
    `\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${CAPTURE_SHA}';\n`,
  );
  if (rehearse) sql = sql.replace("\ncommit;\n", "\nrollback;\n");
  return (
    sql +
    `select '${marker}' as marker,${rehearse ? "not " : ""}exists(select 1 from of_test_deploy.migrations where migration_name='${CAPTURE_RELEASE}' and source_sha256='${CAPTURE_SHA}') as receipt_expected;`
  );
}
export async function confirmCapture({ allowProjectRef, token, journal, fetcher = fetch }) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    journal?.version !== marker ||
    journal.projectRef !== TEST_PROJECT ||
    journal.sourceSha256 !== CAPTURE_SHA ||
    !["rehearse", "apply"].includes(journal.mode) ||
    !capturePrerequisites(journal.before)
  )
    throw Error("Matching TEST capture health journal required");
  const after = await readCaptureCatalog({ allowProjectRef, token, fetcher });
  const sources = normalizedCaptureSources(
    await communicationQuery(token, CAPTURE_SNAPSHOT_QUERY, { fetcher }),
  );
  const installed = installedCapture(after),
    prior = capturePrerequisites(after);
  const priorCatalogPreserved =
    captureFingerprint(installed ? withoutCapture(after) : after) ===
    captureFingerprint(journal.before);
  const sourcePreserved =
    digest(sources) === digest(normalizedCaptureSources(journal.sourceBefore));
  return {
    catalog: after,
    report: {
      version: marker,
      projectRef: TEST_PROJECT,
      sourceSha256: CAPTURE_SHA,
      observedAt: new Date().toISOString(),
      writeAttempted: false,
      priorCatalogPreserved,
      preExistingSourcesPreserved: sourcePreserved,
      sourceAfter: sources,
      state:
        priorCatalogPreserved && sourcePreserved
          ? installed
            ? "installed_needs_authenticated_acceptance"
            : prior
              ? "prior_state_confirmed"
              : "requires_inspection"
          : "requires_inspection",
    },
  };
}
export async function releaseCapture({
  allowProjectRef,
  token,
  rehearse,
  rehearsal,
  persistJournal,
  fetcher = fetch,
  clock = Date.now,
}) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    typeof rehearse !== "boolean" ||
    typeof persistJournal !== "function"
  )
    throw Error("Explicit TEST capture health operation and durable journal required");
  const args = { allowProjectRef, token, fetcher },
    before = await readCaptureCatalog(args);
  if (installedCapture(before)) return { state: "already_installed", writeAttempted: false };
  if (!capturePrerequisites(before))
    throw Error("Exact capture health dependencies and current verification runtime required");
  if (!rehearse) {
    const at = Date.parse(rehearsal?.observedAt),
      now = clock();
    if (
      rehearsal?.version !== marker ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.sourceSha256 !== CAPTURE_SHA ||
      rehearsal.state !== "rehearsed_and_rolled_back" ||
      rehearsal.acknowledged !== true ||
      rehearsal.preExistingSourcesPreserved !== true ||
      rehearsal.beforeFingerprint !== rehearsal.afterFingerprint ||
      rehearsal.afterFingerprint !== captureFingerprint(before) ||
      !Number.isFinite(at) ||
      !Number.isFinite(now) ||
      at > now ||
      now - at > 3600000
    )
      throw Error("Fresh preserving capture health rehearsal required");
  }
  const sql = captureSql(rehearse),
    sourceBefore = normalizedCaptureSources(
      await communicationQuery(token, CAPTURE_SNAPSHOT_QUERY, { fetcher }),
    );
  const journal = {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: CAPTURE_SHA,
    mode: rehearse ? "rehearse" : "apply",
    observedAt: new Date(clock()).toISOString(),
    before,
    sourceBefore,
  };
  await persistJournal(journal);
  let acknowledged = false;
  try {
    const rows = await communicationQuery(token, sql, { fetcher, readOnly: false });
    acknowledged =
      rows?.length === 1 && rows[0].marker === marker && rows[0].receipt_expected === true;
  } catch {
    /* The durable journal survives; inspect without resubmission. */
  }
  let confirmation = null;
  try {
    confirmation = await confirmCapture({ ...args, journal });
  } catch {}
  const report = confirmation?.report;
  return {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: CAPTURE_SHA,
    observedAt: new Date(clock()).toISOString(),
    writeAttempted: true,
    acknowledged,
    beforeFingerprint: captureFingerprint(before),
    afterFingerprint: confirmation ? captureFingerprint(confirmation.catalog) : null,
    preExistingSourcesPreserved: report?.preExistingSourcesPreserved === true,
    priorCatalogPreserved: report?.priorCatalogPreserved === true,
    sourceBefore,
    sourceAfter: report?.sourceAfter ?? null,
    state:
      acknowledged &&
      report?.state ===
        (rehearse ? "prior_state_confirmed" : "installed_needs_authenticated_acceptance")
        ? rehearse
          ? "rehearsed_and_rolled_back"
          : "installed_needs_authenticated_acceptance"
        : "requires_inspection",
  };
}
