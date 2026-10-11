/** Pinned TEST-only review-function update; no real-source publication or capture. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  PHONE_SAVED_RESULTS_CATALOG,
  readPhoneSavedResultsCatalog,
  phoneSavedResultsSourceQuery,
} from "./learn-phone-saved-results-catalog.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex"),
  quote = (s) => "'" + s.replaceAll("'", "''") + "'";
const sourcePath = "supabase/migrations/20261101250000_learn_commusoft_partial_job_times.sql";
const probePath = "scripts/verify/learn-commusoft-partial-times-hosted.assert.sql";
const sourceSha = "95ca7fd3ef48c2d76ed73998019018d6f429978077f48c00aa03a161a44ea60f";
const probeSha = "99d13a5151f95613fa4308c22f1befa1f9b5ad5b489f2dade2e9a73c9cdc274e";
const prefix = "supabase/release/learn-test/059_commusoft_partial_job_times";
const PACKAGE_SHA = "c5e3fbf27b6c5f07a7a96dc2693855e285c3679c8763c8c3eddc29f0959bfdac";
const fnCatalog = `(select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'acl',proacl::text,'owner',proowner) order by oid::regprocedure::text) from pg_proc where oid in ('public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text)'::regprocedure,'public.learn_business_input_time_detail(jsonb)'::regprocedure))`;
const ordered = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
function contents() {
  const source = readFileSync(sourcePath, "utf8"),
    probe = readFileSync(probePath, "utf8");
  if (hash(source) !== sourceSha || hash(probe) !== probeSha)
    throw Error("Reviewed sources changed");
  return { source, probe };
}
try {
  const mode = process.argv[2];
  if (
    !["--prepare", "--apply"].includes(mode) ||
    process.argv[3] !== "--existing-cli-login" ||
    process.argv.length !== 4 ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST release required");
  const { source, probe } = contents(),
    token = savedCliToken();
  const rehearsal = JSON.parse(
    readFileSync(".verification-results/commusoft-partial-times-rehearse-v4-result.json"),
  );
  const original = JSON.parse(
    readFileSync(".verification-results/commusoft-partial-times-rehearse-v4-journal.json"),
  );
  if (
    rehearsal.state !== "full_schema_projection_rehearsed_and_rolled_back" ||
    rehearsal.projectRef !== TEST_PROJECT ||
    rehearsal.sourceSha256 !== sourceSha ||
    rehearsal.probeSha256 !== probeSha ||
    Date.now() - Date.parse(rehearsal.observedAt) > 3600000
  )
    throw Error("Fresh full-schema rehearsal required");
  const before = await readPhoneSavedResultsCatalog(token),
    snapshot = phoneSavedResultsSourceQuery(before.catalog.phone),
    rows = await communicationQuery(token, snapshot),
    functions = (await communicationQuery(token, `select ${fnCatalog} as functions`))[0].functions;
  if (
    before.fingerprint !== original.schema ||
    rows.length !== 113 ||
    ordered(rows) !== ordered(original.before) ||
    JSON.stringify(functions) !== JSON.stringify(original.functions[0].functions)
  )
    throw Error("Exact rehearsed prerequisites required");
  if (mode === "--prepare") {
    const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
    const sql = `-- TEST-only; matching frontend must display timing limitations. No Drummonds publication.
begin;
set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST release required';end if;
 if md5((${PHONE_SAVED_RESULTS_CATALOG})::text)<>'${original.schema}' or ${fnCatalog} is distinct from ${quote(JSON.stringify(functions))}::jsonb then raise exception 'TEST schema changed';end if;
 if exists(select 1 from platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then raise exception 'Commusoft must be idle';end if;
end$$;
create temp table partial_times_preserved on commit drop as ${snapshot};
create temp table partial_times_functions on commit drop as select value from jsonb_array_elements(${fnCatalog});
${body}
savepoint partial_projection_probe;
${probe}
rollback to savepoint partial_projection_probe;
release savepoint partial_projection_probe;
do $$begin
 if (select jsonb_agg(value-'definition' order by value->>'signature') from partial_times_functions) is distinct from (select jsonb_agg(value-'definition' order by value->>'signature') from jsonb_array_elements(${fnCatalog})) then raise exception 'Function permissions changed';end if;
 if (select value from partial_times_functions where value->>'signature' like '%learn_business_input_time_detail%') is distinct from (select value from jsonb_array_elements(${fnCatalog}) where value->>'signature' like '%learn_business_input_time_detail%') then raise exception 'Timestamp classifier changed';end if;
 if (select jsonb_agg(to_jsonb(x) order by x.name) from partial_times_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${snapshot})x) then raise exception 'Retained source changed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_commusoft_partial_job_times_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'commusoft-partial-job-times/1' as marker,md5((${PHONE_SAVED_RESULTS_CATALOG})::text) as fingerprint,${fnCatalog} as functions,(select jsonb_agg(to_jsonb(x) order by x.name) from partial_times_preserved x) as preserved;
commit;
`;
    const manifest = {
      version: "commusoft-partial-job-times/1",
      projectRef: TEST_PROJECT,
      sha256: hash(sql),
      sources: [
        { path: sourcePath, sha256: sourceSha },
        { path: probePath, sha256: probeSha },
      ],
      priorFingerprint: original.schema,
      preservedDataSets: 113,
      positiveProjectionProbe:
        "rolled back; banned passwordless synthetic owner only; no session or platform grant",
    };
    writeFileSync(prefix + ".sql", sql, { flag: "wx" });
    writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(JSON.stringify({ state: "prepared", ...manifest }));
  } else {
    const sql = readFileSync(prefix + ".sql", "utf8"),
      manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
    if (
      manifest.projectRef !== TEST_PROJECT ||
      manifest.sha256 !== PACKAGE_SHA ||
      hash(sql) !== manifest.sha256 ||
      manifest.sources[0].sha256 !== sourceSha ||
      manifest.sources[1].sha256 !== probeSha
    )
      throw Error("Pinned package differs");
    const journal = {
      observedAt: new Date().toISOString(),
      projectRef: TEST_PROJECT,
      sha256: manifest.sha256,
      priorFingerprint: before.fingerprint,
      before: rows,
      functions,
    };
    const fd = openSync(
      ".verification-results/commusoft-partial-times-release-journal.json",
      "wx",
      0o600,
    );
    try {
      writeSync(fd, JSON.stringify(journal, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const receipt = await communicationQuery(
      token,
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${manifest.sha256}';\n${sql}`,
      { readOnly: false },
    );
    const after = await readPhoneSavedResultsCatalog(token),
      afterRows = await communicationQuery(token, snapshot);
    const r = receipt.find((x) => x.marker === "commusoft-partial-job-times/1");
    if (
      !r ||
      r.fingerprint !== after.fingerprint ||
      ordered(afterRows) !== ordered(rows) ||
      ordered(r.preserved) !== ordered(rows) ||
      !after.catalog.base.ledger.some(
        (e) => e.name === "learn_commusoft_partial_job_times_v1" && e.sha256 === manifest.sha256,
      )
    )
      throw Error("Post-release proof differs");
    const result = {
      state: "installed_test_projection_verified",
      observedAt: new Date().toISOString(),
      projectRef: TEST_PROJECT,
      packageSha256: manifest.sha256,
      sourceSha256: sourceSha,
      catalogFingerprint: after.fingerprint,
      preservedDataSets: 113,
      providerRequests: 0,
      committedUsers: 0,
      newPlatformGrants: 0,
      realRecordsPublished: 0,
      productionChanged: false,
    };
    writeFileSync(
      ".verification-results/commusoft-partial-times-release-result.json",
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result));
  }
} catch (e) {
  console.error(
    "TEST release unconfirmed; inspect journal before any retry. " +
      String(e.message).slice(0, 300),
  );
  process.exitCode = 1;
}
