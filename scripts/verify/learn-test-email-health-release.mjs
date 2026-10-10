/** Pinned TEST email health release. Unknown outcomes require read-only confirmation. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readEmailHealthCatalog, EMAIL_HEALTH_TABLES } from "./learn-email-health-catalog.mjs";
import {
  installedCapture,
  captureFingerprint,
  CAPTURE_PRESERVED_TABLES,
} from "./learn-test-capture-health-release.mjs";
const EMAIL_HEALTH_FUNCTIONS = ["learn_operator_capture_health"];
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export const EMAIL_HEALTH_PRESERVED_TABLES = [
  ...new Set([...CAPTURE_PRESERVED_TABLES, "public.email_sync_runs"]),
];
export const EMAIL_HEALTH_SNAPSHOT_QUERY = EMAIL_HEALTH_PRESERVED_TABLES.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export function normalizedEmailHealthSources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== EMAIL_HEALTH_PRESERVED_TABLES.length ||
    new Set(rows.map((r) => r.name)).size !== EMAIL_HEALTH_PRESERVED_TABLES.length ||
    rows.some(
      (r) =>
        !EMAIL_HEALTH_PRESERVED_TABLES.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete email health source snapshot required");
  return rows
    .map(({ name, count, fingerprint }) => ({ name, count, fingerprint }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const EMAIL_HEALTH_RELEASE = "learn_email_capture_evidence_v1";
export const EMAIL_HEALTH_SHA = "4878e07309ac54650aee5d0e25b0a714e030edd23358e4b9c5b44e2e164d573c";
const marker = "learn-test-email-health/1";
const hashes = {
  manifest: "86205b12aeaa71bb3ba257c6f119316543e9a1978a6890cf633b92ac394b6d83",
  expected: "b690bdc13462d2fb0bc9868f0de789cc46c494043897d506f5ea8238f9619aa4",
  prerequisites: "f24075d7adaaf403a777cf7781a3ec7ed77bb5075d8fa1944e84acfeef1b50ee",
};
function checked(ext, sha) {
  const raw = readFileSync(
    new URL("../../supabase/release/learn-test/032_email_capture_evidence." + ext, import.meta.url),
  );
  if (createHash("sha256").update(raw).digest("hex") !== sha)
    throw Error("Reviewed email health package differs");
  return raw.toString();
}
export const emailHealthPrior = () =>
  JSON.parse(checked("prerequisites.json", hashes.prerequisites));
export const emailHealthExpected = () => JSON.parse(checked("expected.json", hashes.expected));
export const emailHealthFingerprint = (c) =>
  digest({
    prior: captureFingerprint(c),
    functions: c.emailHealthFunctions,
    grants: c.emailHealthGrants,
    tables: c.tables.filter((t) => EMAIL_HEALTH_TABLES.includes(t.name)),
  });
export function emailHealthPrerequisites(c) {
  const p = emailHealthPrior();
  return (
    installedCapture(c) &&
    digest(c.emailHealthFunctions) === digest(p.functions) &&
    digest(c.emailHealthGrants) === digest(p.grants) &&
    digest(c.tables.filter((t) => EMAIL_HEALTH_TABLES.includes(t.name))) === digest(p.tables)
  );
}
const compact = (f) => ({
  name: f.name,
  arguments: f.arguments,
  securityDefiner: f.securityDefiner,
  authenticatedExecute: f.authenticatedExecute,
  anonExecute: f.anonExecute,
});
export function withoutEmailHealth(c) {
  const out = structuredClone(c),
    prior = emailHealthPrior();
  const old = prior.functions.find((f) => f.name === "learn_operator_capture_health");
  for (const key of ["emailHealthFunctions", "captureFunctions"])
    out[key] = out[key].map((f) => (f.name === old.name ? old : f));
  out.base.inventory.functions = out.base.inventory.functions.map((f) =>
    f.name === old.name ? compact(old) : f,
  );
  const table = prior.tables.find((t) => t.name === "email_sync_runs");
  out.tables = out.tables.map((t) => (t.name === table.name ? table : t));
  for (const r of [out.readiness, out.base.report])
    r.customMigrationEntries = r.customMigrationEntries.filter(
      (e) => e.migration_name !== EMAIL_HEALTH_RELEASE,
    );
  out.readinessCatalogSha256 = catalogFingerprint(out.base);
  return out;
}
export function installedEmailHealth(c) {
  const expected = emailHealthExpected();
  const receipt = (rows) =>
    Array.isArray(rows) &&
    rows.length === 33 &&
    rows.filter(
      (r) =>
        r.migration_name === EMAIL_HEALTH_RELEASE &&
        r.source_sha256 === EMAIL_HEALTH_SHA &&
        r.project_ref === TEST_PROJECT,
    ).length === 1;
  if (
    !receipt(c.readiness?.customMigrationEntries) ||
    !receipt(c.base?.report?.customMigrationEntries) ||
    !Array.isArray(c.emailHealthFunctions) ||
    digest(c.emailHealthFunctions.filter((f) => EMAIL_HEALTH_FUNCTIONS.includes(f.name))) !==
      digest(expected.functions) ||
    digest(c.base.inventory.functions.filter((f) => EMAIL_HEALTH_FUNCTIONS.includes(f.name))) !==
      digest(expected.functions.map(compact))
  )
    return false;
  if (
    digest(c.captureFunctions.filter((f) => EMAIL_HEALTH_FUNCTIONS.includes(f.name))) !==
      digest(expected.functions) ||
    digest(c.tables.filter((t) => t.name === "email_sync_runs")) !== digest(expected.tables)
  )
    return false;
  return emailHealthPrerequisites(withoutEmailHealth(c));
}
export function emailHealthSql(rehearse) {
  emailHealthExpected();
  const m = JSON.parse(checked("manifest.json", hashes.manifest));
  if (m.sha256 !== EMAIL_HEALTH_SHA) throw Error("Email health checksum differs");
  for (const s of m.sources)
    if (
      createHash("sha256")
        .update(readFileSync(new URL("../../" + s.path, import.meta.url)))
        .digest("hex") !== s.sha256
    )
      throw Error("Email health source changed since packaging");
  let sql = checked("sql", EMAIL_HEALTH_SHA);
  if (sql.split("\nbegin;\n").length !== 2 || sql.split("\ncommit;\n").length !== 2)
    throw Error("Email health transaction framing differs");
  sql = sql.replace(
    "\nbegin;\n",
    `\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${EMAIL_HEALTH_SHA}';\n`,
  );
  if (rehearse) sql = sql.replace("\ncommit;\n", "\nrollback;\n");
  return (
    sql +
    `select '${marker}' as marker,${rehearse ? "not " : ""}exists(select 1 from of_test_deploy.migrations where migration_name='${EMAIL_HEALTH_RELEASE}' and source_sha256='${EMAIL_HEALTH_SHA}') as receipt_expected;`
  );
}
export async function confirmEmailHealth({ allowProjectRef, token, journal, fetcher = fetch }) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    journal?.version !== marker ||
    journal.projectRef !== TEST_PROJECT ||
    journal.sourceSha256 !== EMAIL_HEALTH_SHA ||
    !["rehearse", "apply"].includes(journal.mode) ||
    !emailHealthPrerequisites(journal.before)
  )
    throw Error("Matching TEST email health journal required");
  const after = await readEmailHealthCatalog({ allowProjectRef, token, fetcher });
  const sources = normalizedEmailHealthSources(
    await communicationQuery(token, EMAIL_HEALTH_SNAPSHOT_QUERY, { fetcher }),
  );
  const installed = installedEmailHealth(after),
    prior = emailHealthPrerequisites(after);
  const priorCatalogPreserved =
    emailHealthFingerprint(installed ? withoutEmailHealth(after) : after) ===
    emailHealthFingerprint(journal.before);
  const sourcePreserved =
    digest(sources) === digest(normalizedEmailHealthSources(journal.sourceBefore));
  return {
    catalog: after,
    report: {
      version: marker,
      projectRef: TEST_PROJECT,
      sourceSha256: EMAIL_HEALTH_SHA,
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
export async function releaseEmailHealth({
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
    throw Error("Explicit TEST email health operation and durable journal required");
  const args = { allowProjectRef, token, fetcher },
    before = await readEmailHealthCatalog(args);
  if (installedEmailHealth(before)) return { state: "already_installed", writeAttempted: false };
  if (!emailHealthPrerequisites(before))
    throw Error("Exact email health dependencies and current verification runtime required");
  if (!rehearse) {
    const at = Date.parse(rehearsal?.observedAt),
      now = clock();
    if (
      rehearsal?.version !== marker ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.sourceSha256 !== EMAIL_HEALTH_SHA ||
      rehearsal.state !== "rehearsed_and_rolled_back" ||
      rehearsal.acknowledged !== true ||
      rehearsal.preExistingSourcesPreserved !== true ||
      rehearsal.beforeFingerprint !== rehearsal.afterFingerprint ||
      rehearsal.afterFingerprint !== emailHealthFingerprint(before) ||
      !Number.isFinite(at) ||
      !Number.isFinite(now) ||
      at > now ||
      now - at > 3600000
    )
      throw Error("Fresh preserving email health rehearsal required");
  }
  const sql = emailHealthSql(rehearse),
    sourceBefore = normalizedEmailHealthSources(
      await communicationQuery(token, EMAIL_HEALTH_SNAPSHOT_QUERY, { fetcher }),
    );
  const journal = {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: EMAIL_HEALTH_SHA,
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
    confirmation = await confirmEmailHealth({ ...args, journal });
  } catch {}
  const report = confirmation?.report;
  return {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: EMAIL_HEALTH_SHA,
    observedAt: new Date(clock()).toISOString(),
    writeAttempted: true,
    acknowledged,
    beforeFingerprint: emailHealthFingerprint(before),
    afterFingerprint: confirmation ? emailHealthFingerprint(confirmation.catalog) : null,
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
