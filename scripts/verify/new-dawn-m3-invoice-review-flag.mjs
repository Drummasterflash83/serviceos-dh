/** Drummonds-only operator invoice-review flag. No invoice values or provider requests. */
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import {savedCliToken} from "./learn-test-readiness.mjs";
import {PROJECT,TENANT,VERSION,NAME,FUNCTION_SHA256,INDEX_SHA256,
  reviewedSource,readStage,assess as assessInstall}
  from "./new-dawn-m3-invoice-review-fast-release.mjs";

export const FLAG="new_dawn.invoice_review_candidates_preview";
const RPC="public.new_dawn_invoice_review_candidates(uuid,text)";
const DATE="public.new_dawn_invoice_strict_date(text)";
const INDEX="public.learn_quickbooks_latest_invoice_recent_review";
const RPC_SHA256=FUNCTION_SHA256;
const DATE_SHA256="a70d57bf99c61c5018a1067f16d260eab6cb356cd0e71bb05b3ca4f3200637a9";
const CLIENT_FLAGS=["new_dawn.owner_money","new_dawn.owner_report_review","new_dawn.owner_accounts_report"];
const clientFlags=CLIENT_FLAGS.map(value=>`'${value}'`).join(",");
const enabled=(flag)=>`(select count(*) from public.feature_flags where flag='${flag}' and value='true'::jsonb)`;
const tenantEnabled=(flag)=>`(select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${flag}' and value='true'::jsonb)`;
const otherRows=`exists(select 1 from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid)`;
const clientOn=`exists(select 1 from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb)`;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

const flagScopeSql=`select
 (select count(*)::int from public.feature_flags where flag='${FLAG}') as target_rows,
 ${enabled(FLAG)}::int as target_global,
 ${tenantEnabled(FLAG)}::int as target_tenant,
 (select count(*)::int from public.feature_flags where flag='${FLAG}'
  and tenant_id is distinct from '${TENANT}'::uuid) as other_rows,
 (select count(*)::int from public.feature_flags where flag in (${clientFlags})
  and value='true'::jsonb) as client_money_on,
 to_regclass('public.controlplane_change_log') is not null as audit_log_present,
 (select count(*)=2 from pg_trigger where tgrelid='public.controlplane_change_log'::regclass
  and tgname in ('controlplane_change_log_no_update','controlplane_change_log_no_delete')
  and not tgisinternal and tgenabled='O') as audit_immutable`;
const auditScopeSql=auditId=>`select id::text,tenant_id::text,actor,action,resource_type,
 resource_id,before,after,reason,source,view_as_active,correlation_id
 from public.controlplane_change_log where id='${auditId}'::uuid`;

