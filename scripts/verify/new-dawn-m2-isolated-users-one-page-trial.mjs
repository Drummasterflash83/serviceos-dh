/** One bounded Drummonds source-user page, with a separately audited app gate.
 * This controller changes only the isolated page flag. It never calls Commusoft.
 */
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';
import { PROJECT, TENANT } from './new-dawn-m2-live-preflight.mjs';

const FLAG='new_dawn.m2_isolated_users_page';
const LEGACY='learn.inputs.commusoft.users.enabled';
const SOURCE='new-dawn-m2-isolated-users-page-trial';
const REASON='Chris authorised one bounded, read-only Drummonds Commusoft source-user page for M2; no staff identity or provider setting change';
const ACTOR='system:openfolk-release-controller';
const quote=value=>`'${value.replaceAll("'","''")}'`;

export const statusSql=`select
 (select coalesce(jsonb_agg(jsonb_build_object('flag',flag,'value',value) order by flag),'[]'::jsonb)
  from public.feature_flags where tenant_id='${TENANT}'::uuid and flag in
  ('learn.enabled','learn.inputs.commusoft.enabled','${LEGACY}','${FLAG}')) flags,
 (select count(*)::int from public.feature_flags where flag='${FLAG}' and value='true'::jsonb) enabled_tenants,
 (select count(*)::int from public.new_dawn_commusoft_users_page_reads where tenant_id='${TENANT}'::uuid) page_requests,
 (select coalesce(jsonb_agg(jsonb_build_object('state',state,'record_count',record_count,
  'has_more',has_more,'request_id',id,'checked_at',checked_at) order by created_at),'[]'::jsonb)
  from public.new_dawn_commusoft_users_page_reads where tenant_id='${TENANT}'::uuid) page_states,
 (select count(*)::int from public.new_dawn_commusoft_users_page_versions where tenant_id='${TENANT}'::uuid) versions,
 (select count(*)::int from public.controlplane_change_log where tenant_id='${TENANT}'::uuid
  and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_enabled') arms,
 (select count(*)::int from public.controlplane_change_log where tenant_id='${TENANT}'::uuid
  and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_disabled') disarms,
 (select count(*)::int from public.controlplane_change_log where tenant_id='${TENANT}'::uuid
  and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_aborted') aborts,
 (select coalesce(jsonb_agg(jsonb_build_object('action',action,'id',id,'created_at',created_at)
  order by created_at),'[]'::jsonb) from public.controlplane_change_log
  where tenant_id='${TENANT}'::uuid and source='${SOURCE}') flag_audit,
 (select count(*)::int from public.provider_connections where tenant_id='${TENANT}'::uuid
  and provider='commusoft' and status='configured' and auth_mode='private_api_key'
  and revoked_at is null and verified_at is not null) connections,
 (select encode(sha256(convert_to(pg_get_functiondef(
  'public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)'::regprocedure),'UTF8')),'hex')) start_hash`;

const EXPECTED_START='77d837d144b2100b025b86e8adcb1dd04fd176c811f75609c087c286c850b9a1';
export function assess(row,stage) {
  const flags=Object.fromEntries((row?.flags??[]).map(f=>[f.flag,f.value]));
  const base=flags['learn.enabled']===true && flags['learn.inputs.commusoft.enabled']===true;
  const legacy=flags[LEGACY]===undefined || flags[LEGACY]===false;
  const expected=stage==='before' ? (row.aborts===0 ? flags[FLAG]===undefined : flags[FLAG]===false) :
    stage==='armed' ? flags[FLAG]===true : flags[FLAG]===false;
  const auditValid=(row.aborts===0 || row.aborts===1) && row.arms===row.aborts+(stage==='before'?0:1) &&
    row.disarms===(stage==='closed'?1:0) && row.arms<=2 &&
    row.flag_audit?.length===row.arms+row.aborts+row.disarms;
  const pageStates=row?.page_states??[];
  if(!base || !legacy || !expected || row.start_hash!==EXPECTED_START ||
    row.connections!==1 || row.enabled_tenants!==(stage==='armed'?1:0) ||
    !auditValid ||
    !(stage==='armed' ? [0,1].includes(row.page_requests) :
      row.page_requests===(stage==='closed'?1:0)) ||
    row.versions<0 || row.versions>10 || pageStates.length!==row.page_requests ||
    (stage==='before' && row.versions!==0) ||
    (stage==='armed' && row.page_requests===0 && row.versions!==0) ||
    (stage==='armed' && row.page_requests===1 &&
      (pageStates[0]?.state!=='complete' || row.versions!==pageStates[0]?.record_count)) ||
    (stage==='closed' && (pageStates[0]?.state!=='complete' ||
      row.versions!==pageStates[0]?.record_count)))
    throw Error(`isolated_users_trial_${stage}_scope_changed`);
  return {state:stage,isolatedGateEnabled:stage==='armed',legacyUsersImportEnabled:false,
    pageRequests:row.page_requests,retainedVersions:row.versions,
    pageState:pageStates[0]?.state??null,recordCount:pageStates[0]?.record_count??null,
    hasMore:pageStates[0]?.has_more??null,auditEntries:row.flag_audit?.length??0};
}

