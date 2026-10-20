/** Drummonds-only operator margin switch. Client money and provider reads stay off. */
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

export const PROJECT='tgbnakbxwcqjeimygroz';
export const TENANT='00000000-0000-0000-0000-000000000001';
export const FLAG='new_dawn.report_margin_preview';
const VERSION='20261109100000';
const NAME='new_dawn_accounts_margin_preview';
const SOURCE_SHA256='beb907fe598df16238a04a7e218c31205bf58b0f06328c7f9ee535aeef3d9fae';
const FUNCTION_SHA256='8fea235331db857fb38c7cb21f99f7829050daab1fcdfbd7d43d5972463b6385';
const SIGNATURE='public.learn_quickbooks_accounts_margin_preview(uuid,uuid,uuid,text)';
const clientFlags="'new_dawn.owner_money','new_dawn.owner_report_review','new_dawn.owner_accounts_report'";
const enabled=flag=>`(select count(*) from public.feature_flags where flag='${flag}' and value='true'::jsonb)`;
const tenantEnabled=flag=>`(select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${flag}' and value='true'::jsonb)`;
const otherRows=`exists(select 1 from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid)`;
const clientOn=`exists(select 1 from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb)`;
const sourcePair=`exists(select 1 from public.learn_quickbooks_report_requests p
 join public.learn_quickbooks_report_receipts pr on pr.request_id=p.id and pr.tenant_id=p.tenant_id
 where p.tenant_id='${TENANT}'::uuid and p.report_kind='ProfitAndLoss'
  and p.state='complete' and p.environment='production' and pr.validation_state='verified'
  and pr.response_sha256 ~ '^[0-9a-f]{64}$'
  and exists(select 1 from public.platform_authority_grants g where g.profile_id=p.actor_id
   and g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp())
  and exists(select 1 from public.learn_quickbooks_report_requests a
   join public.learn_quickbooks_report_receipts ar on ar.request_id=a.id and ar.tenant_id=a.tenant_id
   where a.tenant_id=p.tenant_id and a.actor_id=p.actor_id and a.connection_id=p.connection_id
    and a.environment=p.environment and a.realm_id=p.realm_id
    and a.report_kind='AgedReceivables' and a.state='complete'
    and a.report_date=p.period_end and a.aging_method='Report_Date'
    and ar.validation_state='verified' and ar.response_sha256 ~ '^[0-9a-f]{64}$'
    and ar.header->>'Currency'=pr.header->>'Currency')
 )`;
const scopeSql=`select
 (select count(*)::int from public.feature_flags where flag='${FLAG}') as target_rows,
 ${enabled(FLAG)}::int as target_global,${tenantEnabled(FLAG)}::int as target_tenant,
 (select count(*)::int from public.feature_flags where flag='${FLAG}'
  and tenant_id is distinct from '${TENANT}'::uuid) as other_rows,
 (select count(*)::int from public.feature_flags where flag in (${clientFlags})
  and value='true'::jsonb) as client_money_on,
 ${enabled('new_dawn.job_home_accounts_preview')}::int as accounts_global,
 ${tenantEnabled('new_dawn.job_home_accounts_preview')}::int as accounts_tenant,
 ${enabled('new_dawn.report_summary_preview')}::int as report_global,
 ${tenantEnabled('new_dawn.report_summary_preview')}::int as report_tenant`;
const sourceSql=`select
 exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${VERSION}' and name='${NAME}' and array_length(statements,1)=1
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${SOURCE_SHA256}') as exact_ledger,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),'UTF8')),'hex') as function_sha256,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('authenticated','${SIGNATURE}','execute') end as authenticated_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('anon','${SIGNATURE}','execute') end as anon_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('service_role','${SIGNATURE}','execute') end as service_grant,
 exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as tenant_active,
 (select count(*)::int from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
  and environment='production' and realm_id is not null and confirmed_at is not null
  and status in ('active','paused')) as production_connections,
 ${sourcePair} as saved_pair_available`;

async function management(token,path,sql,readOnly=true,fetcher=fetch){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${path}`,{
    method:sql?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(60000),
    headers:{Authorization:`Bearer ${token}`,...(sql?{'Content-Type':'application/json'}:{})},
    ...(sql?{body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})}:{})});
  if(!response.ok)throw Error(`m3_margin_flag_${readOnly?'read':'write'}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error('m3_margin_flag_response_oversized');
  return JSON.parse(bytes.toString('utf8'));
}

/** Withdrawal does not depend on report availability or any other flag. */
export async function readFlagScope(token=savedCliToken(),fetcher=fetch){
  const [project,flags]=await Promise.all([
    management(token,'',null,true,fetcher),
    management(token,'/database/query/read-only',scopeSql,true,fetcher),
  ]);
  return {project,flags};
}
export async function readEnableScope(token=savedCliToken(),fetcher=fetch){
  const [scope,source]=await Promise.all([
    readFlagScope(token,fetcher),
    management(token,'/database/query/read-only',sourceSql,true,fetcher),
  ]);
  return {...scope,source};
}

