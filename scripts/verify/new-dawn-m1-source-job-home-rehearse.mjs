/** Rollback-only hosted TEST rehearsal. No provider request or lasting flag/function. */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const migration = readFileSync(new URL('../../supabase/migrations/20261106210000_new_dawn_source_job_home.sql', import.meta.url), 'utf8');
if (!/\nbegin;\n/i.test(migration) || !/\ncommit;\s*$/i.test(migration))
  throw Error('Source home migration transaction wrapper changed');
const body = migration.replace(/\nbegin;\n/i, '\n').replace(/\ncommit;\s*$/i, '\n');
const signature = 'public.new_dawn_source_job_home(uuid,text)';
const catalogSql = `select to_regprocedure('${signature}') is null as function_absent,
 count(*)::integer as flag_rows,
 md5(coalesce(string_agg(tenant_id::text||':'||value::text,',' order by tenant_id),'') ) as flag_fingerprint
 from public.feature_flags where flag='new_dawn.source_job_home'`;

export function rehearsalSql() {
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $preflight$ begin
 if to_regprocedure('${signature}') is not null then raise exception 'source_home_already_installed';end if;
end $preflight$;
${body}
do $fixture$
declare tenant uuid;fixture_actor uuid;client_actor uuid;got jsonb;started timestamptz;
 operator_ms integer:=null;client_ms integer:=null;client_tested boolean:=false;
begin
 if has_function_privilege('anon','${signature}','EXECUTE')
  or has_function_privilege('service_role','${signature}','EXECUTE')
  or not has_function_privilege('authenticated','${signature}','EXECUTE') then
  raise exception 'source_home_grants_invalid';end if;
 select j.tenant_id into tenant from public.jobs j
  join public.learn_business_input_current_links l on l.tenant_id=j.tenant_id
   and l.entity_id=j.id and l.entity_kind='job' and l.entity_table='jobs'
   and l.provider='commusoft' and l.collection='jobs'
  join public.tenants t on t.id=j.tenant_id and t.status='active'
  order by j.tenant_id limit 1;
 if tenant is null then select id into tenant from public.tenants where status='active' order by id limit 1;end if;
 if tenant is null then raise exception 'source_home_test_tenant_missing';end if;
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
  then raise exception 'source_home_test_operator_missing';end if;
 -- This transient flag change is undone by the outer ROLLBACK.
 update public.feature_flags set value='false'::jsonb where tenant_id=tenant and flag='new_dawn.source_job_home';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(tenant,'new_dawn.source_job_home','false'::jsonb);end if;
 begin
  perform public.new_dawn_source_job_home(tenant,'Rollback-only flag denial');
  raise exception 'source_home_flag_off_admitted' using errcode='XX001';
 exception when sqlstate '42501' then
  if sqlerrm<>'new_dawn_source_home_disabled' then raise;end if;
 end;
 update public.feature_flags set value='true'::jsonb
  where tenant_id=tenant and flag='new_dawn.source_job_home';
 started:=clock_timestamp();
 got:=public.new_dawn_source_job_home(tenant,'Rollback-only operator review');
 operator_ms:=round(extract(epoch from clock_timestamp()-started)*1000)::integer;
 if got->>'version'<>'new-dawn-source-job-home/1' or got->>'actor_id'<>fixture_actor::text
  or got->>'tenant_id'<>tenant::text or jsonb_array_length(got->'rows')>24
  or (got->>'reviewed_job_count')::integer<jsonb_array_length(got->'rows')
  or not exists(select 1 from public.controlplane_change_log log
   where log.id=(got->>'audit_id')::uuid and log.tenant_id=tenant and log.actor=fixture_actor::text
    and action='client_jobs.source_home_preview') then
  raise exception 'source_home_operator_contract_failed';end if;
 if operator_ms>15000 then raise exception 'source_home_operator_over_15s';end if;
 begin
  perform public.new_dawn_source_job_home(gen_random_uuid(),'Rollback-only wrong tenant');
  raise exception 'source_home_wrong_tenant_admitted' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.new_dawn_source_job_home(tenant,null);
  raise exception 'source_home_foreign_actor_admitted' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 perform set_config('request.jwt.claim.role','anon',true);
 begin
  perform public.new_dawn_source_job_home(tenant,null);
  raise exception 'source_home_anon_admitted' using errcode='XX001';
 exception when sqlstate '42501' then null;end;
 select p.id into client_actor from public.profiles p
  join auth.users u on u.id=p.id and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
  where p.tenant_id=tenant and p.role in ('owner','admin')
   and not exists(select 1 from public.platform_authority_grants g
    where g.profile_id=p.id and g.permission in ('platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp())
   and not exists(select 1 from public.view_as_context v
    where v.actor_user_id=p.id and v.ended_at is null
     and (v.expires_at is null or v.expires_at>clock_timestamp()))
  order by p.id limit 1;
 if client_actor is not null then
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',client_actor::text,true);
  started:=clock_timestamp();
  got:=public.new_dawn_source_job_home(tenant,null);
  client_ms:=round(extract(epoch from clock_timestamp()-started)*1000)::integer;
  if got->>'actor_id'<>client_actor::text or jsonb_array_length(got->'rows')>24
   or not exists(select 1 from public.controlplane_change_log
    where id=(got->>'audit_id')::uuid and action='client_jobs.source_home_read') then
   raise exception 'source_home_client_contract_failed';end if;
  if client_ms>15000 then raise exception 'source_home_client_over_15s';end if;
  client_tested:=true;
 end if;
 create temporary table new_dawn_m1_rehearsal_result on commit drop as
  select jsonb_build_object('marker','new-dawn-m1-source-home/1',
   'row_count',jsonb_array_length(got->'rows'),
   'reviewed_count',(got->>'reviewed_job_count')::integer,
   'operator_ms',operator_ms,'client_ms',client_ms,
   'client_positive_tested',client_tested) receipt;
end $fixture$;
select receipt from new_dawn_m1_rehearsal_result;
rollback;`;
}

async function query(token, sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? '/read-only' : ''}`, {
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,...(readOnly ? {} : {read_only:false})}),
    redirect:'error',signal:AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code = typeof problem?.code === 'string' && /^[A-Z0-9]{5}$/.test(problem.code) ? problem.code : 'unknown';
    throw Error(`TEST source home rehearsal failed (HTTP ${response.status}, SQLSTATE ${code}, ${String(problem?.message ?? '').slice(0,180)})`);
  }
  return response.json();
}

export async function rehearse() {
  const token = savedCliToken();
  const before = (await query(token,catalogSql,true))[0];
  if (!before?.function_absent) throw Error('TEST source home function already installed');
  let rows,error;
  try { rows = await query(token,rehearsalSql(),false); }
  catch (cause) { error = cause; }
  const after = (await query(token,catalogSql,true))[0];
  if (!after?.function_absent || before.flag_rows !== after.flag_rows ||
      before.flag_fingerprint !== after.flag_fingerprint)
    throw Error('TEST source home rollback not verified');
  if (error) throw error;
  const receipt = rows?.find?.((row) => row?.receipt?.marker === 'new-dawn-m1-source-home/1')?.receipt;
  if (!receipt) throw Error('TEST source home receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0,...receipt};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.slice(2).join(' ') !== '--test-rollback-only')
    throw Error('Exact TEST rollback-only mode required');
  try { console.log(JSON.stringify(await rehearse())); }
  catch (error) { console.error(error.message);process.exitCode=1; }
}
