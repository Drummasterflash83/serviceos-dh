/** Pinned additive connection release for the named TEST project only. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  readConnectionSetupCatalog,
  CONNECTION_TABLES,
  CONNECTION_FUNCTIONS,
} from "./learn-commusoft-setup-catalog.mjs";
import {
  installedOperatorInputs,
  operatorInputFingerprint,
} from "./learn-test-operator-inputs-release.mjs";
import { compactImportTable } from "./learn-test-import-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export const CONNECTION_RELEASE = "learn_commusoft_connection_v1";
export const CONNECTION_SHA = "15c41fa4166c4584e768d922ed8d4a2e10a103fd2ecd003074e33cc75597437c";
const hashes = {
  manifest: "de2f467c586e1de944a40890e416ae5b0cc4c4241bd158679d4566f573f7ff15",
  prerequisites: "3635d84a07c1322503f20f1b16b11408740f279199167b13b211deac405f9b2e",
  expected: "f6fb6a0673c6be462a227867abdc88940fb0ec6bf3e972e1aec4819fd4fca668",
};
const marker = "learn-test-commusoft-connection/1";
function checked(name, hash) {
  const bytes = readFileSync(
    new URL("../../supabase/release/learn-test/028_commusoft_connection." + name, import.meta.url),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== hash)
    throw Error("Reviewed connection release package differs");
  return bytes.toString();
}
export const connectionPrior = () =>
  JSON.parse(checked("prerequisites.json", hashes.prerequisites));
export const connectionExpected = () => JSON.parse(checked("expected.json", hashes.expected));
export const connectionFingerprint = (c) =>
  digest({
    prior: operatorInputFingerprint(c),
    functions: c.connectionFunctions,
    grants: c.connectionGrants,
    vault: c.connectionVault,
  });
export function connectionPrerequisites(c) {
  const prior = connectionPrior();
  return (
    installedOperatorInputs(c) &&
    !c.tables.some((t) => CONNECTION_TABLES.includes(t.name)) &&
    digest(c.connectionFunctions) === digest(prior.functions) &&
    digest(c.connectionGrants) === digest(prior.grants) &&
    digest(c.connectionVault) === digest(prior.vault)
  );
}
export function withoutConnectionSetup(c) {
  const prior = structuredClone(c);
  prior.connectionFunctions = prior.connectionFunctions.filter(
    (f) => !CONNECTION_FUNCTIONS.includes(f.name),
  );
  prior.connectionGrants = prior.connectionGrants.filter(
    (g) => !CONNECTION_TABLES.includes(g.table),
  );
  prior.tables = prior.tables.filter((t) => !CONNECTION_TABLES.includes(t.name));
  prior.base.inventory.tables = prior.base.inventory.tables.filter(
    (t) => t.schema !== "public" || !CONNECTION_TABLES.includes(t.name),
  );
  prior.base.inventory.functions = prior.base.inventory.functions.filter(
    (f) => !CONNECTION_FUNCTIONS.includes(f.name),
  );
  for (const report of [prior.readiness, prior.base.report])
    report.customMigrationEntries = report.customMigrationEntries.filter(
      (r) => r.migration_name !== CONNECTION_RELEASE,
    );
  prior.readinessCatalogSha256 = catalogFingerprint(prior.base);
  return prior;
}
export function installedConnectionSetup(c) {
  const e = connectionExpected(),
    entries = c.readiness?.customMigrationEntries;
  const validReceipt = (rows) =>
    Array.isArray(rows) &&
    rows.length === 29 &&
    rows.filter(
      (r) =>
        r.migration_name === CONNECTION_RELEASE &&
        r.source_sha256 === CONNECTION_SHA &&
        r.project_ref === TEST_PROJECT,
    ).length === 1;
  if (
    !validReceipt(entries) ||
    !validReceipt(c.base?.report?.customMigrationEntries) ||
    digest(c.connectionFunctions.filter((f) => CONNECTION_FUNCTIONS.includes(f.name))) !==
      digest(e.functions) ||
    digest(c.tables.filter((t) => CONNECTION_TABLES.includes(t.name))) !== digest(e.tables) ||
    digest(c.connectionGrants.filter((g) => CONNECTION_TABLES.includes(g.table))) !==
      digest(e.grants) ||
    digest(c.connectionVault) !== digest(e.vault)
  )
    return false;
  const compact = e.functions.map(
    ({ name, arguments: args, securityDefiner, authenticatedExecute, anonExecute }) => ({
      name,
      arguments: args,
      securityDefiner,
      authenticatedExecute,
      anonExecute,
    }),
  );
  if (
    digest(c.base.inventory.functions.filter((f) => CONNECTION_FUNCTIONS.includes(f.name))) !==
      digest(compact) ||
    digest(
      c.base.inventory.tables.filter(
        (t) => t.schema === "public" && CONNECTION_TABLES.includes(t.name),
      ),
    ) !== digest(e.tables.map(compactImportTable))
  )
    return false;
  return connectionPrerequisites(withoutConnectionSetup(c));
}
export function connectionSql(rehearse) {
  connectionExpected();
  const manifest = JSON.parse(checked("manifest.json", hashes.manifest));
  for (const source of manifest.sources)
    if (
      createHash("sha256")
        .update(readFileSync(new URL("../../" + source.path, import.meta.url)))
        .digest("hex") !== source.sha256
    )
      throw Error("Connection source changed since packaging");
  let sql = checked("sql", CONNECTION_SHA);
  if (sql.split("\nbegin;\n").length !== 2 || sql.split("\ncommit;\n").length !== 2)
    throw Error("Connection release transaction framing differs");
  sql = sql.replace(
    "\nbegin;\n",
    `\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${CONNECTION_SHA}';\n`,
  );
  if (rehearse) sql = sql.replace("\ncommit;\n", "\nrollback;\n");
  return (
    sql +
    `select '${marker}' as marker,${rehearse ? "not " : ""}exists(select 1 from of_test_deploy.migrations where migration_name='${CONNECTION_RELEASE}' and source_sha256='${CONNECTION_SHA}') as receipt_expected;`
  );
}
export async function releaseConnectionSetup({
  allowProjectRef,
  token,
  rehearse,
  rehearsal,
  fetcher = fetch,
  clock = Date.now,
  beforeWrite = async () => {},
}) {
  if (allowProjectRef !== TEST_PROJECT) throw Error("Explicit TEST connection target required");
  const args = { allowProjectRef, token, fetcher },
    before = await readConnectionSetupCatalog(args);
  if (installedConnectionSetup(before))
    return { state: "already_installed", writeAttempted: false };
  if (!connectionPrerequisites(before))
    throw Error("Exact prior operator/Vault contract and absent connection objects required");
  if (!rehearse) {
    const at = Date.parse(rehearsal?.observedAt),
      now = clock();
    if (
      rehearsal?.version !== marker ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.sourceSha256 !== CONNECTION_SHA ||
      rehearsal.state !== "rehearsed_and_rolled_back" ||
      rehearsal.acknowledged !== true ||
      rehearsal.beforeFingerprint !== rehearsal.afterFingerprint ||
      rehearsal.afterFingerprint !== connectionFingerprint(before) ||
      !Number.isFinite(at) ||
      !Number.isFinite(now) ||
      at > now ||
      now - at > 3600000
    )
      throw Error("Fresh matching connection rollback rehearsal required");
  }
  // Persist the exact pre-write evidence before the only mutation attempt.
  const sql = connectionSql(rehearse);
  await beforeWrite(before);
  let acknowledged = false;
  try {
    const r = await communicationQuery(token, sql, {
      fetcher,
      readOnly: false,
    });
    acknowledged = r?.length === 1 && r[0].marker === marker && r[0].receipt_expected === true;
  } catch {
    /* inspect; never resubmit */
  }
  let after = null;
  try {
    after = await readConnectionSetupCatalog(args);
  } catch {}
  const verified =
    after &&
    (rehearse
      ? connectionPrerequisites(after) &&
        connectionFingerprint(after) === connectionFingerprint(before)
      : installedConnectionSetup(after) &&
        connectionFingerprint(withoutConnectionSetup(after)) === connectionFingerprint(before));
  return {
    version: marker,
    projectRef: TEST_PROJECT,
    sourceSha256: CONNECTION_SHA,
    observedAt: new Date(clock()).toISOString(),
    writeAttempted: true,
    acknowledged,
    state:
      acknowledged && verified
        ? rehearse
          ? "rehearsed_and_rolled_back"
          : "installed_needs_authenticated_acceptance"
        : "requires_inspection",
    beforeFingerprint: connectionFingerprint(before),
    afterFingerprint: after ? connectionFingerprint(after) : null,
    scope:
      "Additive connection setup/verification and missing name/store broker helpers. No credentials, connection changes, flags, grants to operators, imports, endpoints, schedules or production changes.",
  };
}
