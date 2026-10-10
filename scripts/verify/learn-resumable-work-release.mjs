/** TEST resumable workload collector. No capture, processing or identity activation. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  RESUMABLE_WORK_CATALOG,
  RESUMABLE_WORK_SNAPSHOT,
  RESUMABLE_WORK_PRESERVED,
  readResumableWorkCatalog,
} from "./learn-resumable-work-catalog.mjs";
export const RESUMABLE_WORK_SHA =
  "c02b8b9e3245d19216601bd45b66251d407828305c095e1dd850fdcc01addd03";
const prefix = "supabase/release/learn-test/049_resumable_work";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const paths = ["supabase/migrations/20261101090000_learn_resumable_work_collection.sql"];
const assertionPath = "scripts/verify/learn-resumable-work-hosted.assert.sql";
const sorted = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
function sources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== RESUMABLE_WORK_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !RESUMABLE_WORK_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete preservation evidence required");
  return sorted(rows);
}
export function prepareResumableWorkPackage() {
  const prior = JSON.parse(readFileSync(".verification-results/resumable-work-prior.json"));
  if (
    prior.catalog.functions.length !== 0 ||
    prior.catalog.base.dependencies.length !== 16 ||
    prior.catalog.base.functions.length !== 1 ||
    prior.catalog.base.teamTable?.name !== "learn_team_work_measurement_runs" ||
    prior.catalog.tables.length !== 2 ||
    prior.catalog.tables.some(Boolean) ||
    prior.catalog.base.base.base.ledger.length !== 49 ||
    prior.catalog.base.base.base.ledger.some((r) => r.project !== TEST_PROJECT) ||
    prior.baseFingerprint !== "dc16429c4eabc555357af6ffedcc878f" ||
    !/^[a-f0-9]{32}$/.test(prior.fingerprint)
  )
    throw Error("Exact Resumable work prerequisites required");
  sources(prior.preserved);
  const inputs = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const assertion = readFileSync(assertionPath, "utf8");
  const bodies = inputs.map((s) =>
    s.source.replace("\nbegin;\n", "\n").replace("\ncommit;\n", "\n"),
  );
  const oldAppend = prior.catalog.base.dependencies.find(
    (d) => d.signature === "learn_performance_append(uuid,jsonb,text)",
  )?.definition;
  const oldList =
    "('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs','learn_team_work_measurement_runs')";
  const newList = oldList.slice(0, -1) + ",'learn_work_collection_runs')";
  const anchor =
    "if not exists_ref then raise exception 'Missing or foreign evidence' using errcode='22023'; end if;";
  const guard = `
  if ref->>'table'='learn_work_collection_runs' and not exists(select 1 from public.learn_work_collection_runs where tenant_id=p_tenant_id and id=(ref->>'id')::uuid and state='completed') then
   raise exception 'Incomplete collection cannot support an observation' using errcode='22023';end if;
`;
  if (
    typeof oldAppend !== "string" ||
    oldAppend.split(oldList).length !== 2 ||
    oldAppend.split(anchor).length !== 2 ||
    oldAppend.includes("$expected_append$")
  )
    throw Error("Unexpected existing append definition");
  const expectedAppend = oldAppend.replace(oldList, newList).replace(anchor, anchor + guard);
  const sql =
    `-- TEST-only resumable workload collector; no activation, user-access grants or source imports.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((${RESUMABLE_WORK_CATALOG})::text) <> '${prior.fingerprint}' then raise exception 'Exact Resumable work prerequisites required';end if;
 if exists(select 1 from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then raise exception 'Idle TEST Commusoft required';end if;
end $$;
create temporary table serviceos_resumable_work_preserved on commit drop as ${RESUMABLE_WORK_SNAPSHOT};
create temporary table serviceos_resumable_work_permissions on commit drop as select jsonb_set((${RESUMABLE_WORK_CATALOG})->'base','{dependencies}',
 (select jsonb_agg(case when d->>'signature'='learn_performance_append(uuid,jsonb,text)' then jsonb_set(d,'{definition}',to_jsonb($expected_append$${expectedAppend}$expected_append$::text)) else d end order by d->>'signature')
 from jsonb_array_elements((${RESUMABLE_WORK_CATALOG})->'base'->'dependencies') d)) as previous_catalog;
${bodies.join("\n")}
savepoint resumable_work_probe;
${assertion}
rollback to savepoint resumable_work_probe;
release savepoint resumable_work_probe;
do $$begin
 if (select previous_catalog from serviceos_resumable_work_permissions) is distinct from ((${RESUMABLE_WORK_CATALOG})->'base') then raise exception 'Existing catalog or authority changed';end if;
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_resumable_work_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${RESUMABLE_WORK_SNAPSHOT})x) then raise exception 'Retained sources changed during resumable work release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_resumable_work_collection_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-resumable-work/1' as marker,${RESUMABLE_WORK_CATALOG} as catalog,md5((${RESUMABLE_WORK_CATALOG})::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_resumable_work_preserved x) as preserved;
commit;
`.replace(/[ \t]+$/gm, "");
  const manifest = {
    version: "learn-resumable-work-package/1",
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
export function resumableWorkPackage() {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    hash(sql) !== RESUMABLE_WORK_SHA ||
    manifest.sha256 !== RESUMABLE_WORK_SHA ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.sources.length !== paths.length ||
    manifest.assertion?.path !== assertionPath ||
    hash(readFileSync(assertionPath)) !== manifest.assertion.sha256 ||
    manifest.sources.some((s, i) => s.path !== paths[i] || hash(readFileSync(s.path)) !== s.sha256)
  )
    throw Error("Pinned resumable work package changed");
  return { sql, manifest };
}
export async function releaseResumableWork({
  mode,
  allowProjectRef,
  token,
  persistJournal,
  query = communicationQuery,
  catalog = readResumableWorkCatalog,
  rehearsal,
}) {
  if (
    !["rehearse", "apply"].includes(mode) ||
    allowProjectRef !== TEST_PROJECT ||
    typeof persistJournal !== "function" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token ?? "")
  )
    throw Error("Explicit TEST operation and durable journal required");
  const { sql, manifest } = resumableWorkPackage();
  if (
    mode === "apply" &&
    (rehearsal?.state !== "rehearsed_rolled_back" ||
      rehearsal.sourceSha256 !== RESUMABLE_WORK_SHA ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.priorFingerprint !== manifest.priorFingerprint ||
      !Number.isFinite(Date.parse(rehearsal.observedAt)) ||
      Date.now() - Date.parse(rehearsal.observedAt) < 0 ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000 ||
      !/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint ?? ""))
  )
    throw Error("Exact successful rehearsal required");
  const [before, rows] = await Promise.all([catalog(token), query(token, RESUMABLE_WORK_SNAPSHOT)]),
    preserved = sources(rows);
  if (before.fingerprint !== manifest.priorFingerprint) throw Error("TEST prerequisites changed");
  const journal = {
    version: "learn-resumable-work/1",
    projectRef: TEST_PROJECT,
    mode,
    sourceSha256: RESUMABLE_WORK_SHA,
    priorFingerprint: before.fingerprint,
    expectedFingerprint: rehearsal?.expectedFingerprint ?? null,
    preserved,
    observedAt: new Date().toISOString(),
  };
  await persistJournal(journal);
  let receipt = null;
  try {
    const result = await query(
      token,
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${RESUMABLE_WORK_SHA}';\n` +
        (mode === "rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      { readOnly: false },
    );
    if (result.length === 1 && result[0].marker === "learn-resumable-work/1") receipt = result[0];
  } catch {
    /* Never resubmit an uncertain transaction. */
  }
  const [after, afterRows] = await Promise.all([
    catalog(token),
    query(token, RESUMABLE_WORK_SNAPSHOT),
  ]);
  const unchanged = JSON.stringify(preserved) === JSON.stringify(sources(afterRows));
  const expected = mode === "rehearse" ? receipt?.fingerprint : rehearsal.expectedFingerprint;
  const validReceipt =
    receipt?.catalog?.functions?.length === 12 &&
    receipt?.catalog?.tables?.length === 2 &&
    receipt.catalog.tables[0]?.name === "learn_work_collection_runs" &&
    receipt.catalog.tables[1]?.name === "learn_work_collection_items" &&
    receipt?.catalog?.base?.base?.base?.ledger?.length === 50 &&
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
    sourceSha256: RESUMABLE_WORK_SHA,
    mode,
    state,
    observedAt: new Date().toISOString(),
    priorFingerprint: before.fingerprint,
    expectedFingerprint: expected,
    afterFingerprint: after.fingerprint,
    preservedDataSets: unchanged ? preserved.length : null,
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
      console.log(JSON.stringify(prepareResumableWorkPackage(), null, 2));
    else {
      const mode = process.argv[2]?.slice(2);
      if (
        process.argv.length !== 4 ||
        process.argv[3] !== "--existing-cli-login" ||
        process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
      )
        throw Error("Explicit TEST operation required");
      const stem = ".verification-results/resumable-work-" + mode;
      const result = await releaseResumableWork({
        mode,
        allowProjectRef: TEST_PROJECT,
        token: savedCliToken(),
        rehearsal:
          mode === "apply"
            ? JSON.parse(readFileSync(".verification-results/resumable-work-rehearse-result.json"))
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
      "Resumable work release unconfirmed; inspect retained journal and schema before any further attempt.",
    );
    process.exitCode = 1;
  }
}
