/** Exact M1 SQL release: merged source-home function plus operator-only gate.
 * TEST mode rolls back; LIVE mode requires the reviewed backup-run argument.
 * Neither mode enables a durable feature flag or requests a provider.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { selectionSql } from './new-dawn-m1-live-source-home-performance.mjs';

const LIVE_PROJECT = 'tgbnakbxwcqjeimygroz';
const TENANT = '00000000-0000-0000-0000-000000000001';
const BACKUP_RUN = '39309367057';
const MIGRATIONS = [
  ['20261106210000_new_dawn_source_job_home.sql','55fcb1eaa4bff4a4334e37fd80f6ec0a3ce2786d582597e05a9e931c6af4eba1'],
  ['20261106230000_new_dawn_source_job_home_operator_preview.sql','fcbf37c9e0e7e34ef86c039c5e66b0d48e1179c872e526b6d56cf25416597ae4'],
];
const signature = 'public.new_dawn_source_job_home(uuid,text)';

export function migrationBodies() {
  return MIGRATIONS.map(([filename,digest]) => {
    const source = readFileSync(new URL(`../../supabase/migrations/${filename}`, import.meta.url),'utf8');
    if (createHash('sha256').update(source).digest('hex') !== digest ||
        !/\nbegin;\n/i.test(source) || !/\ncommit;\s*$/i.test(source))
      throw Error(`Reviewed M1 migration changed: ${filename}`);
    return source.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n');
  });
}

const catalogSql = `select
 to_regprocedure('${signature}') is null as function_absent,
 position('new_dawn.source_job_home.operator_preview' in
  coalesce(pg_get_functiondef(to_regprocedure('${signature}')),''))>0 as operator_gate_present,
 position('new_dawn.source_job_home' in
  coalesce(pg_get_functiondef(to_regprocedure('${signature}')),''))>0 as client_gate_present,
 coalesce(has_function_privilege('authenticated',to_regprocedure('${signature}'),'EXECUTE'),false) as authenticated_execute,
 coalesce(has_function_privilege('anon',to_regprocedure('${signature}'),'EXECUTE'),false) as anon_execute,
 coalesce(has_function_privilege('service_role',to_regprocedure('${signature}'),'EXECUTE'),false) as service_execute,
 (select count(*)::integer from public.feature_flags where
  flag='new_dawn.source_job_home' and value='true'::jsonb) as client_enabled,
 (select count(*)::integer from public.feature_flags where
  flag='new_dawn.source_job_home.operator_preview' and value='true'::jsonb) as operator_enabled,
 (select count(*)::integer from public.feature_flags where
  flag in ('new_dawn.source_job_home','new_dawn.source_job_home.operator_preview')) as flag_rows`;

const fixture = `do $fixture$
declare tenant uuid;fixture_actor uuid;got jsonb;started timestamptz;elapsed_ms integer;
begin
 select j.tenant_id into tenant from public.jobs j
  join public.learn_business_input_current_links l on l.tenant_id=j.tenant_id
   and l.entity_id=j.id and l.entity_kind='job' and l.entity_table='jobs'
   and l.provider='commusoft' and l.collection='jobs'
  join public.tenants t on t.id=j.tenant_id and t.status='active'
  order by j.tenant_id limit 1;
 if tenant is null then raise exception 'm1_fixture_source_tenant_missing';end if;
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
  then raise exception 'm1_fixture_operator_missing';end if;
 update public.feature_flags set value='false'::jsonb where tenant_id=tenant
  and flag='new_dawn.source_job_home';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(tenant,'new_dawn.source_job_home','false'::jsonb);end if;
 update public.feature_flags set value='false'::jsonb where tenant_id=tenant
  and flag='new_dawn.source_job_home.operator_preview';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(tenant,'new_dawn.source_job_home.operator_preview','false'::jsonb);end if;
 begin
  perform public.new_dawn_source_job_home(tenant,'Rollback-only operator flag denial');
  raise exception 'operator_flag_off_admitted' using errcode='XX001';
 exception when sqlstate '42501' then if sqlerrm<>'new_dawn_source_home_disabled' then raise;end if;end;
 update public.feature_flags set value='true'::jsonb where tenant_id=tenant
  and flag='new_dawn.source_job_home.operator_preview';
 started:=clock_timestamp();
 got:=public.new_dawn_source_job_home(tenant,'Rollback-only OpenFolk M1 preview');
 elapsed_ms:=round(extract(epoch from clock_timestamp()-started)*1000)::integer;
 if got->>'version'<>'new-dawn-source-job-home/1' or got->>'actor_id'<>fixture_actor::text
  or got->>'tenant_id'<>tenant::text or jsonb_array_length(got->'rows')>24
  or not exists(select 1 from public.controlplane_change_log log
   where log.id=(got->>'audit_id')::uuid and log.tenant_id=tenant
    and log.actor=fixture_actor::text and log.action='client_jobs.source_home_preview'
    and log.reason='Rollback-only OpenFolk M1 preview' and log.view_as_active=false) then
  raise exception 'm1_fixture_operator_contract_failed';end if;
 if elapsed_ms>15000 then raise exception 'm1_fixture_operator_over_15s';end if;
 begin
  perform public.new_dawn_source_job_home(tenant,null);
  raise exception 'client_flag_off_admitted' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.new_dawn_source_job_home(tenant,'Foreign actor denial');
  raise exception 'foreign_actor_admitted' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 create temporary table new_dawn_m1_release_receipt on commit drop as
  select 'new-dawn-m1-operator-gate/1'::text marker,elapsed_ms operator_ms,
   jsonb_array_length(got->'rows')::integer row_count,
   (got->>'reviewed_job_count')::integer reviewed_count;
end $fixture$;`;

export function releaseSql(mode) {
  if (mode !== 'test-rollback' && mode !== 'live-install') throw Error('M1 release mode invalid');
  const [base,operatorGate] = migrationBodies();
  const setup = `begin;\nset local lock_timeout='3s';\nset local statement_timeout='45s';\n`;
  const preflight = `do $preflight$ begin
 if to_regprocedure('${signature}') is not null then raise exception 'm1_source_home_already_installed';end if;
 if exists(select 1 from public.feature_flags where
  flag in ('new_dawn.source_job_home','new_dawn.source_job_home.operator_preview')
  and value='true'::jsonb) then raise exception 'm1_source_home_flag_already_enabled';end if;
end $preflight$;\n`;
  const assertion = `do $assert$ begin
 if to_regprocedure('${signature}') is null
  or position('new_dawn.source_job_home.operator_preview' in
   pg_get_functiondef('${signature}'::regprocedure))=0
  or not has_function_privilege('authenticated','${signature}','EXECUTE')
  or has_function_privilege('anon','${signature}','EXECUTE')
  or has_function_privilege('service_role','${signature}','EXECUTE')
  or exists(select 1 from public.feature_flags where
   flag in ('new_dawn.source_job_home','new_dawn.source_job_home.operator_preview')
   and value='true'::jsonb) then raise exception 'm1_source_home_install_contract_failed';end if;
end $assert$;\n`;
  if (mode === 'test-rollback') return `${setup}${preflight}${base}${operatorGate}${assertion}${fixture}
select marker,operator_ms,row_count,reviewed_count from new_dawn_m1_release_receipt;
rollback;`;
  return `${setup}${preflight}${base}${operatorGate}${assertion}
select 'new-dawn-m1-source-home-installed/1' as marker;
commit;`;
}

async function query(token, project, sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? '/read-only' : ''}`, {
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,...(readOnly ? {} : {read_only:false})}),
    redirect:'error',signal:AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const reported = typeof problem?.code === 'string' ? problem.code : '';
    const embedded = typeof problem?.message === 'string' ? problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] : null;
    const code = /^[A-Z0-9]{5}$/.test(reported) ? reported : embedded ?? 'unknown';
    throw Error(`M1 ${readOnly ? 'catalog' : 'transaction'} failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  return response.json();
}

export async function rehearse() {
  const token=savedCliToken();
  const before=(await query(token,TEST_PROJECT,catalogSql,true))[0];
  if (!before?.function_absent || before.client_enabled !== 0 || before.operator_enabled !== 0)
    throw Error('TEST M1 preflight changed');
  let rows,error;
  try { rows=await query(token,TEST_PROJECT,releaseSql('test-rollback'),false); }
  catch (cause) { error=cause; }
  const after=(await query(token,TEST_PROJECT,catalogSql,true))[0];
  if (JSON.stringify(before)!==JSON.stringify(after))
    throw Error('TEST M1 rollback catalog changed');
  if (error) throw error;
  const receipt=rows?.find?.((row)=>row?.marker==='new-dawn-m1-operator-gate/1');
  if (!receipt || !Number.isInteger(receipt.operator_ms) || receipt.row_count>24)
    throw Error('TEST M1 rollback receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0,...receipt};
}

export async function installAfterVerifiedBackup() {
  const token=savedCliToken();
  const before=(await query(token,LIVE_PROJECT,catalogSql,true))[0];
  if (!before?.function_absent || before.client_enabled !== 0 || before.operator_enabled !== 0)
    throw Error('LIVE M1 preflight changed; no install attempted');
  let rows,error;
  try { rows=await query(token,LIVE_PROJECT,releaseSql('live-install'),false); }
  catch (cause) { error=cause; }
  const after=(await query(token,LIVE_PROJECT,catalogSql,true))[0];
  if (!after || after.function_absent || !after.operator_gate_present || !after.client_gate_present ||
      !after.authenticated_execute || after.anon_execute || after.service_execute ||
      after.client_enabled!==0 || after.operator_enabled!==0)
    throw Error('LIVE M1 installation requires inspection; never retry automatically');
  if (error) return {state:'installed_response_uncertain_requires_inspection',project:LIVE_PROJECT,
    providerRequests:0,clientFlagEnabled:false,operatorFlagEnabled:false};
  if (!rows?.some?.((row)=>row?.marker==='new-dawn-m1-source-home-installed/1'))
    throw Error('LIVE M1 installation receipt missing; inspect before retry');
  return {state:'installed_flags_off',project:LIVE_PROJECT,providerRequests:0,
    clientFlagEnabled:false,operatorFlagEnabled:false,backupRun:BACKUP_RUN};
}

export async function readLiveCatalog() {
  const after=(await query(savedCliToken(),LIVE_PROJECT,catalogSql,true))[0];
  if (!after) throw Error('LIVE M1 catalog readback missing');
  return {state:after.function_absent ? 'not_installed' : 'installed',project:LIVE_PROJECT,
    operatorGatePresent:after.operator_gate_present,clientGatePresent:after.client_gate_present,
    authenticatedExecute:after.authenticated_execute,anonExecute:after.anon_execute,
    serviceExecute:after.service_execute,clientFlagEnabled:after.client_enabled,
    operatorFlagEnabled:after.operator_enabled,providerRequests:0};
}

export function candidateFreshnessSql() {
  const selection=selectionSql();
  const end=selection.indexOf('\nselect (select count(*)::integer from valid) reviewed_count,');
  if (end<0) throw Error('M1 candidate source selection changed');
  const cte=selection.slice(0,end);
  return `begin transaction read only;\nset local statement_timeout='15s';\n${cte}
select count(*)::integer page_count,
 min(source_observed_at) oldest_source_observed_at,
 max(source_observed_at) newest_source_observed_at,
 count(*) filter(where lower(btrim(fields->>'status'))='open')::integer recorded_open,
 count(*) filter(where lower(btrim(fields->>'status'))='pending')::integer recorded_pending,
 count(*) filter(where lower(btrim(fields->>'status'))='ongoing')::integer recorded_ongoing,
 count(*) filter(where fields->>'status' is null)::integer recorded_unknown
from rows;\nrollback;`;
}

export async function readCandidateFreshness() {
  const token=savedCliToken();
  const before=(await query(token,LIVE_PROJECT,catalogSql,true))[0];
  if (!before || before.client_enabled!==0 || before.operator_enabled!==0)
    throw Error('LIVE M1 candidate readback expects both flags OFF');
  const rows=await query(token,LIVE_PROJECT,candidateFreshnessSql(),false);
  const after=(await query(token,LIVE_PROJECT,catalogSql,true))[0];
  if (JSON.stringify(before)!==JSON.stringify(after))
    throw Error('LIVE M1 catalog changed during candidate readback');
  const row=rows?.[0];
  if (!row || !Number.isInteger(row.page_count) || row.page_count<0 || row.page_count>24 ||
      !['recorded_open','recorded_pending','recorded_ongoing','recorded_unknown']
        .every((key)=>Number.isInteger(row[key]) && row[key]>=0 && row[key]<=row.page_count))
    throw Error('LIVE M1 candidate freshness receipt invalid');
  return {state:'saved_candidate_freshness_read_only',project:LIVE_PROJECT,providerRequests:0,
    ...row,limitation:'These are retained source observation times and saved job statuses, not current Commusoft status.'};
}

if (process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
  const mode=process.argv.slice(2).join(' ');
  if (mode!=='--test-rollback-only' && mode!=='--live-catalog-read-only' &&
      mode!=='--live-candidate-freshness-read-only' &&
      mode!==`--live-install-after-verified-backup-${BACKUP_RUN}`)
    throw Error('Use exact reviewed M1 TEST, LIVE catalog, or verified-backup LIVE mode');
  try { console.log(JSON.stringify(await (mode==='--test-rollback-only' ? rehearse() :
    mode==='--live-catalog-read-only' ? readLiveCatalog() :
    mode==='--live-candidate-freshness-read-only' ? readCandidateFreshness() : installAfterVerifiedBackup()))); }
  catch (error) { console.error(error.message);process.exitCode=1; }
}
