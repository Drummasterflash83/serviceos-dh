/** Exact M1 attention-order SQL release, ledger receipt and bounded readbacks.
 * No provider request or client flag activation. LIVE mutation is opt-in only.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { migrationBodies } from './new-dawn-m1-source-home-release.mjs';

const PROJECT='tgbnakbxwcqjeimygroz';
const TENANT='00000000-0000-0000-0000-000000000001';
const VERSION='20261107050000';
const NAME='new_dawn_source_job_home_attention_order';
const SHA='b7da1fb527e7627373cda607a38a0d9aaa9a4eb30c3d77ab6b2cf76fdb53848c';
const SIGNATURE='public.new_dawn_source_job_home(uuid,text)';
const AUDIT_REASON='OpenFolk release verification of 13 October retained Drummonds job evidence';
const CLIENT='new_dawn.source_job_home';
const OPERATOR='new_dawn.source_job_home.operator_preview';
const quote=(value)=>`'${value.replaceAll("'","''")}'`;

export function source() {
  const sql=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),'utf8');
  if (createHash('sha256').update(sql).digest('hex')!==SHA ||
      !/\nbegin;\n/i.test(sql) || !/\ncommit;\s*$/i.test(sql))
    throw Error('Reviewed M1 attention migration changed');
  return {sql,body:sql.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n')};
}

const catalogSql=`select
 to_regprocedure('${SIGNATURE}') is not null as installed,
 position('new_dawn.source_job_home.operator_preview' in
  coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as operator_gate,
 position('client_jobs.source_home_preview' in
  coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as audited_preview,
 position('case status when ''on_hold'' then 0' in
  coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as attention_selection,
 position('case fields->>''status'' when ''on_hold'' then 0' in
  coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as attention_response,
 coalesce(has_function_privilege('authenticated',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as authenticated_execute,
 coalesce(has_function_privilege('anon',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as anon_execute,
 coalesce(has_function_privilege('service_role',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as service_execute,
 (select count(*)::integer from public.feature_flags where flag='${CLIENT}' and value='true'::jsonb) as client_enabled,
 (select count(*)::integer from public.feature_flags where flag='${OPERATOR}' and value='true'::jsonb) as operator_enabled,
 (select count(*)::integer from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='${OPERATOR}' and value='true'::jsonb) as drummonds_operator_enabled`;
const ledgerSql=`select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text='${VERSION}'`;
const auditSql=`select count(*)::integer as matching_audits,
 max(created_at) as latest_audit_at,
 count(*) filter(where view_as_active=false and actor<>'' and
  coalesce(jsonb_array_length(after->'record_ids'),0)<=24)::integer as scoped_audits
 from public.controlplane_change_log where tenant_id='${TENANT}'::uuid
 and action='client_jobs.source_home_preview'
 and reason=${quote(AUDIT_REASON)} and created_at>='2026-10-19 00:00:00+00'::timestamptz
 and created_at<'2026-10-20 00:00:00+00'::timestamptz`;

async function query(token,project,sql,readOnly=true) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})}),
    redirect:'error',signal:AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const problem=await response.json().catch(()=>null);
    const embedded=typeof problem?.message==='string' ?
      problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] : null;
    const code=typeof problem?.code==='string' && /^[A-Z0-9]{5}$/.test(problem.code)
      ? problem.code : embedded??'unknown';
    throw Error(`M1 attention ${readOnly?'read':'transaction'} failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  return response.json();
}

export async function snapshot(project=PROJECT, token=savedCliToken()) {
  const [catalog,ledger,audit]=await Promise.all([
    query(token,project,catalogSql),query(token,project,ledgerSql),
    project===PROJECT ? query(token,project,auditSql) : Promise.resolve(null),
  ]);
  return {catalog:catalog?.[0],ledger,audit:audit?.[0]};
}

export function assess(s,installed=false) {
  const c=s?.catalog,ledger=s?.ledger;
  if (!c?.installed || !c.operator_gate || !c.audited_preview ||
      !c.authenticated_execute || c.anon_execute || c.service_execute ||
      c.client_enabled!==0 || c.operator_enabled!==1 || c.drummonds_operator_enabled!==1 ||
      c.attention_selection!==installed || c.attention_response!==installed)
    throw Error('M1 attention function/flag contract changed');
  if (installed) {
    const full=source().sql;
    if (!Array.isArray(ledger) || ledger.length!==1 || ledger[0].version!==VERSION ||
        ledger[0].name!==NAME || ledger[0].statements?.length!==1 ||
        ledger[0].statements[0]!==full) throw Error('M1 attention ledger mismatch');
  } else if (!Array.isArray(ledger) || ledger.length!==0)
    throw Error('M1 attention ledger already recorded');
  return true;
}

export function releaseSql(tenant=TENANT,rollback=false) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenant))
    throw Error('M1 attention tenant invalid');
  const full=source();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $preflight$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('${SIGNATURE}') is null
  or position('${OPERATOR}' in pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or position('client_jobs.source_home_preview' in pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or position('case status when ''on_hold'' then 0' in pg_get_functiondef('${SIGNATURE}'::regprocedure))>0
  or exists(select 1 from public.feature_flags where flag='${CLIENT}' and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='${OPERATOR}' and value='true'::jsonb)<>1
  or (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='${OPERATOR}' and value='true'::jsonb)<>1
  then raise exception 'm1_attention_release_preflight_changed';end if;
end $preflight$;
${full.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(full.sql)}]);
do $postflight$ begin
 if position('case status when ''on_hold'' then 0' in
   pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or position('case fields->>''status'' when ''on_hold'' then 0' in
   pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or position('${OPERATOR}' in pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or position('client_jobs.source_home_preview' in pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or exists(select 1 from public.feature_flags where flag='${CLIENT}' and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='${OPERATOR}' and value='true'::jsonb)<>1
  then raise exception 'm1_attention_release_postflight_changed';end if;
end $postflight$;
select 'new-dawn-m1-attention-order-installed/1' as marker;
${rollback?'rollback':'commit'};`;
}

export function predictionSql() {
  const base=readFileSync(new URL('../../supabase/migrations/20261106210000_new_dawn_source_job_home.sql',import.meta.url),'utf8');
  if (createHash('sha256').update(base).digest('hex')!==
      '55fcb1eaa4bff4a4334e37fd80f6ec0a3ce2786d582597e05a9e931c6af4eba1')
    throw Error('M1 base selection changed');
  const start=base.indexOf('\n with linked as materialized (');
  const end=base.indexOf('\n ), rows as (',start);
  if (start<0 || end<0) throw Error('M1 candidate CTE changed');
  const old='select * from valid order by source_observed_at desc,updated_at desc nulls last,id limit 24';
  const replacement=`select * from valid order by
   case status when 'on_hold' then 0 when 'pending' then 1 when 'open' then 2
    when 'completed' then 4 when 'closed' then 5 else 3 end,
   source_observed_at desc,updated_at desc nulls last,id limit 24`;
  const cte=base.slice(start+2,end+3).replaceAll('p_tenant',`'${TENANT}'::uuid`).replace(old,replacement);
  if (!cte.startsWith('with linked as materialized (') || !cte.includes(replacement) ||
      /\b(?:insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/i.test(cte))
    throw Error('M1 prediction changed');
  return `begin transaction read only;set local statement_timeout='15s';${cte}
select (select count(*)::integer from valid) reviewed_count,
 count(*)::integer page_count,
 count(*) filter(where status='on_hold')::integer hold_count,
 count(*) filter(where status='pending')::integer pending_count,
 count(*) filter(where status='open')::integer open_count,
 count(*) filter(where status in ('completed','closed'))::integer completed_count,
 min(source_observed_at) oldest_source_observed_at,
 max(source_observed_at) newest_source_observed_at
 from candidates;rollback;`;
}

export async function predictLive() {
  const token=savedCliToken();
  const before=await snapshot(PROJECT,token);
  assess(before,false);
  const rows=await query(token,PROJECT,predictionSql(),false);
  const after=await snapshot(PROJECT,token);
  assess(after,false);
  if (JSON.stringify(before.catalog)!==JSON.stringify(after.catalog) ||
      JSON.stringify(before.ledger)!==JSON.stringify(after.ledger))
    throw Error('M1 attention state changed during prediction');
  const row=rows?.[0];
  if (!row || row.page_count<0 || row.page_count>24 ||
      row.hold_count+row.pending_count+row.open_count+row.completed_count>row.page_count)
    throw Error('M1 attention aggregate missing');
  return {state:'read_only_prediction',project:PROJECT,providerRequests:0,...row,
    limitation:'Saved statuses and retained source times, not current provider priority.'};
}

export async function readAudit() {
  const {audit}=await snapshot();
  if (!audit || audit.matching_audits<1 || audit.scoped_audits<1)
    throw Error('M1 exact operator preview audit not found');
  return {state:'exact_operator_preview_audited',project:PROJECT,
    matchingAudits:audit.matching_audits,scopedAudits:audit.scoped_audits,
    latestAuditAt:audit.latest_audit_at,reason:AUDIT_REASON,providerRequests:0};
}

export async function installLive() {
  const before=await snapshot();
  assess(before,false);
  let acknowledged=false;
  try {
    const rows=await query(savedCliToken(),PROJECT,releaseSql(),false);
    acknowledged=rows?.some?.(row=>row.marker==='new-dawn-m1-attention-order-installed/1')===true;
  } catch { /* An uncertain write is never replayed; inspect exact catalog and ledger. */ }
  const after=await snapshot();
  assess(after,true);
  return {state:'attention_order_installed',project:PROJECT,version:VERSION,
    acknowledged,exactLedger:true,clientFlagEnabled:false,operatorFlagEnabled:true,providerRequests:0};
}

