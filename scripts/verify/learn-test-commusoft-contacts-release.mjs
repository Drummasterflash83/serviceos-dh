/** Pinned TEST-only contacts release. Unknown outcomes are inspected, never resubmitted. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  readContactCatalog,
  CONTACT_FUNCTIONS,
  CONTACT_CHANGED_FUNCTIONS,
  CONTACT_BASE_TABLES,
} from "./learn-commusoft-contacts-catalog.mjs";
import { installedVerificationRuntime } from "./learn-test-commusoft-verification-runtime.mjs";
import { connectionFingerprint } from "./learn-test-commusoft-setup-release.mjs";
import { CONNECTION_PRESERVED_TABLES } from "./learn-test-commusoft-setup-hosted.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export const CONTACT_RELEASE = "learn_commusoft_contacts_v1";
export const CONTACT_SHA = "ad004229c9947b805c30b3985dbcd620c3dc6c5334dd04b9e66eee9b802fe265";
const marker = "learn-test-commusoft-contacts/1";
const hashes = {
  manifest: "e64e300feb0c760ea2e0ba75ae674962e0a061cde75399ebd3f7476863cd4a2e",
  expected: "b0b6a911ddfc1c022efc6ede7983a790e99b78a2264ef533c59d1c4d6d3b6f6b",
  prerequisites: "47a57cd0bc9119a018a6f2c96d3b4caa2aef5c4c5244c47211b0d4f4fb8af5c2",
};
function checked(ext, sha) {
  const raw = readFileSync(
    new URL("../../supabase/release/learn-test/029_commusoft_contacts." + ext, import.meta.url),
  );
  if (createHash("sha256").update(raw).digest("hex") !== sha)
    throw Error("Reviewed contacts package differs");
  return raw.toString();
}
export const contactPrior = () => JSON.parse(checked("prerequisites.json", hashes.prerequisites));
export const contactExpected = () => JSON.parse(checked("expected.json", hashes.expected));
export const contactFingerprint = (c) =>
  digest({
    prior: connectionFingerprint(c),
    functions: c.contactFunctions,
    grants: c.contactGrants,
    tables: c.tables.filter((t) => CONTACT_BASE_TABLES.includes(t.name)),
  });
export function contactPrerequisites(c) {
  const p = contactPrior();
  return (
    installedVerificationRuntime(c) &&
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
export function withoutContacts(c) {
  const prior = contactPrior(),
    out = structuredClone(c),
    old = new Map(
      prior.functions
        .filter((f) => CONTACT_CHANGED_FUNCTIONS.includes(f.name))
        .map((f) => [f.name, f]),
    );
  for (const key of [
    "contactFunctions",
    "commusoftFunctions",
    "connectionFunctions",
    "operatorInputFunctions",
  ])
    if (Array.isArray(out[key]))
      out[key] = out[key]
        .filter((f) => !CONTACT_FUNCTIONS.includes(f.name))
        .map((f) => old.get(f.name) ?? f);
  out.base.inventory.functions = out.base.inventory.functions
    .filter((f) => !CONTACT_FUNCTIONS.includes(f.name))
    .map((f) => (old.has(f.name) ? compact(old.get(f.name)) : f));
  for (const report of [out.readiness, out.base.report])
    report.customMigrationEntries = report.customMigrationEntries.filter(
      (r) => r.migration_name !== CONTACT_RELEASE,
    );
  out.readinessCatalogSha256 = catalogFingerprint(out.base);
  return out;
}
export function installedContacts(c) {
  const expected = contactExpected(),
    changed = [...CONTACT_FUNCTIONS, ...CONTACT_CHANGED_FUNCTIONS];
  const receipt = (rows) =>
    Array.isArray(rows) &&
    rows.length === 30 &&
    rows.filter(
      (r) =>
        r.migration_name === CONTACT_RELEASE &&
        r.source_sha256 === CONTACT_SHA &&
        r.project_ref === TEST_PROJECT,
    ).length === 1;
  if (
    !receipt(c.readiness?.customMigrationEntries) ||
    !receipt(c.base?.report?.customMigrationEntries) ||
    digest(c.contactFunctions.filter((f) => changed.includes(f.name))) !==
      digest(expected.functions)
  )
    return false;
  for (const name of CONTACT_CHANGED_FUNCTIONS) {
    const e = expected.functions.find((f) => f.name === name);
    if (digest(c.commusoftFunctions.filter((f) => f.name === name)) !== digest([e])) return false;
  }
  if (
    digest(c.base.inventory.functions.filter((f) => changed.includes(f.name))) !==
    digest(expected.functions.map(compact))
  )
    return false;
  return contactPrerequisites(withoutContacts(c));
}
export const CONTACT_PRESERVED_TABLES = [
  ...new Set([...CONNECTION_PRESERVED_TABLES, ...CONTACT_BASE_TABLES.map((n) => "public." + n)]),
];
export const CONTACT_SNAPSHOT_QUERY = CONTACT_PRESERVED_TABLES.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export function normalizedContactSources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== CONTACT_PRESERVED_TABLES.length ||
    new Set(rows.map((r) => r.name)).size !== CONTACT_PRESERVED_TABLES.length ||
    rows.some(
      (r) =>
        !CONTACT_PRESERVED_TABLES.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete contact source snapshot required");
  return rows
    .map(({ name, count, fingerprint }) => ({ name, count, fingerprint }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function contactSql(rehearse) {
  contactExpected();
  const m = JSON.parse(checked("manifest.json", hashes.manifest));
  if (m.sha256 !== CONTACT_SHA) throw Error("Contact checksum differs");
  for (const s of m.sources)
    if (
      createHash("sha256")
        .update(readFileSync(new URL("../../" + s.path, import.meta.url)))
        .digest("hex") !== s.sha256
    )
      throw Error("Contact source changed since packaging");
  let sql = checked("sql", CONTACT_SHA);
  if (sql.split("\nbegin;\n").length !== 2 || sql.split("\ncommit;\n").length !== 2)
    throw Error("Contact transaction framing differs");
  sql = sql.replace(
    "\nbegin;\n",
    `\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${CONTACT_SHA}';\n`,
  );
  if (rehearse) sql = sql.replace("\ncommit;\n", "\nrollback;\n");
  return (
    sql +
    `select '${marker}' as marker,${rehearse ? "not " : ""}exists(select 1 from of_test_deploy.migrations where migration_name='${CONTACT_RELEASE}' and source_sha256='${CONTACT_SHA}') as receipt_expected;`
  );
}
export async function confirmContacts({ allowProjectRef, token, journal, fetcher = fetch }) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    journal?.version !== marker ||
    journal.projectRef !== TEST_PROJECT ||
    journal.sourceSha256 !== CONTACT_SHA ||
    !["rehearse", "apply"].includes(journal.mode) ||
    !contactPrerequisites(journal.before)
  )
    throw Error("Matching TEST contact journal required");
  const after = await readContactCatalog({ allowProjectRef, token, fetcher });
  const sources = normalizedContactSources(
    await communicationQuery(token, CONTACT_SNAPSHOT_QUERY, { fetcher }),
  );
  const installed = installedContacts(after),
    prior = contactPrerequisites(after);
  const priorCatalogPreserved =
    contactFingerprint(installed ? withoutContacts(after) : after) ===
    contactFingerprint(journal.before);
  const sourcePreserved =
    digest(sources) === digest(normalizedContactSources(journal.sourceBefore));
  return {
    catalog: after,
    report: {
      version: marker,
      projectRef: TEST_PROJECT,
      sourceSha256: CONTACT_SHA,
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
export async function releaseContacts({
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
    throw Error("Explicit TEST contact operation and durable journal required");
  const args = { allowProjectRef, token, fetcher },
    before = await readContactCatalog(args);
  if (installedContacts(before)) return { state: "already_installed", writeAttempted: false };
  if (!contactPrerequisites(before))
    throw Error("Exact contact dependencies and current verification runtime required");
  if (!rehearse) {
    const at = Date.parse(rehearsal?.observedAt),
      now = clock();
    if (
      rehearsal?.version !== marker ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.sourceSha256 !== CONTACT_SHA ||
      rehearsal.state !== "rehearsed_and_rolled_back" ||
      rehearsal.acknowledged !== true ||
      rehearsal.preExistingSourcesPreserved !== true ||
      rehearsal.beforeFingerprint !== rehearsal.afterFingerprint ||
      rehearsal.afterFingerprint !== contactFingerprint(before) ||
      !Number.isFinite(at) ||
      !Number.isFinite(now) ||
      at > now ||
      now - at > 3600000
    )
      throw Error("Fresh preserving contact rehearsal required");
  }
  const sql = contactSql(rehearse),
    sourceBefore = normalizedContactSources(
      await communicationQuery(token, CONTACT_SNAPSHOT_QUERY, { fetcher }),
    );
  const journal = {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: CONTACT_SHA,
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
    confirmation = await confirmContacts({ ...args, journal });
  } catch {}
  const report = confirmation?.report;
  return {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: CONTACT_SHA,
    observedAt: new Date(clock()).toISOString(),
    writeAttempted: true,
    acknowledged,
    beforeFingerprint: contactFingerprint(before),
    afterFingerprint: confirmation ? contactFingerprint(confirmation.catalog) : null,
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
