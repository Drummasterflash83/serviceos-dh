/** One-shot TEST reader package; no endpoint, trigger, login or provider activation. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhoneSavedResultsCatalog,
  phoneSavedResultsSourceQuery,
  PHONE_SAVED_RESULTS_CATALOG,
} from "./learn-phone-saved-results-catalog.mjs";
const prefix = "supabase/release/learn-test/060_scheduler_health";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const contract = `select jsonb_build_object(
 'function',(select jsonb_build_object('definitionHash',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'settings',p.proconfig,'securityDefiner',p.prosecdef) from pg_proc p where p.oid=to_regprocedure('public.learn_scheduler_health_read(uuid)')),
 'indexes',(select jsonb_agg(pg_get_indexdef(c.oid) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('learn_email_scheduler_latest_idx','learn_phone_scheduler_latest_idx')),
 'rawEmail',has_column_privilege('authenticated','public.email_sync_runs','metadata','select'),
 'rawJobs',has_column_privilege('authenticated','public.platform_jobs','payload','select')
) as candidate`;

async function main() {
  const mode = process.argv[2];
  if (
    !["--prepare", "--rehearse", "--apply"].includes(mode) ||
    process.argv[3] !== "--existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST scope required");
  const token = savedCliToken(),
    before = await readPhoneSavedResultsCatalog(token);
  if (before.fingerprint !== "968d483ec625195527b5853cba6ecf8d")
    throw Error("Exact TEST 059 prerequisites required");
  const snapshot = phoneSavedResultsSourceQuery(before.catalog.phone);
  const preserved = await communicationQuery(token, snapshot);
  if (preserved.length !== 113) throw Error("Full preservation snapshot required");
  if (mode === "--prepare") {
    const rehearsal = JSON.parse(
      readFileSync(".verification-results/scheduler-health-rehearsal-result.json"),
    );
    const source = readFileSync(
      "supabase/migrations/20261101270000_learn_scheduler_health.sql",
      "utf8",
    );
    const probe = readFileSync("scripts/verify/learn-scheduler-health.assert.sql", "utf8");
    if (
      rehearsal.state !== "full_schema_rehearsed_and_rolled_back" ||
      rehearsal.sourceSha256 !== hash(source) ||
      rehearsal.probeSha256 !== hash(probe)
    )
      throw Error("Matching successful full-schema rehearsal required");
    const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
    const sql = `-- TEST 060: restricted scheduling summaries. No capture activation.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$'
  or md5((${PHONE_SAVED_RESULTS_CATALOG})::text)<>'${before.fingerprint}' then raise exception 'Exact TEST scheduler prerequisites required';end if;
end$$;
create temporary table scheduler_preserved on commit drop as ${snapshot};
${body}
savepoint scheduler_assertions;
${probe}
rollback to savepoint scheduler_assertions;
release savepoint scheduler_assertions;
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from scheduler_preserved x) is distinct from
  (select jsonb_agg(to_jsonb(x) order by x.name) from (${snapshot})x) then raise exception 'Source preservation failed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref)
 values(current_setting('serviceos.release_source_sha256'),'learn_scheduler_health_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-scheduler-health-installed/1' as marker,md5((${PHONE_SAVED_RESULTS_CATALOG})::text) as fingerprint,(${contract}) as candidate;
commit;
`;
    const manifest = {
      projectRef: TEST_PROJECT,
      sha256: hash(sql),
      sourceSha256: hash(source),
      probeSha256: hash(probe),
      priorFingerprint: before.fingerprint,
      preservedDataSets: 113,
    };
    writeFileSync(prefix + ".sql", sql, { flag: "wx" });
    writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(JSON.stringify({ state: "prepared", ...manifest }));
    return;
  }
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json"));
  if (
    hash(sql) !== manifest.sha256 ||
    manifest.projectRef !== TEST_PROJECT ||
    manifest.priorFingerprint !== before.fingerprint ||
    hash(readFileSync("supabase/migrations/20261101270000_learn_scheduler_health.sql", "utf8")) !==
      manifest.sourceSha256 ||
    hash(readFileSync("scripts/verify/learn-scheduler-health.assert.sql", "utf8")) !==
      manifest.probeSha256
  )
    throw Error("Pinned package differs");
  const rehearsal =
    mode === "--apply"
      ? JSON.parse(
          readFileSync(".verification-results/scheduler-health-package-rehearse-result.json"),
        )
      : null;
  if (
    rehearsal &&
    (rehearsal.state !== "rehearsed_rolled_back" ||
      rehearsal.packageSha256 !== manifest.sha256 ||
      !rehearsal.expectedFingerprint ||
      !rehearsal.expectedContract ||
      Date.now() - Date.parse(rehearsal.completedAt) > 3600000)
  )
    throw Error("Fresh exact package rehearsal required");
  const stem = ".verification-results/scheduler-health-package-" + mode.slice(2);
  const journal = {
    projectRef: TEST_PROJECT,
    packageSha256: manifest.sha256,
    mode,
    startedAt: new Date().toISOString(),
    before: before.fingerprint,
    preserved,
  };
  const fd = openSync(stem + "-journal.json", "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(journal, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let result = null;
  try {
    result = await communicationQuery(
      token,
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${manifest.sha256}';\n` +
        (mode === "--rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      { readOnly: false },
    );
  } catch {
    /* Never resubmit uncertain transactions. */
  }
  const after = await readPhoneSavedResultsCatalog(token),
    afterRows = await communicationQuery(token, snapshot),
    actualContract = await communicationQuery(token, contract);
  const expectedFingerprint =
    mode === "--rehearse"
      ? result?.find((r) => r.marker === "learn-scheduler-health-installed/1")?.fingerprint
      : rehearsal.expectedFingerprint;
  const expectedContract =
    mode === "--rehearse"
      ? result?.find((r) => r.candidate)?.candidate
      : rehearsal.expectedContract;
  const unchanged = stable(preserved) === stable(afterRows);
  const verified =
    unchanged &&
    expectedFingerprint &&
    expectedContract?.function &&
    expectedContract?.indexes?.length === 2 &&
    (mode === "--rehearse"
      ? after.fingerprint === before.fingerprint &&
        actualContract[0]?.candidate?.function === null &&
        actualContract[0]?.candidate?.indexes === null
      : after.fingerprint === expectedFingerprint &&
        JSON.stringify(actualContract[0]?.candidate) === JSON.stringify(expectedContract));
  const report = {
    projectRef: TEST_PROJECT,
    state: verified
      ? mode === "--rehearse"
        ? "rehearsed_rolled_back"
        : "installed_needs_signed_in_acceptance"
      : "requires_inspection",
    completedAt: new Date().toISOString(),
    packageSha256: manifest.sha256,
    expectedFingerprint: expectedFingerprint ?? null,
    afterFingerprint: after.fingerprint,
    expectedContract: expectedContract ?? null,
    preservedDataSets: unchanged ? 113 : null,
    persistentFixtureUsers: unchanged ? 0 : null,
    persistentFixtureGrants: unchanged ? 0 : null,
    issuedSessions: 0,
    providerRequests: 0,
    productionChanged: false,
  };
  writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!verified) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Scheduler release unconfirmed; inspect journal and exact TEST state before another attempt",
  );
  process.exitCode = 1;
});
