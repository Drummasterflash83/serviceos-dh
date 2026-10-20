/** Exact Drummonds-only switch for the private saved A/R 91+ review cue. No provider GET. */
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { PROJECT,TENANT,VERSION,NAME,reviewedSource } from "./new-dawn-m3-report-pairs-release.mjs";
import { readLive as readAccountsLive,assess as assessAccounts } from "./new-dawn-m3-job-home-accounts-flag.mjs";

export const FLAG="new_dawn.aged_debt_exception_preview";
const SIGNATURE="public.learn_quickbooks_report_pair_candidates(uuid,text)";
const SELECTOR_SHA256="8ecba7c16d0d4fa25399e81f9c33440197ae807c6d189489b0f8b130146b479d";
const CLIENT_FLAGS=["new_dawn.owner_money","new_dawn.owner_report_review","new_dawn.owner_accounts_report"];
const clientFlags=CLIENT_FLAGS.map(value=>`'${value}'`).join(",");
const enabled=(flag)=>`(select count(*) from public.feature_flags where flag='${flag}' and value='true'::jsonb)`;
const tenantEnabled=(flag)=>`(select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${flag}' and value='true'::jsonb)`;
const otherRows=`exists(select 1 from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid)`;
const clientOn=`exists(select 1 from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb)`;

const scopeSql=`select
 (select count(*)::int from public.feature_flags where flag='${FLAG}') as target_rows,
 ${enabled(FLAG)}::int as target_global,
 ${tenantEnabled(FLAG)}::int as target_tenant,
 (select count(*)::int from public.feature_flags where flag='${FLAG}'
  and tenant_id is distinct from '${TENANT}'::uuid) as other_rows,
 (select count(*)::int from public.feature_flags where flag in (${clientFlags})
  and value='true'::jsonb) as client_money_on,
 ${enabled("new_dawn.job_home_accounts_preview")}::int as accounts_global,
 ${tenantEnabled("new_dawn.job_home_accounts_preview")}::int as accounts_tenant,
 ${enabled("new_dawn.report_summary_preview")}::int as report_global,
 ${tenantEnabled("new_dawn.report_summary_preview")}::int as report_tenant,
 ${enabled("new_dawn.source_job_home.operator_preview")}::int as job_global,
 ${tenantEnabled("new_dawn.source_job_home.operator_preview")}::int as job_tenant`;

