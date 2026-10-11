/** TEST working-time collector. No capture, processing or identity activation. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  WORKING_RELEASE_CATALOG,
  WORKING_RELEASE_SNAPSHOT,
  WORKING_RELEASE_PRESERVED,
  readWorkingReleaseCatalog,
  WORKING_RELEASE_SOURCES,
  WORKING_RELEASE_FUNCTIONS,
  WORKING_RELEASE_TABLES,
} from "./learn-working-release-catalog.mjs";
export const WORKING_RELEASE_SHA =
  "7c739f7100e93669b029974e8fff94bea7e3f1fbe3c730e1ab3032b9c5bd7d83";
const prefix = "supabase/release/learn-test/050_working_time";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const paths = WORKING_RELEASE_SOURCES;
const assertionPath = "scripts/verify/learn-working-release-hosted.assert.sql";
const sorted = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
function sources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== WORKING_RELEASE_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !WORKING_RELEASE_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation evidence required");
  return sorted(rows);
}
export function stableWorkingCatalogSQL(catalog) {
  return `(with catalog_snapshot as materialized (select ${catalog} c) select jsonb_build_object('base',jsonb_set(jsonb_set(c->'base','{functions}',
  (select jsonb_agg(case when f->>'signature' like 'learn_work_collection_begin(%' or f->>'signature' like 'learn_work_collection_step(%' or f->>'signature' like 'learn_work_collection_abandon(%' or f->>'signature' like 'learn_work_collection_evidence(%' then f-'definition' else f end order by f->>'signature') from jsonb_array_elements(c#>'{base,functions}') f)),
  '{tables}',(select jsonb_agg(jsonb_set(jsonb_set(t,'{constraints}',(select jsonb_agg(x order by x->>'name') from jsonb_array_elements(t->'constraints') x where x->>'name' not in ('learn_work_collection_runs_kind_check','learn_work_collection_run_tenant','learn_work_collection_items_result_check','learn_work_collection_item_scope'))),
  '{indexes}',(select jsonb_agg(x order by x) from jsonb_array_elements(t->'indexes') x where x#>>'{}' not like 'CREATE UNIQUE INDEX learn_work_collection_run_tenant ON %' and x#>>'{}' not like 'CREATE UNIQUE INDEX learn_work_collection_item_scope ON %')) order by ord) from jsonb_array_elements(c#>'{base,tables}') with ordinality a(t,ord))),
  'dependencies',(select jsonb_agg(case when d->>'signature'='learn_scorecard_save_draft(uuid,integer,jsonb,text)' then d-'definition' else d end order by d->>'signature') from jsonb_array_elements(c->'dependencies') d)) from catalog_snapshot)`;
}
export function prepareWorkingReleasePackage() {
  const prior = JSON.parse(readFileSync(".verification-results/working-release-prior.json"));
  if (
    prior.catalog.functions.length !== 0 ||
    prior.catalog.tables.length !== 7 ||
    prior.catalog.tables.some(Boolean) ||
    prior.catalog.dependencies.length !== 3 ||
    prior.catalog.base.functions.length !== 12 ||
    prior.catalog.base.base.base.base.ledger.length !== 50 ||
    prior.catalog.base.base.base.base.ledger.some((r) => r.project !== TEST_PROJECT) ||
    prior.baseFingerprint !== "dcbd094e77774e5f068bd5ea5162f89b" ||
    prior.fingerprint !== "6553cd24dc17cb3a61f808f7bb620b9b"
  )
    throw Error("Exact Working-time prerequisites required");
  sources(prior.preserved);
  const inputs = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const assertion = readFileSync(assertionPath, "utf8");
  const bodies = inputs.map((s) =>
    s.source.replace("\nbegin;\n", "\n").replace("\ncommit;\n", "\n"),
  );
  const oldDraft = prior.catalog.dependencies.find(
    (d) => d.signature === "learn_scorecard_save_draft(uuid,integer,jsonb,text)",
  )?.definition;
  const anchor = "    v_keys := array_append(v_keys,m->>'key');";
  if (
    typeof oldDraft !== "string" ||
    oldDraft.split(anchor).length !== 2 ||
    oldDraft.includes("$expected_draft$")
  )
    throw Error("Unexpected existing scoring-rule contract");
  const expectedDraft = oldDraft.replace(
    anchor,
    "    perform learn_working_rule_states(m,v_kind);\n" + anchor,
  );
  const stable = stableWorkingCatalogSQL(WORKING_RELEASE_CATALOG);
  const sql =
    `-- TEST-only working-time collector; no activation, user-access grants or source imports.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((${WORKING_RELEASE_CATALOG})::text) <> '${prior.fingerprint}' then raise exception 'Exact Working-time prerequisites required';end if;
 if exists(select 1 from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then raise exception 'Idle TEST Commusoft required';end if;
end $$;
create temporary table serviceos_working_time_preserved on commit drop as ${WORKING_RELEASE_SNAPSHOT};
create temporary table serviceos_working_time_permissions on commit drop as select ${stable} as previous_catalog;
${bodies.join("\n")}
savepoint working_time_probe;
${assertion}
rollback to savepoint working_time_probe;
release savepoint working_time_probe;
do $$begin
 if (select previous_catalog from serviceos_working_time_permissions) is distinct from (${stable}) then raise exception 'Existing catalog or authority changed';end if;
 if pg_get_functiondef('public.learn_scorecard_save_draft(uuid,integer,jsonb,text)'::regprocedure) is distinct from $expected_draft$${expectedDraft}$expected_draft$ then raise exception 'Saved scoring-rule definition differs';end if;
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_working_time_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${WORKING_RELEASE_SNAPSHOT})x) then raise exception 'Retained sources changed during working-time release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_working_time_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-working-release/1' as marker,${WORKING_RELEASE_CATALOG} as catalog,md5((${WORKING_RELEASE_CATALOG})::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_working_time_preserved x) as preserved;
commit;
`.replace(/[ \t]+$/gm, "");
  const manifest = {
    version: "learn-working-release-package/1",
    projectRef: TEST_PROJECT,
    sha256: hash(sql),
    priorFingerprint: prior.fingerprint,
    sources: inputs.map((s) => ({ path: s.path, sha256: hash(s.source) })),
    assertion: { path: assertionPath, sha256: hash(assertion) },
    preservedDataSets: prior.preserved.length,
  };
  writeFileSync(prefix + ".sql", sql);
  writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(prefix + ".prerequisites.json", JSON.stringify(prior, null, 2) + "\n");
  return {
    sha256: manifest.sha256,
    priorFingerprint: prior.fingerprint,
    preservedDataSets: prior.preserved.length,
  };
}
export function workingReleasePackage() {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    hash(sql) !== WORKING_RELEASE_SHA ||
    manifest.sha256 !== WORKING_RELEASE_SHA ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.sources.length !== paths.length ||
    manifest.assertion?.path !== assertionPath ||
    hash(readFileSync(assertionPath)) !== manifest.assertion.sha256 ||
    manifest.sources.some((s, i) => s.path !== paths[i] || hash(readFileSync(s.path)) !== s.sha256)
  )
    throw Error("Pinned working-time package changed");
  return { sql, manifest };
}
export async function releaseWorkingRelease({
  mode,
  allowProjectRef,
  token,
  persistJournal,
  query = communicationQuery,
  catalog = readWorkingReleaseCatalog,
  rehearsal,
}) {
  if (
    !["rehearse", "apply"].includes(mode) ||
    allowProjectRef !== TEST_PROJECT ||
    typeof persistJournal !== "function" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token ?? "")
  )
    throw Error("Explicit TEST operation and durable journal required");
  const { sql, manifest } = workingReleasePackage();
  if (
    mode === "apply" &&
    (rehearsal?.state !== "rehearsed_rolled_back" ||
      rehearsal.sourceSha256 !== WORKING_RELEASE_SHA ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.priorFingerprint !== manifest.priorFingerprint ||
      !Number.isFinite(Date.parse(rehearsal.observedAt)) ||
      Date.now() - Date.parse(rehearsal.observedAt) < 0 ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000 ||
      !/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint ?? ""))
  )
    throw Error("Exact successful rehearsal required");
  const [before, rows] = await Promise.all([
      catalog(token),
      query(token, WORKING_RELEASE_SNAPSHOT),
    ]),
    preserved = sources(rows);
  if (before.fingerprint !== manifest.priorFingerprint) throw Error("TEST prerequisites changed");
  const journal = {
    version: "learn-working-release/1",
    projectRef: TEST_PROJECT,
    mode,
    sourceSha256: WORKING_RELEASE_SHA,
    priorFingerprint: before.fingerprint,
    expectedFingerprint: rehearsal?.expectedFingerprint ?? null,
    preserved,
    observedAt: new Date().toISOString(),
  };
  await persistJournal(journal);
  let receipt = null,
    submissionFailure = null;
  try {
    const result = await query(
      token,
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${WORKING_RELEASE_SHA}';\n` +
        (mode === "rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      { readOnly: false },
    );
    if (result.length === 1 && result[0].marker === "learn-working-release/1") receipt = result[0];
  } catch (error) {
    /* Never resubmit an uncertain transaction. */
    submissionFailure =
      error?.name === "TimeoutError" ? "request_timeout" : "submission_unconfirmed";
  }
  const [after, afterRows] = await Promise.all([
    catalog(token),
    query(token, WORKING_RELEASE_SNAPSHOT),
  ]);
  const unchanged = JSON.stringify(preserved) === JSON.stringify(sources(afterRows));
  const expected = mode === "rehearse" ? receipt?.fingerprint : rehearsal.expectedFingerprint;
  const validReceipt =
    /^[a-f0-9]{32}$/.test(receipt?.fingerprint ?? "") &&
    receipt?.catalog?.functions?.length === WORKING_RELEASE_FUNCTIONS.length &&
    receipt?.catalog?.tables?.length === WORKING_RELEASE_TABLES.length &&
    receipt.catalog.tables.every((t, i) => t?.name === WORKING_RELEASE_TABLES[i]) &&
    receipt?.catalog?.base?.base?.base?.base?.ledger?.length === 51 &&
    receipt.catalog.base.base.base.base.ledger.every((r) => r.project === TEST_PROJECT) &&
    receipt.catalog.base.base.base.base.ledger.filter(
      (r) => r.name === "learn_working_time_v1" && r.sha256 === WORKING_RELEASE_SHA,
    ).length === 1 &&
    Array.isArray(receipt?.preserved) &&
    JSON.stringify(preserved) === JSON.stringify(sorted(receipt.preserved));
  const state =
    unchanged &&
    (mode === "rehearse"
      ? validReceipt && after.fingerprint === before.fingerprint
      : after.fingerprint === expected)
      ? mode === "rehearse"
        ? "rehearsed_rolled_back"
        : "installed_needs_hosted_acceptance"
      : "requires_inspection";
  return {
    version: journal.version,
    projectRef: TEST_PROJECT,
    sourceSha256: WORKING_RELEASE_SHA,
    mode,
    state,
    observedAt: new Date().toISOString(),
    priorFingerprint: before.fingerprint,
    expectedFingerprint: expected,
    afterFingerprint: after.fingerprint,
    preservedDataSets: unchanged ? preserved.length : null,
    submissionFailure,
    receipt: receipt
      ? {
          fingerprint: receipt.fingerprint,
          functions: receipt.catalog?.functions?.length,
        }
      : null,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") === "--prepare")
      console.log(JSON.stringify(prepareWorkingReleasePackage(), null, 2));
    else {
      const mode = process.argv[2]?.slice(2);
      if (
        process.argv.length !== 4 ||
        process.argv[3] !== "--existing-cli-login" ||
        process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
      )
        throw Error("Explicit TEST operation required");
      const stem = ".verification-results/working-release-" + mode;
      const result = await releaseWorkingRelease({
        mode,
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        rehearsal:
          mode === "apply"
            ? JSON.parse(readFileSync(".verification-results/working-release-rehearse-result.json"))
            : undefined,
        persistJournal: async (journal) => {
          const fd = openSync(stem + "-journal.json", "wx", 0o600);
          try {
            writeSync(fd, JSON.stringify(journal, null, 2));
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        },
      });
      writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
      console.log(JSON.stringify(result, null, 2));
      if (result.state === "requires_inspection") process.exitCode = 1;
    }
  } catch {
    console.error(
      "Working-time release unconfirmed; inspect retained journal and schema before any further attempt.",
    );
    process.exitCode = 1;
  }
}
