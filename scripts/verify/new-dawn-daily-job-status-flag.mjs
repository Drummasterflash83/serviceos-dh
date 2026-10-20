/** One audited Drummonds-only switch for read-only daily Commusoft status GETs. */
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {savedCliToken} from './learn-test-readiness.mjs';

export const PROJECT='tgbnakbxwcqjeimygroz';
export const TENANT='00000000-0000-0000-0000-000000000001';
export const FLAG='new_dawn.daily_job_status.enabled';
const VERSION='20261110190000';
const NAME='new_dawn_daily_job_status_observation';
const CLAIM='public.new_dawn_job_status_daily_claim()';
const CURRENT='public.new_dawn_job_status_daily_current(uuid,uuid)';
const enabled=`(select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)`;
const tenantEnabled=`(select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='true'::jsonb)`;
const scopeSql=`select
 to_regprocedure('${CLAIM}') is not null and to_regprocedure('${CURRENT}') is not null as installed,
 (select count(*) from supabase_migrations.schema_migrations where version::text='${VERSION}' and name='${NAME}')::int as migration_rows,
 (select count(*)::int from public.feature_flags where flag='${FLAG}') as target_rows,
 ${enabled}::int as global_on,${tenantEnabled}::int as tenant_on,
 (select count(*)::int from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid) as other_rows,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb) as input_flags_on,
 (select count(*)::int from public.provider_connections where tenant_id='${TENANT}'::uuid and provider='commusoft' and status='configured' and auth_mode='private_api_key' and revoked_at is null and verified_at is not null) as connections,
 (select count(*)=2 from pg_trigger where tgrelid='public.controlplane_change_log'::regclass and tgname in ('controlplane_change_log_no_update','controlplane_change_log_no_delete') and tgenabled='O') as audit_immutable`;
const auditSql=id=>`select id::text,tenant_id::text,actor,action,resource_type,resource_id,before,after,correlation_id,source from public.controlplane_change_log where id='${id}'::uuid`;

async function management(token,path,sql,readOnly=true,fetcher=fetch){
 const response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${path}`,{
  method:sql?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(45000),
  headers:{Authorization:`Bearer ${token}`,...(sql?{'Content-Type':'application/json'}:{})},
  ...(sql?{body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})}:{})});
 if(!response.ok)throw Error(`daily_status_${readOnly?'read':'write'}_http_${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>1024*1024)throw Error('daily_status_response_oversized');
 return JSON.parse(bytes.toString('utf8'));
}

export async function readLive(token=savedCliToken(),auditId=null,fetcher=fetch){
 const [project,rows,audit]=await Promise.all([
  management(token,'',null,true,fetcher),
  management(token,'/database/query/read-only',scopeSql,true,fetcher),
  auditId?management(token,'/database/query/read-only',auditSql(auditId),true,fetcher):Promise.resolve([])]);
 return {project,scope:rows?.[0],audit};
}

export function assess(snapshot,on,{activation=false}={}){
 const s=snapshot?.scope;
 if(snapshot?.project?.id!==PROJECT||snapshot.project.status!=='ACTIVE_HEALTHY'||
  !s||s.installed!==true||s.migration_rows!==1||s.audit_immutable!==true||
  s.global_on!==Number(on)||s.tenant_on!==Number(on)||s.other_rows!==0||
  (on?s.target_rows!==1:![0,1].includes(s.target_rows))||
  (activation&&(s.input_flags_on!==2||s.connections!==1)))
  throw Error('daily_status_scope_changed');
 return {project:PROJECT,tenant:TENANT,enabled:on,providerRequests:0};
}

export function flagSql(on,id){
 if(typeof on!=='boolean'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
  throw Error('daily_status_invalid_action');
 const state=on?'true':'false';
 return `begin;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
lock table public.controlplane_change_log in share row exclusive mode;
do $daily_flag$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}' and name='${NAME}')
  or to_regprocedure('${CLAIM}') is null or to_regprocedure('${CURRENT}') is null
  or exists(select 1 from public.controlplane_change_log where id='${id}'::uuid)
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from pg_trigger where tgrelid='public.controlplane_change_log'::regclass and tgname in ('controlplane_change_log_no_update','controlplane_change_log_no_delete') and tgenabled='O')<>2
  or (select count(*) from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid)<>0
  or ${enabled}<>${Number(!on)} or ${tenantEnabled}<>${Number(!on)}
  or (select count(*) from public.feature_flags where flag='${FLAG}')<>${on?0:1}
  ${on?`or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb)<>2
  or (select count(*) from public.provider_connections where tenant_id='${TENANT}'::uuid and provider='commusoft' and status='configured' and auth_mode='private_api_key' and revoked_at is null and verified_at is not null)<>1`:''}
 then raise exception 'daily_status_flag_preflight_changed';end if;
 ${on?`insert into public.feature_flags(tenant_id,flag,value) values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);`:
 `update public.feature_flags set value='false'::jsonb where tenant_id='${TENANT}'::uuid and flag='${FLAG}';`}
 if ${enabled}<>${Number(on)} or ${tenantEnabled}<>${Number(on)}
 then raise exception 'daily_status_flag_postcheck_changed';end if;
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,before,after,reason,correlation_id,view_as_active,source)
 values('${id}'::uuid,'${TENANT}'::uuid,'codex:delegated-openfolk-operator',
  'new_dawn.daily_job_status.${on?'enable':'disable'}','feature_flag','${FLAG}',
  jsonb_build_object('enabled',${!on}),jsonb_build_object('enabled',${on}),
  'Reviewed Drummonds read-only daily Commusoft status observation','${id}',false,'codex-release');
end $daily_flag$;
select 'daily-status-${on?'enabled':'disabled'}/1' as marker;
commit;`;
}

export async function switchLive(on,{token=savedCliToken(),auditId=randomUUID(),fetcher=fetch}={}){
 assess(await readLive(token,null,fetcher),!on,{activation:on});
 let acknowledged=false;
 try{
  const rows=await management(token,'/database/query',flagSql(on,auditId),false,fetcher);
  acknowledged=rows?.some?.(row=>row.marker===`daily-status-${on?'enabled':'disabled'}/1`)===true;
 }catch{/* Never replay an uncertain write. */}
 const after=await readLive(token,auditId,fetcher);
 try{assess(after,on);const a=after.audit?.[0];
  if(after.audit?.length!==1||a.id!==auditId||a.tenant_id!==TENANT||
   a.action!==`new_dawn.daily_job_status.${on?'enable':'disable'}`||
   a.actor!=='codex:delegated-openfolk-operator'||a.resource_id!==FLAG||
   a.before?.enabled!==!on||a.after?.enabled!==on||a.correlation_id!==auditId||
   a.source!=='codex-release')throw Error('audit');
 }catch{throw Error('daily_status_outcome_unverified_no_replay');}
 return {state:on?'drummonds_daily_status_on':'drummonds_daily_status_off',auditId,
  acknowledged,readbackVerified:true,providerRequests:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.NEW_DAWN_DAILY_STATUS_ALLOW_PROJECT!==PROJECT)
   throw Error('explicit_exact_live_project_required');
  const mode=process.argv.slice(2).join(' ');
  const result=mode==='--live-read-only'?await readLive():
   mode==='--live-enable-drummonds'?await switchLive(true):
   mode==='--live-disable-drummonds'?await switchLive(false):
   (()=>{throw Error('exact_daily_status_action_required')})();
  console.log(JSON.stringify(result));
 }catch(error){console.error(JSON.stringify({state:'daily_status_flag_stopped',
  code:error.message,retryAllowed:false}));process.exitCode=1;}
}