async function management(token,path,sql,readOnly=true,fetcher=fetch){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${path}`,{
    method:sql?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(60000),
    headers:{Authorization:`Bearer ${token}`,...(sql?{"Content-Type":"application/json"}:{})},
    ...(sql?{body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})}:{})});
  if(!response.ok)throw Error(`m3_aged_flag_${readOnly?"read":"write"}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error("m3_aged_flag_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

/** A separate read-only request is used after the one-write transaction. */
export async function readFlagScope(token=savedCliToken(),fetcher=fetch){
  const [project,flags]=await Promise.all([
    management(token,"",null,true,fetcher),
    management(token,"/database/query/read-only",scopeSql,true,fetcher),
  ]);
  return {project,flags};
}

export async function readEnableScope(token=savedCliToken(),fetcher=fetch){
  const [accounts,scope]=await Promise.all([
    readAccountsLive(token,fetcher),readFlagScope(token,fetcher),
  ]);
  return {...scope,accounts};
}

export function assessFlagScope(snapshot,enabled,{withdrawal=false}={}){
  const f=snapshot?.flags?.[0];
  if(typeof enabled!=="boolean"||snapshot?.project?.id!==PROJECT||
    snapshot.project.status!=="ACTIVE_HEALTHY"||snapshot.flags?.length!==1||!f||
    (enabled?f.target_rows!==1:![0,1].includes(f.target_rows))||
    f.target_global!==Number(enabled)||
    f.target_tenant!==Number(enabled)||f.other_rows!==0||
    (!withdrawal&&f.client_money_on!==0))
    throw Error("m3_aged_flag_scope_changed");
  return {state:enabled?"drummonds_operator_aged_review_only":"operator_aged_review_off",
    project:PROJECT,tenant:TENANT,operatorFlagEnabled:enabled,
    clientMoneyFlagsEnabled:f.client_money_on!==0,providerRequests:0};
}

export function assessEnableScope(snapshot,enabled){
  assessAccounts(snapshot?.accounts,true);
  const result=assessFlagScope(snapshot,enabled);
  const f=snapshot.flags[0];
  if([f.accounts_global,f.accounts_tenant,f.report_global,f.report_tenant,
    f.job_global,f.job_tenant].some(value=>value!==1))
    throw Error("m3_aged_flag_parent_preview_changed");
  return {...result,selectorVersion:VERSION,sourceSha256:reviewedSource().hash};
}

export function flagSql(enable){
  if(typeof enable!=="boolean")throw Error("m3_aged_flag_invalid_action");
  if(!enable)return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
do $m3_aged_withdraw$ begin
 if ${enabled(FLAG)}<>1 or ${tenantEnabled(FLAG)}<>1 or ${otherRows}
  or (select count(*) from public.feature_flags where flag='${FLAG}')<>1
 then raise exception 'm3_aged_flag_withdraw_preflight_changed';end if;
 update public.feature_flags set value='false'::jsonb
  where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 if not found or ${enabled(FLAG)}<>0
 then raise exception 'm3_aged_flag_withdraw_postcheck_changed';end if;
end $m3_aged_withdraw$;
select 'm3-aged-review-disabled/1' as marker;
commit;`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
do $m3_aged_flag$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${VERSION}' and name='${NAME}' and array_length(statements,1)=1
    and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${reviewedSource().hash}')
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),'UTF8')),'hex')
    is distinct from '${SELECTOR_SHA256}'
  or not has_function_privilege('authenticated','${SIGNATURE}','execute')
  or has_function_privilege('anon','${SIGNATURE}','execute')
  or has_function_privilege('service_role','${SIGNATURE}','execute')
  or to_regprocedure('public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)') is null
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
   and environment='production' and realm_id is not null and confirmed_at is not null
   and status in ('active','paused'))<>1
  or ${clientOn}
  or ${enabled("new_dawn.job_home_accounts_preview")}<>1
  or ${tenantEnabled("new_dawn.job_home_accounts_preview")}<>1
  or ${enabled("new_dawn.report_summary_preview")}<>1
  or ${tenantEnabled("new_dawn.report_summary_preview")}<>1
  or ${enabled("new_dawn.source_job_home.operator_preview")}<>1
  or ${tenantEnabled("new_dawn.source_job_home.operator_preview")}<>1
  or ${otherRows} or ${enabled(FLAG)}<>0
  or (select count(*) from public.feature_flags where flag='${FLAG}')>1
 then raise exception 'm3_aged_flag_preflight_changed';end if;
 update public.feature_flags set value='true'::jsonb
  where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);end if;
 if ${enabled(FLAG)}<>1 or ${tenantEnabled(FLAG)}<>1 or ${otherRows} or ${clientOn}
 then raise exception 'm3_aged_flag_postcheck_changed';end if;
end $m3_aged_flag$;
select 'm3-aged-review-enabled/1' as marker;
commit;`;
}

/** Unknown write outcomes are never retried; one fresh read decides the result. */
export async function switchLive(enable,{token=savedCliToken(),readEnable=readEnableScope,
  readFlag=readFlagScope,write}={}){
  if(typeof enable!=="boolean")throw Error("m3_aged_flag_invalid_action");
  if(enable)assessEnableScope(await readEnable(token),false);
  else assessFlagScope(await readFlag(token),true,{withdrawal:true});
  const writer=write??(sql=>management(token,"/database/query",sql,false));
  let acknowledged=false;
  try{
    const rows=await writer(flagSql(enable));
    acknowledged=Array.isArray(rows)&&rows.some(row=>row?.marker===
      (enable?"m3-aged-review-enabled/1":"m3-aged-review-disabled/1"));
  }catch{/* Read back once; do not replay the uncertain write. */}
  let result;
  try{
    result=enable?assessEnableScope(await readEnable(token),true)
      :assessFlagScope(await readFlag(token),false,{withdrawal:true});
  }catch{throw Error("m3_aged_flag_outcome_unverified_no_replay");}
  return {...result,writeAcknowledged:acknowledged,readbackVerified:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT)
      throw Error("explicit_exact_live_project_required");
    const mode=process.argv.slice(2).join(" ");
    if(mode==="--live-read-only"){
      const snapshot=await readEnableScope();
      console.log(JSON.stringify(assessEnableScope(snapshot,snapshot.flags?.[0]?.target_tenant===1)));
    }
    else if(mode==="--live-enable-drummonds-operator-only")console.log(JSON.stringify(await switchLive(true)));
    else if(mode==="--live-disable-drummonds-operator-only")console.log(JSON.stringify(await switchLive(false)));
    else throw Error("explicit_operator_aged_review_action_required");
  }catch(error){console.error(JSON.stringify({state:"m3_aged_flag_stopped",
    code:error instanceof Error?error.message:"unknown",retryAllowed:false,providerRequests:0}));
    process.exitCode=1;}
}