export function switchSql(enable,rollback=false) {
  if(typeof enable!=='boolean')throw Error('isolated_users_trial_mode_invalid');
  const pre=enable?`(
     (not exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}')
      and not exists(select 1 from public.controlplane_change_log where tenant_id='${TENANT}'::uuid and source='${SOURCE}'))
     or (exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='false'::jsonb)
      and (select count(*) from public.controlplane_change_log where tenant_id='${TENANT}'::uuid and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_enabled')=1
      and (select count(*) from public.controlplane_change_log where tenant_id='${TENANT}'::uuid and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_aborted')=1
      and not exists(select 1 from public.controlplane_change_log where tenant_id='${TENANT}'::uuid and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_disabled')))
    and not exists(select 1 from public.new_dawn_commusoft_users_page_reads where tenant_id='${TENANT}'::uuid)
    and not exists(select 1 from public.new_dawn_commusoft_users_page_versions where tenant_id='${TENANT}'::uuid)`:
   `exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb)
    and (select count(*) from public.new_dawn_commusoft_users_page_reads where tenant_id='${TENANT}'::uuid)=1
    and (select count(*) from public.new_dawn_commusoft_users_page_reads where tenant_id='${TENANT}'::uuid and state='complete')=1
    and (select count(*) from public.new_dawn_commusoft_users_page_versions where tenant_id='${TENANT}'::uuid)<=10
    and (select count(*) from public.controlplane_change_log where tenant_id='${TENANT}'::uuid and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_enabled') in (1,2)
    and (select count(*) from public.controlplane_change_log where tenant_id='${TENANT}'::uuid and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_enabled')=
      (select count(*) from public.controlplane_change_log where tenant_id='${TENANT}'::uuid and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_aborted')+1
    and not exists(select 1 from public.controlplane_change_log where tenant_id='${TENANT}'::uuid and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_disabled')`;
  const change=enable ? `update public.feature_flags set value='true'::jsonb
    where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='false'::jsonb;
   if not found then insert into public.feature_flags(tenant_id,flag,value)
    values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);end if;`:
   `update public.feature_flags set value='false'::jsonb
    where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb;
    if not found then raise exception 'isolated_users_gate_not_armed';end if;`;
  return `begin;
set local lock_timeout='3s';set local statement_timeout='15s';
lock table public.feature_flags in share row exclusive mode;
lock table public.new_dawn_commusoft_users_page_reads in share row exclusive mode;
do $trial$ begin
 if not (select count(*)=2 from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb)
  or exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='${LEGACY}' and value is distinct from 'false'::jsonb)
  or exists(select 1 from public.feature_flags where flag='${FLAG}' and value='true'::jsonb
   and tenant_id<>'${TENANT}'::uuid)
  or (select count(*) from public.provider_connections where tenant_id='${TENANT}'::uuid
   and provider='commusoft' and status='configured' and auth_mode='private_api_key'
   and revoked_at is null and verified_at is not null)<>1
  or encode(sha256(convert_to(pg_get_functiondef(
   'public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)'::regprocedure),'UTF8')),'hex')<>'${EXPECTED_START}'
  or not (${pre}) then raise exception 'isolated_users_trial_preflight_changed';end if;
 ${change}
 insert into public.controlplane_change_log
  (tenant_id,actor,action,resource_type,resource_id,before,after,reason,source,view_as_active)
 values('${TENANT}'::uuid,'${ACTOR}',
  'new_dawn.m2.users_page_gate_${enable?'enabled':'disabled'}','feature_flags','${FLAG}',
  jsonb_build_object('enabled',${!enable}),jsonb_build_object('enabled',${enable}),
  ${quote(REASON)},'${SOURCE}',false);
 if (select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)<>${enable?1:0}
  then raise exception 'isolated_users_trial_postflight_changed';end if;
end $trial$;
select 'isolated-users-page-${enable?'armed':'closed'}/1' as marker;
${rollback?'rollback':'commit'};`;
}

/** Emergency disarm when no complete page can be proved. A recently claimed
 * request must settle first; switching its guard off mid-GET would lose proof. */
