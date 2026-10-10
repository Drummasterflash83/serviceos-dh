/** Pinned TEST continuation release. Unknown outcomes require read-only confirmation. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readResumeCatalog, RESUME_FUNCTIONS } from "./learn-commusoft-resume-catalog.mjs";
import { CONTACT_BASE_TABLES } from "./learn-commusoft-contacts-catalog.mjs";
import {
  installedContacts,
  contactFingerprint,
  CONTACT_SNAPSHOT_QUERY as RESUME_SNAPSHOT_QUERY,
  normalizedContactSources as normalizedResumeSources,
} from "./learn-test-commusoft-contacts-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export const RESUME_RELEASE = "learn_commusoft_resume_v1";
export const RESUME_SHA = "b9a7ec6cb4a8d26a1e89c5bfbca5b13259cf5824eddf3313f3cd99e0ecbefd51";
const marker = "learn-test-commusoft-resume/1";
const hashes = {
  manifest: "eaab8d0a5e7089b767a76b2432a1ba915417e8583273335de5685d5f39dc9801",
  expected: "9aea3d9d78f955e4757f1bb042aa64945da0b73cc6767cb9d7811c3a0cf7a1a2",
  prerequisites: "34ef4baa3ff42cce9edea9c33543a35edb8c9df6e88b81cd0aa1b9cf33e12f4f",
};
function checked(ext, sha) {
  const raw = readFileSync(
    new URL("../../supabase/release/learn-test/030_commusoft_resume." + ext, import.meta.url),
  );
  if (createHash("sha256").update(raw).digest("hex") !== sha)
    throw Error("Reviewed continuation package differs");
  return raw.toString();
}
export const resumePrior = () => JSON.parse(checked("prerequisites.json", hashes.prerequisites));
export const resumeExpected = () => JSON.parse(checked("expected.json", hashes.expected));
export const resumeFingerprint = (c) =>
  digest({ prior: contactFingerprint(c), functions: c.resumeFunctions });
export function resumePrerequisites(c) {
  const p = resumePrior();
  return (
    installedContacts(c) &&
    digest(c.resumeFunctions) === digest(p.functions) &&
    digest(c.contactFunctions) === digest(p.functions) &&
    digest(c.contactGrants) === digest(p.grants) &&
    digest(c.tables.filter((t) => CONTACT_BASE_TABLES.includes(t.name))) === digest(p.tables)
  );
}
const compact = (f) => ({
  name: f.name,
  arguments: f.arguments,
  securityDefiner: f.securityDefiner,
  authenticatedExecute: f.authenticatedExecute,
  anonExecute: f.anonExecute,
});
export function withoutResume(c) {
  const out = structuredClone(c);
  out.resumeFunctions = out.resumeFunctions.filter((f) => !RESUME_FUNCTIONS.includes(f.name));
  out.base.inventory.functions = out.base.inventory.functions.filter(
    (f) => !RESUME_FUNCTIONS.includes(f.name),
  );
  for (const r of [out.readiness, out.base.report])
    r.customMigrationEntries = r.customMigrationEntries.filter(
      (e) => e.migration_name !== RESUME_RELEASE,
    );
  out.readinessCatalogSha256 = catalogFingerprint(out.base);
  return out;
}
export function installedResume(c) {
  const expected = resumeExpected();
  const receipt = (rows) =>
    Array.isArray(rows) &&
    rows.length === 31 &&
    rows.filter(
      (r) =>
        r.migration_name === RESUME_RELEASE &&
        r.source_sha256 === RESUME_SHA &&
        r.project_ref === TEST_PROJECT,
    ).length === 1;
  if (
    !receipt(c.readiness?.customMigrationEntries) ||
    !receipt(c.base?.report?.customMigrationEntries) ||
    !Array.isArray(c.resumeFunctions) ||
    digest(c.resumeFunctions.filter((f) => RESUME_FUNCTIONS.includes(f.name))) !==
      digest(expected.functions) ||
    digest(c.base.inventory.functions.filter((f) => RESUME_FUNCTIONS.includes(f.name))) !==
      digest(expected.functions.map(compact))
  )
    return false;
  return resumePrerequisites(withoutResume(c));
}
export function resumeSql(rehearse) {
  resumeExpected();
  const m = JSON.parse(checked("manifest.json", hashes.manifest));
  if (m.sha256 !== RESUME_SHA) throw Error("Continuation checksum differs");
  for (const s of m.sources)
    if (
      createHash("sha256")
        .update(readFileSync(new URL("../../" + s.path, import.meta.url)))
        .digest("hex") !== s.sha256
    )
      throw Error("Continuation source changed since packaging");
  let sql = checked("sql", RESUME_SHA);
  if (sql.split("\nbegin;\n").length !== 2 || sql.split("\ncommit;\n").length !== 2)
    throw Error("Continuation transaction framing differs");
  sql = sql.replace(
    "\nbegin;\n",
    `\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${RESUME_SHA}';\n`,
  );
  if (rehearse) sql = sql.replace("\ncommit;\n", "\nrollback;\n");
  return (
    sql +
    `select '${marker}' as marker,${rehearse ? "not " : ""}exists(select 1 from of_test_deploy.migrations where migration_name='${RESUME_RELEASE}' and source_sha256='${RESUME_SHA}') as receipt_expected;`
  );
}
export async function confirmResume({ allowProjectRef, token, journal, fetcher = fetch }) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    journal?.version !== marker ||
    journal.projectRef !== TEST_PROJECT ||
    journal.sourceSha256 !== RESUME_SHA ||
    !["rehearse", "apply"].includes(journal.mode) ||
    !resumePrerequisites(journal.before)
  )
    throw Error("Matching TEST continuation journal required");
  const after = await readResumeCatalog({ allowProjectRef, token, fetcher });
  const sources = normalizedResumeSources(
    await communicationQuery(token, RESUME_SNAPSHOT_QUERY, { fetcher }),
  );
  const installed = installedResume(after),
    prior = resumePrerequisites(after);
  const priorCatalogPreserved =
    resumeFingerprint(installed ? withoutResume(after) : after) ===
    resumeFingerprint(journal.before);
  const sourcePreserved = digest(sources) === digest(normalizedResumeSources(journal.sourceBefore));
  return {
    catalog: after,
    report: {
      version: marker,
      projectRef: TEST_PROJECT,
      sourceSha256: RESUME_SHA,
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
export async function releaseResume({
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
    throw Error("Explicit TEST continuation operation and durable journal required");
  const args = { allowProjectRef, token, fetcher },
    before = await readResumeCatalog(args);
  if (installedResume(before)) return { state: "already_installed", writeAttempted: false };
  if (!resumePrerequisites(before))
    throw Error("Exact continuation dependencies and current verification runtime required");
  if (!rehearse) {
    const at = Date.parse(rehearsal?.observedAt),
      now = clock();
    if (
      rehearsal?.version !== marker ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.sourceSha256 !== RESUME_SHA ||
      rehearsal.state !== "rehearsed_and_rolled_back" ||
      rehearsal.acknowledged !== true ||
      rehearsal.preExistingSourcesPreserved !== true ||
      rehearsal.beforeFingerprint !== rehearsal.afterFingerprint ||
      rehearsal.afterFingerprint !== resumeFingerprint(before) ||
      !Number.isFinite(at) ||
      !Number.isFinite(now) ||
      at > now ||
      now - at > 3600000
    )
      throw Error("Fresh preserving continuation rehearsal required");
  }
  const sql = resumeSql(rehearse),
    sourceBefore = normalizedResumeSources(
      await communicationQuery(token, RESUME_SNAPSHOT_QUERY, { fetcher }),
    );
  const journal = {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: RESUME_SHA,
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
    confirmation = await confirmResume({ ...args, journal });
  } catch {}
  const report = confirmation?.report;
  return {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: RESUME_SHA,
    observedAt: new Date(clock()).toISOString(),
    writeAttempted: true,
    acknowledged,
    beforeFingerprint: resumeFingerprint(before),
    afterFingerprint: confirmation ? resumeFingerprint(confirmation.catalog) : null,
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