export async function rehearseTest() {
  const token=savedCliToken();
  const tenantRows=await query(token,TEST_PROJECT,
    `select id::text from public.tenants where status='active' order by id limit 1`);
  const tenant=tenantRows?.[0]?.id;
  const catalogBefore=await query(token,TEST_PROJECT,
    `select to_regprocedure('${SIGNATURE}') is null as function_absent,
     to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent`);
  if (!tenant || !catalogBefore?.[0]?.function_absent || !catalogBefore?.[0]?.ledger_absent)
    throw Error('M1 TEST attention preflight changed');
  const [base,gate]=migrationBodies();
  const setup=`create schema supabase_migrations;
create table supabase_migrations.schema_migrations
 (version text primary key,name text not null,statements text[] not null);
insert into public.feature_flags(tenant_id,flag,value)
 values('${tenant}'::uuid,'${OPERATOR}','true'::jsonb)
 on conflict do nothing;
update public.feature_flags set value='true'::jsonb where tenant_id='${tenant}'::uuid
 and flag='${OPERATOR}';`;
  const install=releaseSql(tenant,true).replace(/^begin;\n/,'').replace(/rollback;\s*$/,'');
  const fixture=`do $fixture$
 declare fixture_actor uuid;got jsonb;
begin
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
  then raise exception 'm1_attention_test_operator_missing';end if;
 got:=public.new_dawn_source_job_home('${tenant}'::uuid,'M1 attention rollback audit');
 if got->>'version'<>'new-dawn-source-job-home/1'
  or jsonb_array_length(got->'rows')>24
  or not exists(select 1 from public.controlplane_change_log log
    where log.id=(got->>'audit_id')::uuid and log.tenant_id='${tenant}'::uuid
     and log.actor=fixture_actor::text and log.action='client_jobs.source_home_preview'
     and log.reason='M1 attention rollback audit' and log.view_as_active=false)
  then raise exception 'm1_attention_test_audit_failed';end if;
end $fixture$;`;
  const sql=`begin;${setup}${base}${gate}${install}${fixture}rollback;`;
  let rows,error;
  try { rows=await query(token,TEST_PROJECT,sql,false); }
  catch (cause) { error=cause; }
  const catalogAfter=await query(token,TEST_PROJECT,
    `select to_regprocedure('${SIGNATURE}') is null as function_absent,
     to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent`);
  if (JSON.stringify(catalogBefore)!==JSON.stringify(catalogAfter))
    throw Error('M1 TEST attention failed to roll back');
  if (error) throw error;
  if (!rows?.some?.(row=>row.marker==='new-dawn-m1-attention-order-installed/1'))
    throw Error('M1 TEST attention receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,version:VERSION,providerRequests:0};
}

if (process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
  const mode=process.argv.slice(2).join(' ');
  if (!['--test-rollback-only','--live-read-only-prediction','--live-read-only-audit',
    '--live-read-only-catalog','--live-install-after-review'].includes(mode))
    throw Error('Exact M1 attention release mode required');
  try {
    const result=mode==='--test-rollback-only' ? await rehearseTest() :
      mode==='--live-read-only-prediction' ? await predictLive() :
      mode==='--live-read-only-audit' ? await readAudit() :
      mode==='--live-read-only-catalog' ? await snapshot() : await installLive();
    if (mode==='--live-read-only-catalog') console.log(JSON.stringify({state:'read_only_catalog',
      project:PROJECT,installed:result.catalog?.installed,
      attentionSelection:result.catalog?.attention_selection,
      attentionResponse:result.catalog?.attention_response,
      ledgerRows:result.ledger?.length,clientFlagEnabled:result.catalog?.client_enabled,
      operatorFlagEnabled:result.catalog?.operator_enabled,providerRequests:0}));
    else console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message);process.exitCode=1; }
}