async function management(token,path,sql,readOnly=true,fetcher=fetch){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${path}`,{
    method:sql?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(60000),
    headers:{Authorization:`Bearer ${token}`,...(sql?{"Content-Type":"application/json"}:{})},
    ...(sql?{body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})}:{})});
  if(!response.ok)throw Error(`m3_invoice_flag_${readOnly?"read":"write"}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error("m3_invoice_flag_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readFlagScope(token=savedCliToken(),auditId=null,fetcher=fetch){
  if(auditId!==null&&!uuid(auditId))throw Error("m3_invoice_flag_audit_id_invalid");
  const [project,flags,audit]=await Promise.all([
    management(token,"",null,true,fetcher),
    management(token,"/database/query/read-only",flagScopeSql,true,fetcher),
    auditId===null?Promise.resolve([]):management(token,"/database/query/read-only",auditScopeSql(auditId),true,fetcher),
  ]);
  return {project,flags,audit};
}
export async function readEnableScope(token=savedCliToken(),auditId=null,fetcher=fetch){
  const [install,scope]=await Promise.all([
    readStage(PROJECT,token,fetcher),readFlagScope(token,auditId,fetcher),
  ]);
  return {...scope,install};
}

export function assessFlagScope(snapshot,enabled,{withdrawal=false}={}){
  const f=snapshot?.flags?.[0];
  if(typeof enabled!=="boolean"||snapshot?.project?.id!==PROJECT||
    snapshot.project.status!=="ACTIVE_HEALTHY"||snapshot.flags?.length!==1||!f||
    (enabled?f.target_rows!==1:![0,1].includes(f.target_rows))||
    f.target_global!==Number(enabled)||f.target_tenant!==Number(enabled)||
    f.other_rows!==0||f.audit_log_present!==true||f.audit_immutable!==true||
    (!withdrawal&&f.client_money_on!==0))
    throw Error("m3_invoice_flag_scope_changed");
  return {state:enabled?"drummonds_operator_invoice_review_only":"operator_invoice_review_off",
    project:PROJECT,tenant:TENANT,operatorFlagEnabled:enabled,
    clientMoneyFlagsEnabled:f.client_money_on!==0,providerRequests:0,invoiceValuesRead:0};
}
export function assessEnableScope(snapshot,enabled){
  const result=assessFlagScope(snapshot,enabled);
  assessInstall(snapshot?.install,true,reviewedSource(),enabled);
  return {...result,sourceVersion:VERSION,sourceSha256:reviewedSource().hash};
}

export function assessAudit(snapshot,auditId,enabled){
  if(!uuid(auditId)||snapshot?.audit?.length!==1)throw Error("m3_invoice_flag_audit_changed");
  const a=snapshot.audit[0],action=`new_dawn.invoice_review_candidates_preview.${enabled?'enable':'disable'}`;
  if(a.id!==auditId||a.tenant_id!==TENANT||
    a.actor!=="codex:delegated-openfolk-operator"||a.action!==action||
    a.resource_type!=="feature_flag"||a.resource_id!==FLAG||
    a.before?.enabled!==!enabled||a.after?.enabled!==enabled||
    a.source!=="codex-release"||a.view_as_active!==false||
    a.correlation_id!==auditId||typeof a.reason!=="string"||!a.reason)
    throw Error("m3_invoice_flag_audit_changed");
  return auditId;
}

/** One scoped flag change and one append-only control-plane audit row. */
export function flagSql(enable,auditId){
  if(typeof enable!=="boolean"||!uuid(auditId))throw Error("m3_invoice_flag_invalid_action");
  const action=`new_dawn.invoice_review_candidates_preview.${enable?'enable':'disable'}`;
  const state=enable?"true":"false";
  const opposite=enable?"false":"true";
  const preflight=enable?`
 if not exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${VERSION}' and name='${NAME}' and array_length(statements,1)=1
    and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${reviewedSource().hash}')
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex')
    is distinct from '${RPC_SHA256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${DATE}')),'UTF8')),'hex')
    is distinct from '${DATE_SHA256}'
  or to_regclass('${INDEX}') is null
  or encode(sha256(convert_to(pg_get_indexdef(to_regclass('${INDEX}')),'UTF8')),'hex')
    is distinct from '${INDEX_SHA256}'
  or not exists(select 1 from pg_index where indexrelid=to_regclass('${INDEX}')
   and indisvalid and indisready)
  or not has_function_privilege('authenticated','${RPC}','execute')
  or has_function_privilege('anon','${RPC}','execute')
  or has_function_privilege('service_role','${RPC}','execute')
  or has_function_privilege('authenticated','${DATE}','execute')
  or has_function_privilege('anon','${DATE}','execute')
  or has_function_privilege('service_role','${DATE}','execute')
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
   and environment='production' and realm_id is not null and confirmed_at is not null
   and status<>'disconnected')<>1
  or (select count(*) from pg_trigger where tgrelid='public.controlplane_change_log'::regclass
   and tgname in ('controlplane_change_log_no_update','controlplane_change_log_no_delete')
   and not tgisinternal and tgenabled='O')<>2
  or ${clientOn} or ${otherRows} or ${enabledFlagCount()}<>0
  or (select count(*) from public.feature_flags where flag='${FLAG}')>1
 then raise exception 'm3_invoice_flag_preflight_changed';end if;`
  :`
 if ${enabledFlagCount()}<>1 or ${tenantEnabled(FLAG)}<>1 or ${otherRows}
  or (select count(*) from public.feature_flags where flag='${FLAG}')<>1
 then raise exception 'm3_invoice_flag_withdraw_preflight_changed';end if;`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
lock table public.controlplane_change_log in share row exclusive mode;
do $m3_invoice_flag$ begin
 if exists(select 1 from public.controlplane_change_log where id='${auditId}'::uuid)
 then raise exception 'm3_invoice_flag_audit_reused';end if;${preflight}
 update public.feature_flags set value='${state}'::jsonb
  where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 ${enable?`if not found then insert into public.feature_flags(tenant_id,flag,value)
  values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);end if;`:
  `if not found then raise exception 'm3_invoice_flag_withdraw_missing';end if;`}
 if ${enabledFlagCount()}<>${Number(enable)} or ${tenantEnabled(FLAG)}<>${Number(enable)}
  or ${otherRows}${enable?` or ${clientOn}`:""}
 then raise exception 'm3_invoice_flag_postcheck_changed';end if;
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,
  resource_id,before,after,reason,correlation_id,view_as_active,source)
 values('${auditId}'::uuid,'${TENANT}'::uuid,'codex:delegated-openfolk-operator',
  '${action}','feature_flag','${FLAG}',jsonb_build_object('enabled',${opposite}),
  jsonb_build_object('enabled',${state}),
  'Reviewed Drummonds operator-only saved invoice candidate switch',
  '${auditId}',false,'codex-release');
 if (select count(*) from public.controlplane_change_log where id='${auditId}'::uuid)<>1
 then raise exception 'm3_invoice_flag_audit_missing';end if;
end $m3_invoice_flag$;
select 'm3-invoice-review-${enable?'enabled':'disabled'}/1' as marker;
commit;`;
}
function enabledFlagCount(){return enabled(FLAG);}

/** Unknown write outcomes receive one fresh read; the write is never replayed. */
export async function switchLive(enable,{token=savedCliToken(),auditId=randomUUID(),
  readEnable=readEnableScope,readFlag=readFlagScope,write}={}){
  if(typeof enable!=="boolean"||!uuid(auditId))throw Error("m3_invoice_flag_invalid_action");
  if(enable)assessEnableScope(await readEnable(token,auditId),false);
  else assessFlagScope(await readFlag(token,auditId),true,{withdrawal:true});
  const writer=write??(sql=>management(token,"/database/query",sql,false));
  let acknowledged=false;
  try{
    const rows=await writer(flagSql(enable,auditId));
    acknowledged=Array.isArray(rows)&&rows.some(row=>row?.marker===
      (enable?"m3-invoice-review-enabled/1":"m3-invoice-review-disabled/1"));
  }catch{/* Read back once; never replay an uncertain write. */}
  let snapshot,result;
  try{
    snapshot=enable?await readEnable(token,auditId):await readFlag(token,auditId);
    result=enable?assessEnableScope(snapshot,true):
      assessFlagScope(snapshot,false,{withdrawal:true});
    assessAudit(snapshot,auditId,enable);
  }catch{throw Error("m3_invoice_flag_outcome_unverified_no_replay");}
  return {...result,auditId,writeAcknowledged:acknowledged,readbackVerified:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT)
      throw Error("explicit_exact_live_project_required");
    const mode=process.argv.slice(2).join(" ");
    if(mode==="--live-read-only"){
      const snapshot=await readEnableScope();
      console.log(JSON.stringify(assessEnableScope(snapshot,
        snapshot.flags?.[0]?.target_tenant===1)));
    }else if(mode==="--live-enable-drummonds-operator-only"){
      if(process.env.NEW_DAWN_M3_ALLOW_FLAG!==FLAG)
        throw Error("explicit_exact_invoice_flag_required");
      console.log(JSON.stringify(await switchLive(true)));
    }else if(mode==="--live-disable-drummonds-operator-only"){
      if(process.env.NEW_DAWN_M3_ALLOW_FLAG!==FLAG)
        throw Error("explicit_exact_invoice_flag_required");
      console.log(JSON.stringify(await switchLive(false)));
    }else throw Error("explicit_operator_invoice_review_action_required");
  }catch(error){console.error(JSON.stringify({state:"m3_invoice_flag_stopped",
    code:error instanceof Error?error.message:"unknown",retryAllowed:false,
    providerRequests:0,invoiceValuesRead:0}));process.exitCode=1;}
}
