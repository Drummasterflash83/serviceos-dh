/** Exact operator-only recent-unlinked source review release.
 * Adds one authenticated, audited read RPC and its migration ledger receipt.
 * Does not link jobs, change flags, read providers, or expose client routes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const PROJECT = "tgbnakbxwcqjeimygroz";
const VERSION = "20261107090000";
const NAME = "new_dawn_recent_unlinked_commusoft_jobs";
const SHA = "04fa70902c5c143e3b07f255579c8f37dbe93f1960d6c38c6d3fda3bbb41acf5";
const SIGNATURE = "public.new_dawn_recent_unlinked_commusoft_jobs(uuid,uuid,text)";
const TENANT = "00000000-0000-0000-0000-000000000001";
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

export function source() {
  const sql = readFileSync(
    new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url),
    "utf8",
  );
  if (
    createHash("sha256").update(sql).digest("hex") !== SHA ||
    !/\nbegin;\n/i.test(sql) ||
    !/\ncommit;\s*$/i.test(sql)
  )
    throw Error("Reviewed recent-unlinked migration changed");
  return { sql, body: sql.replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n") };
}

const catalogSql = `select
 to_regprocedure('${SIGNATURE}') is not null as installed,
 coalesce((select prosecdef from pg_proc where oid=to_regprocedure('${SIGNATURE}')),false) as security_definer,
 coalesce((select 'statement_timeout=15s'=any(proconfig) from pg_proc
  where oid=to_regprocedure('${SIGNATURE}')),false) as bounded_timeout,
 position('learn_operator_input_access' in
  coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as operator_gate,
 position('client_jobs.recent_unlinked_source_review' in
  coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as audited_read,
 coalesce(has_function_privilege('authenticated',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as authenticated_execute,
 coalesce(has_function_privilege('anon',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as anon_execute,
 coalesce(has_function_privilege('service_role',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as service_execute,
 (select count(*)::integer from public.feature_flags where flag='new_dawn.source_job_home'
  and value='true'::jsonb) as client_enabled`;
const ledgerSql = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text='${VERSION}'`;

async function query(token, project, sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const embedded =
      typeof problem?.message === "string"
        ? problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]
        : null;
    const code =
      typeof problem?.code === "string" && /^[A-Z0-9]{5}$/.test(problem.code)
        ? problem.code
        : (embedded ?? "unknown");
    const marker =
      typeof problem?.message === "string"
        ? problem.message.match(/ERROR:\s+[A-Z0-9]{5}:\s+([a-z_]{3,80})/)?.[1]
        : null;
    throw Error(
      `Recent-unlinked ${readOnly ? "read" : "transaction"} failed (HTTP ${response.status}, SQLSTATE ${code}${marker ? `, marker ${marker}` : ""})`,
    );
  }
  return response.json();
}

export async function snapshot() {
  const token = savedCliToken();
  const [catalog, ledger] = await Promise.all([
    query(token, PROJECT, catalogSql),
    query(token, PROJECT, ledgerSql),
  ]);
  return { catalog: catalog?.[0], ledger };
}

export function assess(s, installed = false) {
  const c = s?.catalog;
  if (!c || c.client_enabled !== 0 || c.installed !== installed)
    throw Error("Recent-unlinked LIVE catalog changed");
  if (installed) {
    if (
      !c.security_definer ||
      !c.bounded_timeout ||
      !c.operator_gate ||
      !c.audited_read ||
      !c.authenticated_execute ||
      c.anon_execute ||
      c.service_execute ||
      s.ledger?.length !== 1 ||
      s.ledger[0].version !== VERSION ||
      s.ledger[0].name !== NAME ||
      s.ledger[0].statements?.length !== 1 ||
      s.ledger[0].statements[0] !== source().sql
    )
      throw Error("Recent-unlinked installed contract changed");
  } else if (s.ledger?.length !== 0) throw Error("Recent-unlinked ledger changed");
  return true;
}

export function releaseSql(rollback = false) {
  const { sql, body } = source();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $preflight$ begin
 if to_regprocedure('${SIGNATURE}') is not null
  or exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or exists(select 1 from public.feature_flags where flag='new_dawn.source_job_home'
   and value='true'::jsonb)
  then raise exception 'recent_unlinked_release_preflight_changed';end if;
end $preflight$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(sql)}]);
do $postflight$ begin
 if to_regprocedure('${SIGNATURE}') is null
  or not (select prosecdef from pg_proc where oid=to_regprocedure('${SIGNATURE}'))
  or not (select 'statement_timeout=15s'=any(proconfig) from pg_proc
   where oid=to_regprocedure('${SIGNATURE}'))
  or position('learn_operator_input_access' in
   pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or position('client_jobs.recent_unlinked_source_review' in
   pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or not has_function_privilege('authenticated','${SIGNATURE}','EXECUTE')
  or has_function_privilege('anon','${SIGNATURE}','EXECUTE')
  or has_function_privilege('service_role','${SIGNATURE}','EXECUTE')
  or exists(select 1 from public.feature_flags where flag='new_dawn.source_job_home'
   and value='true'::jsonb)
  then raise exception 'recent_unlinked_release_postflight_changed';end if;
end $postflight$;
select 'recent-unlinked-operator-rpc-installed/1' as marker;
${rollback ? "rollback" : "commit"};`;
}

export async function installLive() {
  const before = await snapshot();
  assess(before, false);
  let acknowledged = false;
  try {
    const rows = await query(savedCliToken(), PROJECT, releaseSql(), false);
    acknowledged =
      rows?.some?.((row) => row.marker === "recent-unlinked-operator-rpc-installed/1") === true;
  } catch {
    /* Check exact catalog/ledger once; never replay an uncertain write. */
  }
  const after = await snapshot();
  assess(after, true);
  return {
    state: "operator_recent_unlinked_rpc_installed",
    project: PROJECT,
    version: VERSION,
    acknowledged,
    exactLedger: true,
    clientFlagEnabled: false,
    providerRequests: 0,
  };
}

