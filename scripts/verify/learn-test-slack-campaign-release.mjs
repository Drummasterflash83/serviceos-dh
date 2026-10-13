/** Fixed TEST-only Slack campaign/controller migration. No credentials, accounts or capture
 * activation. Rehearse with rollback, then apply the identical package once. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const mode = process.argv[2],
  prefix = "supabase/release/learn-test/092_slack_campaigns";
if (
  !["--prepare", "--rehearse", "--apply"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit fixed TEST scope required");
const sourcePaths = [
  "supabase/migrations/20261101650000_learn_slack_historical_ranges.sql",
  "supabase/migrations/20261101660000_learn_slack_message_kinds.sql",
  "supabase/migrations/20261101670000_learn_slack_history_campaigns.sql",
  "supabase/migrations/20261101680000_learn_slack_campaign_threads.sql",
  "supabase/migrations/20261101690000_learn_slack_campaign_lifecycle.sql",
  "supabase/migrations/20261101700000_learn_slack_campaign_controller.sql",
];
const localProof = JSON.parse(
  readFileSync(".verification-results/slack-campaign-controller-rehearsal-v1/report.json", "utf8"),
);
const proofPins = [
  localProof.sourceSha256,
  ...[
    "messageKinds",
    "campaigns",
    "campaignThreads",
    "campaignLifecycle",
    "campaignController",
  ].map((k) => localProof[k]?.sha256),
];
if (
  localProof.state !== "slack_historical_ranges_rehearsed_offline" ||
  !localProof.containerRemoved ||
  localProof.journeys.length !== 10 ||
  localProof.journeys.some((j) => !j.passed) ||
  sourcePaths.some(
    (p, i) => createHash("sha256").update(readFileSync(p)).digest("hex") !== proofPins[i],
  )
)
  throw Error("Exact complete offline rehearsal required");
const hash = (v) => createHash("sha256").update(v).digest("hex");
const source = sourcePaths.map((p) => readFileSync(p, "utf8")).join("\n");
const token = savedCliToken(),
  q = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const catalog = `select md5(coalesce(string_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',r.rolname,'acl',p.proacl)::text,'' order by p.proname,pg_get_function_identity_arguments(p.oid)),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.prokind in('f','p')`;
const namesSql =
  "select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in('public','storage','vault') or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1";
const idleSql =
  "select ((select count(*) from public.platform_jobs where status='running' or (job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','retrying'))) + (select count(*) from public.slack_recurring_channels where enabled))::int active";
const absentSql =
  "select to_regclass('public.slack_history_campaigns') is null and to_regprocedure('public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)') is null and to_regprocedure('public.learn_slack_control_access(uuid,boolean,text)') is not null and not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_campaigns_v1') absent";
const tables = (await q(namesSql)).map((r) => r.name);
if (
  tables.length !== 213 ||
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
  throw Error("Workers must be idle and migration absent; inspect current state before retry");
const sources = sourcePaths.map((path) => ({ path, sha256: hash(readFileSync(path)) }));
if (mode === "--prepare") {
  const body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
  const sql = `-- TEST 092 only: durable Slack campaigns and controller; no secrets or capture activation.
begin;
set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 or (${catalog}) is distinct from '${prior[0].fingerprint}'
 or (${idleSql})<>0 or not (${absentSql}) then raise exception 'Slack campaign TEST release precondition changed';end if;
end$$;
create temporary table slack_campaign_preserved on commit drop as ${snapshot};
${body}
do $$begin
 if to_regprocedure('public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)') is null
 or not has_function_privilege('authenticated','public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)','execute')
 or has_function_privilege('anon','public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)','execute')
 or has_function_privilege('service_role','public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)','execute')
 or not has_function_privilege('service_role','public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)','execute')
 or has_function_privilege('authenticated','public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)','execute')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('slack_history_campaigns','slack_history_campaign_channels','slack_history_campaign_requests','slack_history_campaign_dispatches','slack_history_campaign_thread_scans','slack_history_campaign_threads','slack_history_campaign_closures')
 and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
 or exists(select 1 from public.slack_history_campaigns) or exists(select 1 from public.slack_history_campaign_channels)
 or exists(select 1 from public.slack_history_campaign_requests) or exists(select 1 from public.slack_history_campaign_dispatches)
 or exists(select 1 from public.slack_history_campaign_thread_scans) or exists(select 1 from public.slack_history_campaign_threads)
 or exists(select 1 from public.slack_history_campaign_closures)
 then raise exception 'Slack campaign boundary failed';end if;
 if (select jsonb_agg(to_jsonb(x) order by name) from slack_campaign_preserved x) is distinct from
 (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x) then raise exception 'Retained data changed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref)
 values(current_setting('serviceos.release_source_sha256'),'learn_slack_campaigns_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'slack_campaigns_installed' marker,(${catalog}) fingerprint;
commit;
`;
  const manifest = {
    projectRef: TEST_PROJECT,
    sha256: hash(sql),
    priorFingerprint: prior[0].fingerprint,
    sources,
    localRehearsalSha256: hash(
      readFileSync(".verification-results/slack-campaign-controller-rehearsal-v1/report.json"),
    ),
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
          readFileSync(".verification-results/slack-campaign-release-rehearse-result.json", "utf8"),
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
  const stem = ".verification-results/slack-campaign-release-" + mode.slice(2),
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
      "select source_sha256 from of_test_deploy.migrations where migration_name='learn_slack_campaigns_v1'",
    );
  const expected =
    mode === "--rehearse"
      ? response?.find((r) => r.marker === "slack_campaigns_installed")
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