export function failCloseSql() {return `begin;
set local lock_timeout='3s';set local statement_timeout='15s';
lock table public.feature_flags in share row exclusive mode;
lock table public.new_dawn_commusoft_users_page_reads in share row exclusive mode;
do $fail_closed$ begin
 if not exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='${FLAG}' and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)<>1
  or (select count(*) from public.controlplane_change_log where tenant_id='${TENANT}'::uuid
   and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_enabled') not in (1,2)
  or (select count(*) from public.controlplane_change_log where tenant_id='${TENANT}'::uuid
   and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_enabled')<>
    (select count(*) from public.controlplane_change_log where tenant_id='${TENANT}'::uuid
     and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_aborted')+1
  or exists(select 1 from public.controlplane_change_log where tenant_id='${TENANT}'::uuid
   and source='${SOURCE}' and action='new_dawn.m2.users_page_gate_disabled')
  or (select count(*) from public.new_dawn_commusoft_users_page_reads where tenant_id='${TENANT}'::uuid)>1
  or exists(select 1 from public.new_dawn_commusoft_users_page_reads
   where tenant_id='${TENANT}'::uuid and state='claimed'
    and claimed_at>clock_timestamp()-interval '45 seconds')
  then raise exception 'isolated_users_trial_fail_close_preflight_changed';end if;
 update public.feature_flags set value='false'::jsonb
  where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb;
 if not found then raise exception 'isolated_users_trial_fail_close_not_armed';end if;
 insert into public.controlplane_change_log
  (tenant_id,actor,action,resource_type,resource_id,before,after,reason,source,view_as_active)
 values('${TENANT}'::uuid,'${ACTOR}','new_dawn.m2.users_page_gate_aborted',
  'feature_flags','${FLAG}','{"enabled":true}'::jsonb,'{"enabled":false}'::jsonb,
  'Bounded source-user page not confirmed; isolated gate closed without retry',
  '${SOURCE}',false);
end $fail_closed$;
select 'isolated-users-page-fail-closed/1' as marker;
commit;`;
}

async function query(token,sql,write=false) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query${write?'':'/read-only'}`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,...(write?{read_only:false}:{})})});
  if(!response.ok)throw Error(`isolated_users_trial_${write?'write':'read'}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1048576)throw Error('isolated_users_trial_response_oversized');
  return JSON.parse(bytes.toString('utf8'));
}
export async function readLive(token=savedCliToken()) {
  const rows=await query(token,statusSql);
  if(rows?.length!==1)throw Error('isolated_users_trial_readback_unavailable');
  return rows[0];
}
export async function switchLive(enable,token=savedCliToken()) {
  const pre=assess(await readLive(token),enable?'before':'armed');
  if(!enable && (pre.pageRequests!==1 || pre.pageState!=='complete'))
    throw Error('isolated_users_trial_page_not_complete');
  let acknowledged=false;
  try {const rows=await query(token,switchSql(enable),true);
    acknowledged=rows?.some?.(r=>r.marker===`isolated-users-page-${enable?'armed':'closed'}/1`)===true;
  } catch { /* Unknown transaction outcome: read once; never replay blindly. */ }
  const result=assess(await readLive(token),enable?'armed':'closed');
  return {...result,acknowledged};
}
export async function failCloseLive(token=savedCliToken()) {
  const before=await readLive(token);
  if(before.enabled_tenants!==1 || ![1,2].includes(before.arms) ||
    before.arms!==before.aborts+1 || before.disarms!==0 ||
    before.page_requests>1 || before.page_states?.some?.(r=>r.state==='claimed'))
    throw Error('isolated_users_trial_fail_close_not_safe');
  let acknowledged=false;
  try {const rows=await query(token,failCloseSql(),true);
    acknowledged=rows?.some?.(r=>r.marker==='isolated-users-page-fail-closed/1')===true;
  } catch { /* Read back once; never replay blindly. */ }
  const after=await readLive(token);
  const flag=after.flags?.find?.(f=>f.flag===FLAG);
  if(flag?.value!==false || after.enabled_tenants!==0 || after.arms!==before.arms ||
    after.aborts!==before.aborts+1 ||
    after.flag_audit?.filter?.(a=>a.action==='new_dawn.m2.users_page_gate_aborted').length!==after.aborts)
    throw Error('isolated_users_trial_fail_close_unverified');
  return {state:'fail_closed',acknowledged,providerRequests:after.page_requests,
    pageStates:after.page_states,retainedVersions:after.versions};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {if(process.env.NEW_DAWN_M2_ALLOW_PROJECT!==PROJECT)throw Error('exact_live_project_required');
  const [mode]=process.argv.slice(2);
  if(mode==='--live-read-only'){
    const row=await readLive();console.log(JSON.stringify({state:'read_only',flags:row.flags,
      pageRequests:row.page_requests,pageStates:row.page_states,versions:row.versions,
      arms:row.arms,disarms:row.disarms,aborts:row.aborts,enabledTenants:row.enabled_tenants}));
  } else if(mode==='--live-rollback-rehearsal'){
    const token=savedCliToken();assess(await readLive(token),'before');
    const rows=await query(token,switchSql(true,true),true);
    if(!rows?.some?.(r=>r.marker==='isolated-users-page-armed/1'))throw Error('rollback_rehearsal_unconfirmed');
    assess(await readLive(token),'before');
    console.log(JSON.stringify({state:'rollback_rehearsal_passed',providerRequests:0}));
  } else if(mode==='--live-arm-once')console.log(JSON.stringify(await switchLive(true)));
  else if(mode==='--live-close-once')console.log(JSON.stringify(await switchLive(false)));
  else if(mode==='--live-fail-close')console.log(JSON.stringify(await failCloseLive()));
  else throw Error('exact_mode_required');
 } catch(error){console.error(JSON.stringify({state:'isolated_users_trial_stopped',
   code:error instanceof Error?error.message:'unknown',retryAllowed:false}));process.exitCode=1;}
}
