/** Fixed TEST-only Commusoft recurring migration. No credentials, accounts or capture
 * activation. Rehearse with rollback, then apply the identical package once. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const mode = process.argv[2],
  prefix = "supabase/release/learn-test/084_commusoft_recurring";
if (
  !["--prepare", "--rehearse", "--apply"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit fixed TEST scope required");
const sourcePaths = ["supabase/migrations/20261101540000_learn_commusoft_update_windows.sql", "supabase/migrations/20261101550000_learn_commusoft_recurring.sql"];
const hash = (v) => createHash("sha256").update(v).digest("hex");
const source = sourcePaths.map(p=>readFileSync(p,"utf8")).join("\n");
const token = savedCliToken(),
  q = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const catalog = `select md5(coalesce(string_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',r.rolname,'acl',p.proacl)::text,'' order by p.proname,pg_get_function_identity_arguments(p.oid)),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.prokind in('f','p')`;
const namesSql =
  "select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in('public','storage','vault') or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1";
const idleSql =
  "select count(*)::int active from public.platform_jobs where job_type='commusoft.source_sync' and status in('queued','running','retrying')";
const absentSql =
  "select to_regprocedure('public.learn_commusoft_update_window(jsonb)') is null and to_regclass('public.learn_commusoft_recurring') is null and to_regprocedure('public.learn_commusoft_claim_jobs(uuid)') is not null absent";
const tables = (await q(namesSql)).map((r) => r.name);
if (
  tables.length < 195 ||
  tables.some((t) => !/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t))
)
  throw Error("Complete preservation inventory required");
const snapshot = tables
  .map(
    (t) =>
      `select '${t}' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from ${t} s`,
  )
  .join(" union all ");
const prior = await q(catalog),
  before = await q(snapshot);
if ((await q(idleSql))[0]?.active !== 0 || (await q(absentSql))[0]?.absent !== true)
  throw Error("Commusoft must be idle and migration absent; inspect current state before retry");
const sources = sourcePaths.map(path=>({path,sha256:hash(readFileSync(path))}));
if (mode === "--prepare") {
  const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
  const sql = `-- TEST 084 only: bounded update windows and recurring Commusoft controls; no secrets or capture activation.
begin;
set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 or (${catalog}) is distinct from '${prior[0].fingerprint}'
 or (${idleSql})<>0 or not (${absentSql}) then raise exception 'Commusoft TEST release precondition changed';end if;
end$$;
create temporary table commusoft_recurring_preserved on commit drop as ${snapshot};
${body}
do $$begin
 if to_regprocedure('public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)') is null
 or to_regprocedure('public.learn_commusoft_recurring_read(uuid)') is null
 or not has_function_privilege('authenticated','public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)','execute')
 or not has_function_privilege('authenticated','public.learn_commusoft_recurring_read(uuid)','execute')
 or has_function_privilege('anon','public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)','execute')
 or has_function_privilege('service_role','public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text)','execute')
 or has_function_privilege('authenticated','public.learn_commusoft_schedule_recurring(integer)','execute')
 or not has_function_privilege('service_role','public.learn_commusoft_schedule_recurring(integer)','execute')
 or exists(select 1 from public.learn_commusoft_recurring)
 or exists(select 1 from public.learn_commusoft_recurring_steps)
 or exists(select 1 from public.learn_commusoft_recurring_requests)
 then raise exception 'Recurring Commusoft boundary failed';end if;
 if (select jsonb_agg(to_jsonb(x) order by name) from commusoft_recurring_preserved x) is distinct from
 (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x) then raise exception 'Retained data changed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref)
 values(current_setting('serviceos.release_source_sha256'),'learn_commusoft_recurring_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'commusoft_recurring_installed' marker,(${catalog}) fingerprint;
commit;
`;
  const manifest = {
    projectRef: TEST_PROJECT,
    sha256: hash(sql),
    priorFingerprint: prior[0].fingerprint,
    sources,
    preservedDatasets: tables.length,
    tables,
  };
  writeFileSync(prefix + ".sql", sql, { flag: "wx" });
  writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      state: "prepared",
      projectRef: TEST_PROJECT,
      sha256: manifest.sha256,
      preservedDatasets: tables.length,
    }),
  );
} else {
  const sql = readFileSync(prefix + ".sql", "utf8"),
    manifest = JSON.parse(readFileSync(prefix + ".manifest.json", "utf8"));
  if (
    manifest.projectRef !== TEST_PROJECT ||
    hash(sql) !== manifest.sha256 ||
    manifest.priorFingerprint !== prior[0].fingerprint ||
    JSON.stringify(sources) !== JSON.stringify(manifest.sources) ||
    JSON.stringify(tables) !== JSON.stringify(manifest.tables)
  )
    throw Error("Pinned package or current schema changed");
  const rehearsal =
    mode === "--apply"
      ? JSON.parse(
          readFileSync(".verification-results/commusoft-recurring-release-rehearse-result.json", "utf8"),
        )
      : null;
  if (
    rehearsal &&
    (rehearsal.state !== "rehearsed_rolled_back" ||
      rehearsal.packageSha256 !== manifest.sha256 ||
      !Number.isFinite(Date.parse(rehearsal.observedAt)) ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000 ||
      Date.parse(rehearsal.observedAt) > Date.now())
  )
    throw Error("Fresh exact rehearsal required");
  const stem = ".verification-results/commusoft-recurring-release-" + mode.slice(2),
    journal = {
      projectRef: TEST_PROJECT,
      startedAt: new Date().toISOString(),
      packageSha256: manifest.sha256,
      before,
      prior,
    };
  const fd = openSync(stem + "-journal.json", "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(journal, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let response = null;
  try {
    response = await q(
      `set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${manifest.sha256}';\n` +
        (mode === "--rehearse" ? sql.replace(/\ncommit;\n$/, "\nrollback;\n") : sql),
      false,
    );
  } catch {
    /* Inspect after-state; never resend an uncertain mutation. */
  }
  const post = await q(catalog),
    after = await q(snapshot),
    ledger = await q(
      "select source_sha256 from of_test_deploy.migrations where migration_name='learn_commusoft_recurring_v1'",
    );
  const expected =
    mode === "--rehearse"
      ? response?.find((r) => r.marker === "commusoft_recurring_installed")
      : rehearsal.expected;
  const sorted = (rs) => JSON.stringify([...rs].sort((a, b) => a.name.localeCompare(b.name)));
  const preserved = sorted(before) === sorted(after);
  const ok =
    preserved &&
    /^[a-f0-9]{32}$/.test(expected?.fingerprint ?? "") &&
    (mode === "--rehearse"
      ? post[0].fingerprint === prior[0].fingerprint && ledger.length === 0
      : post[0].fingerprint === expected.fingerprint &&
        ledger.length === 1 &&
        ledger[0].source_sha256 === manifest.sha256);
  const result = {
    state: ok
      ? mode === "--rehearse"
        ? "rehearsed_rolled_back"
        : "installed_verified"
      : "requires_inspection",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    packageSha256: manifest.sha256,
    expected: expected ?? null,
    afterFingerprint: post[0]?.fingerprint,
    preservedDatasets: preserved ? tables.length : null,
    newAccounts: 0,
    newGrants: 0,
    providerRequests: 0,
    credentialsUploaded: 0,
    productionChanged: false,
  };
  writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
  if (!ok) process.exitCode = 1;
}