export function assessFlagScope(snapshot,on){
  const f=snapshot?.flags?.[0];
  if(typeof on!=='boolean'||snapshot?.project?.id!==PROJECT||
    snapshot.project.status!=='ACTIVE_HEALTHY'||snapshot.flags?.length!==1||!f||
    (on?f.target_rows!==1:![0,1].includes(f.target_rows))||
    f.target_global!==Number(on)||f.target_tenant!==Number(on)||f.other_rows!==0)
    throw Error('m3_margin_flag_scope_changed');
  return {state:on?'drummonds_operator_margin_only':'operator_margin_off',
    project:PROJECT,tenant:TENANT,operatorFlagEnabled:on,providerRequests:0};
}
export function assessEnableScope(snapshot,on){
  const scoped=assessFlagScope(snapshot,on);
  const f=snapshot.flags[0],s=snapshot.source?.[0];
  if(snapshot.source?.length!==1||!s||s.exact_ledger!==true||
    s.function_sha256!==FUNCTION_SHA256||s.authenticated_grant!==true||
    s.anon_grant!==false||s.service_grant!==false||s.tenant_active!==true||
    s.production_connections!==1||s.saved_pair_available!==true||
    f.client_money_on!==0||[f.accounts_global,f.accounts_tenant,
      f.report_global,f.report_tenant].some(value=>value!==1))
    throw Error('m3_margin_flag_source_changed');
  return {...scoped,clientMoneyFlagsEnabled:false,sourcePairVerified:true,
    exactFunctionSha256:FUNCTION_SHA256};
}

export function flagSql(turnOn){
  if(typeof turnOn!=='boolean')throw Error('m3_margin_flag_invalid_action');
  if(!turnOn)return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
do $m3_margin_withdraw$ begin
 if ${enabled(FLAG)}<>1 or ${tenantEnabled(FLAG)}<>1 or ${otherRows}
  or (select count(*) from public.feature_flags where flag='${FLAG}')<>1
 then raise exception 'm3_margin_withdraw_preflight_changed';end if;
 update public.feature_flags set value='false'::jsonb
  where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 if not found or ${enabled(FLAG)}<>0
 then raise exception 'm3_margin_withdraw_postcheck_changed';end if;
end $m3_margin_withdraw$;
select 'm3-margin-disabled/1' as marker;
commit;`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
do $m3_margin_enable$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${VERSION}' and name='${NAME}' and array_length(statements,1)=1
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${SOURCE_SHA256}')
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),'UTF8')),'hex')
    is distinct from '${FUNCTION_SHA256}'
  or not has_function_privilege('authenticated','${SIGNATURE}','execute')
  or has_function_privilege('anon','${SIGNATURE}','execute')
  or has_function_privilege('service_role','${SIGNATURE}','execute')
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
    and environment='production' and realm_id is not null and confirmed_at is not null
    and status in ('active','paused'))<>1
  or not ${sourcePair} or ${clientOn}
  or ${enabled('new_dawn.job_home_accounts_preview')}<>1
  or ${tenantEnabled('new_dawn.job_home_accounts_preview')}<>1
  or ${enabled('new_dawn.report_summary_preview')}<>1
  or ${tenantEnabled('new_dawn.report_summary_preview')}<>1
  or ${otherRows} or ${enabled(FLAG)}<>0
  or (select count(*) from public.feature_flags where flag='${FLAG}')>1
 then raise exception 'm3_margin_enable_preflight_changed';end if;
 update public.feature_flags set value='true'::jsonb
  where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);end if;
 if ${enabled(FLAG)}<>1 or ${tenantEnabled(FLAG)}<>1 or ${otherRows} or ${clientOn}
 then raise exception 'm3_margin_enable_postcheck_changed';end if;
end $m3_margin_enable$;
select 'm3-margin-enabled/1' as marker;
commit;`;
}

/** One write at most: uncertain outcomes get a fresh read, never a replay. */
export async function switchLive(turnOn,{token=savedCliToken(),readEnable=readEnableScope,
  readFlag=readFlagScope,write}={}){
  if(typeof turnOn!=='boolean')throw Error('m3_margin_flag_invalid_action');
  if(turnOn)assessEnableScope(await readEnable(token),false);
  else assessFlagScope(await readFlag(token),true);
  const writer=write??(sql=>management(token,'/database/query',sql,false));
  let acknowledged=false;
  try{
    const rows=await writer(flagSql(turnOn));
    acknowledged=Array.isArray(rows)&&rows.some(row=>row?.marker===
      (turnOn?'m3-margin-enabled/1':'m3-margin-disabled/1'));
  }catch{/* Read once; never replay an uncertain write. */}
  let result;
  try{
    result=turnOn?assessEnableScope(await readEnable(token),true)
      :assessFlagScope(await readFlag(token),false);
  }catch{throw Error('m3_margin_flag_outcome_unverified_no_replay');}
  return {...result,writeAcknowledged:acknowledged,readbackVerified:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT)
      throw Error('explicit_exact_live_project_required');
    const mode=process.argv.slice(2).join(' ');
    if(mode==='--live-read-only'){
      const snapshot=await readEnableScope();
      console.log(JSON.stringify(assessEnableScope(snapshot,snapshot.flags?.[0]?.target_tenant===1)));
    }
    else if(mode==='--live-enable-drummonds-operator-only')
      console.log(JSON.stringify(await switchLive(true)));
    else if(mode==='--live-disable-drummonds-operator-only')
      console.log(JSON.stringify(await switchLive(false)));
    else throw Error('explicit_m3_margin_action_required');
  }catch(error){console.error(JSON.stringify({state:'m3_margin_flag_stopped',
    code:error instanceof Error?error.message:'unknown',retryAllowed:false,providerRequests:0}));
    process.exitCode=1;}
}