export async function rehearseTest() {
  const token = savedCliToken();
  const before = (
    await query(
      token,
      TEST_PROJECT,
      `select to_regprocedure('${SIGNATURE}') is null as function_absent,
     to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent`,
    )
  )[0];
  if (!before?.function_absent || !before?.ledger_absent)
    throw Error("TEST recent-unlinked preflight changed");
  const createLedger = `create schema supabase_migrations;
create table supabase_migrations.schema_migrations
 (version text primary key,name text not null,statements text[] not null);`;
  const install = releaseSql(true)
    .replace(/^begin;\n/, "")
    .replace(/rollback;\s*$/, "");
  const fixture = `do $fixture$
declare fixture_actor uuid;fixture_tenant uuid;fixture_connection uuid;got jsonb;
begin
 select c.tenant_id,c.id into fixture_tenant,fixture_connection
  from public.provider_connections c
  where c.provider='commusoft' and c.status='configured' and c.revoked_at is null
   and c.verified_at<=clock_timestamp()
   and exists(select 1 from public.feature_flags f where f.tenant_id=c.tenant_id
    and f.flag='learn.enabled' and f.value='true'::jsonb)
   and exists(select 1 from public.feature_flags f where f.tenant_id=c.tenant_id
    and f.flag='learn.inputs.commusoft.enabled' and f.value='true'::jsonb)
   and exists(select 1 from public.tenant_connectors t where t.tenant_id=c.tenant_id
    and t.provider='commusoft' and t.connector_id='commusoft' and t.enabled and t.status='active')
  order by c.id limit 1;
 if fixture_connection is null then raise exception 'recent_unlinked_test_connection_missing';end if;
 for fixture_actor in select g.profile_id from public.platform_authority_grants g
  join public.profiles p on p.id=g.profile_id
  join auth.users u on u.id=g.profile_id and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
  where g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp()
  order by g.profile_id loop
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',fixture_actor::text,true);
  exit when public.current_user_is_openfolk_operator('platform.controlplane.admin');
 end loop;
 if fixture_actor is null or not public.current_user_is_openfolk_operator('platform.controlplane.admin')
  then raise exception 'recent_unlinked_test_operator_missing';end if;
 got:=public.new_dawn_recent_unlinked_commusoft_jobs(fixture_tenant,fixture_connection,
  'Rollback-only recent source review');
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.new_dawn_recent_unlinked_commusoft_jobs(fixture_tenant,fixture_connection,
   'Foreign actor must be denied');
  raise exception 'recent_unlinked_foreign_actor_accepted';
 exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',fixture_actor::text,true);
 begin
  perform public.new_dawn_recent_unlinked_commusoft_jobs(fixture_tenant,gen_random_uuid(),
   'Unknown connection must be denied');
  raise exception 'recent_unlinked_unknown_connection_accepted';
 exception when sqlstate '42501' then null;end;
 if got->>'version'<>'new-dawn-recent-unlinked-jobs/1'
  or got->>'actor_id'<>fixture_actor::text
  or got->>'tenant_id'<>fixture_tenant::text
  or jsonb_array_length(got->'rows')>25
  or not exists(select 1 from public.controlplane_change_log log
   where log.id=(got->>'audit_id')::uuid and log.tenant_id=fixture_tenant
    and log.actor=fixture_actor::text
    and log.action='client_jobs.recent_unlinked_source_review'
    and log.reason='Rollback-only recent source review' and log.view_as_active=false)
  then raise exception 'recent_unlinked_test_contract_failed';end if;
 create temporary table recent_unlinked_test_receipt on commit drop as
  select 'recent-unlinked-test-passed/1'::text marker,
   (got->>'unlinked_count')::integer unlinked_count;
end $fixture$;
select marker,unlinked_count from recent_unlinked_test_receipt;`;
  let rows, error;
  try {
    rows = await query(
      token,
      TEST_PROJECT,
      `begin;${createLedger}${install}${fixture}rollback;`,
      false,
    );
  } catch (cause) {
    error = cause;
  }
  const after = (
    await query(
      token,
      TEST_PROJECT,
      `select to_regprocedure('${SIGNATURE}') is null as function_absent,
     to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent`,
    )
  )[0];
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("TEST recent-unlinked rehearsal did not roll back");
  if (error) throw error;
  const receipt = rows?.find?.((row) => row.marker === "recent-unlinked-test-passed/1");
  if (!receipt || !Number.isInteger(receipt.unlinked_count))
    throw Error("TEST recent-unlinked receipt missing");
  return {
    state: "passed_rolled_back",
    project: TEST_PROJECT,
    version: VERSION,
    unlinkedCount: receipt.unlinked_count,
    providerRequests: 0,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const mode = process.argv.slice(2).join(" ");
  if (
    !["--test-rollback-only", "--live-catalog-read-only", "--live-install-after-review"].includes(
      mode,
    )
  )
    throw Error("Exact recent-unlinked release mode required");
  try {
    const result =
      mode === "--test-rollback-only"
        ? await rehearseTest()
        : mode === "--live-catalog-read-only"
          ? await snapshot()
          : await installLive();
    if (mode === "--live-catalog-read-only")
      console.log(
        JSON.stringify({
          state: "read_only_catalog",
          project: PROJECT,
          installed: result.catalog?.installed,
          operatorGate: result.catalog?.operator_gate,
          auditedRead: result.catalog?.audited_read,
          ledgerRows: result.ledger?.length,
          clientFlagEnabled: result.catalog?.client_enabled,
          providerRequests: 0,
        }),
      );
    else console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
