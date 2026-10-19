/** Drummonds-only OpenFolk saved-accounts preview flag. No client money or provider GET. */
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { PROJECT,TENANT,VERSION,NAME,reviewedSource,readStage } from "./new-dawn-m3-report-pairs-release.mjs";

export const FLAG="new_dawn.job_home_accounts_preview";
const SIGNATURE="public.learn_quickbooks_report_pair_candidates(uuid,text)";
const SELECTOR_SHA256="8ecba7c16d0d4fa25399e81f9c33440197ae807c6d189489b0f8b130146b479d";
const CLIENT_FLAGS=["new_dawn.owner_money","new_dawn.owner_report_review",
  "new_dawn.owner_accounts_report"];
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const clientFlags=CLIENT_FLAGS.map(quote).join(",");

const flagsSql=`select
 (select count(*)::int from public.feature_flags where flag='${FLAG}' and value='true'::jsonb) as operator_global,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='${FLAG}' and value='true'::jsonb) as operator_tenant,
 (select count(*)::int from public.feature_flags where tenant_id<>'${TENANT}'::uuid
  and flag='${FLAG}') as other_tenant_rows,
 (select count(*)::int from public.feature_flags where flag in (${clientFlags})
  and value='true'::jsonb) as client_money_on,
 (select count(*)::int from public.feature_flags where flag='new_dawn.report_summary_preview'
  and value='true'::jsonb) as report_global,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='new_dawn.report_summary_preview' and value='true'::jsonb) as report_tenant,
 (select count(*)::int from public.feature_flags where flag='new_dawn.source_job_home.operator_preview'
  and value='true'::jsonb) as job_global,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='new_dawn.source_job_home.operator_preview' and value='true'::jsonb) as job_tenant`;
const selectorSql=`select encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
 '${SIGNATURE}')),'UTF8')),'hex') as selector_sha256`;
const pairSql=`select exists(
 select 1 from public.learn_quickbooks_report_requests p
 join public.learn_quickbooks_report_receipts pr on pr.request_id=p.id and pr.tenant_id=p.tenant_id
 where p.tenant_id='${TENANT}'::uuid and p.report_kind='ProfitAndLoss'
  and p.state='complete' and p.environment='production' and pr.validation_state='verified'
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
    and ar.validation_state='verified' and ar.header->>'Currency'=pr.header->>'Currency')
 ) as operator_pair_available`;

async function query(project,token,sql,readOnly=true,fetcher=fetch,label="query"){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?"/read-only":""}`,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(60000),
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})});
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const match=typeof problem?.message==="string"?problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/):null;
    throw Error(`m3_home_flag_${label}_${readOnly?"read":"write"}_http_${response.status}_sqlstate_${match?.[1]??"unknown"}`);
  }
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error("m3_home_flag_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}

export async function readLive(token=savedCliToken(),fetcher=fetch){
  const base=await readStage(PROJECT,token,fetcher);
  const [flags,selector,pairs]=await Promise.all([
    query(PROJECT,token,flagsSql,true,fetcher,"flags"),
    query(PROJECT,token,selectorSql,true,fetcher,"selector"),
    query(PROJECT,token,pairSql,true,fetcher,"pairs"),
  ]);
  return {...base,flags,selector,pairs};
}

export function assess(snapshot,enabled){
  if(typeof enabled!=="boolean"||snapshot?.project?.id!==PROJECT||
    snapshot.project.status!=="ACTIVE_HEALTHY"||snapshot.ledger?.length!==1)
    throw Error("m3_home_flag_project_or_ledger_changed");
  const row=snapshot.ledger[0];
  if(String(row?.version)!==VERSION||row.name!==NAME||row.statement_count!==1||
    row.source_sha256!==reviewedSource().hash)throw Error("m3_home_flag_exact_source_changed");
  const c=snapshot.catalog?.[0];
  if(snapshot.catalog?.length!==1||!c||c.installed!==true||c.security_definer!==true||
    c.authenticated_grant!==true||c.anon_grant!==false||c.service_grant!==false||
    c.summary_rpc!==true||c.active_tenant!==true||c.confirmed_connections!==1)
    throw Error("m3_home_flag_schema_changed");
  if(snapshot.selector?.length!==1||snapshot.selector[0]?.selector_sha256!==SELECTOR_SHA256||
    snapshot.pairs?.length!==1||snapshot.pairs[0]?.operator_pair_available!==true)
    throw Error("m3_home_flag_source_unavailable");
  const f=snapshot.flags?.[0];
  if(snapshot.flags?.length!==1||!f||f.operator_global!==Number(enabled)||
    f.operator_tenant!==Number(enabled)||f.other_tenant_rows!==0||
    f.client_money_on!==0||f.report_global!==1||f.report_tenant!==1||
    f.job_global!==1||f.job_tenant!==1)
    throw Error("m3_home_flag_boundary_changed");
  return {state:enabled?"drummonds_operator_accounts_preview_only":"operator_accounts_preview_off",
    project:PROJECT,tenant:TENANT,selectorVersion:VERSION,
    sourceSha256:reviewedSource().hash,clientMoneyFlagsEnabled:false,
    operatorFlagEnabled:enabled,providerRequests:0};
}

/** Withdrawal must remain possible even if reports or selector health later fail. */
export function assessFlagState(snapshot,enabled){
  const f=snapshot?.flags?.[0];
  if(typeof enabled!=="boolean"||snapshot?.project?.id!==PROJECT||
    snapshot.flags?.length!==1||!f||f.operator_global!==Number(enabled)||
    f.operator_tenant!==Number(enabled)||f.other_tenant_rows!==0)
    throw Error("m3_home_flag_withdrawal_scope_changed");
  return {state:enabled?"drummonds_operator_accounts_preview_only":"operator_accounts_preview_off",
    project:PROJECT,tenant:TENANT,operatorFlagEnabled:enabled,providerRequests:0};
}

export function flagSql(enable){
  if(typeof enable!=="boolean")throw Error("m3_home_flag_invalid_action");
  if(!enable)return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
do $m3_home_withdraw$ begin
 if (select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)<>1
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='${FLAG}' and value='true'::jsonb)<>1
  or exists(select 1 from public.feature_flags where tenant_id<>'${TENANT}'::uuid and flag='${FLAG}')
 then raise exception 'm3_home_flag_withdraw_preflight_changed';end if;
 update public.feature_flags set value='false'::jsonb
  where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 if not found or exists(select 1 from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)
 then raise exception 'm3_home_flag_withdraw_postcheck_changed';end if;
end $m3_home_withdraw$;
select 'm3-home-accounts-disabled/1' as marker;
commit;`;
  const before=Number(!enable),after=Number(enable);
  const change=enable?`update public.feature_flags set value='true'::jsonb
   where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
   if not found then insert into public.feature_flags(tenant_id,flag,value)
    values('${TENANT}'::uuid,'${FLAG}','true'::jsonb);end if;`
    :`update public.feature_flags set value='false'::jsonb
     where tenant_id='${TENANT}'::uuid and flag='${FLAG}';`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
do $m3_home_flag$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${VERSION}' and name='${NAME}' and array_length(statements,1)=1
    and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${reviewedSource().hash}')
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),'UTF8')),'hex')
    is distinct from '${SELECTOR_SHA256}'
  or not has_function_privilege('authenticated','${SIGNATURE}','execute')
  or has_function_privilege('anon','${SIGNATURE}','execute')
  or has_function_privilege('service_role','${SIGNATURE}','execute')
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
   and environment='production' and realm_id is not null and confirmed_at is not null
   and status in ('active','paused'))<>1
  or exists(select 1 from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='new_dawn.report_summary_preview'
   and value='true'::jsonb)<>1
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='new_dawn.report_summary_preview' and value='true'::jsonb)<>1
  or (select count(*) from public.feature_flags where flag='new_dawn.source_job_home.operator_preview'
   and value='true'::jsonb)<>1
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='new_dawn.source_job_home.operator_preview' and value='true'::jsonb)<>1
  or exists(select 1 from public.feature_flags where tenant_id<>'${TENANT}'::uuid and flag='${FLAG}')
  or (select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)<>${before}
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='${FLAG}' and value='true'::jsonb)<>${before}
 then raise exception 'm3_home_flag_preflight_changed';end if;
 ${change}
 if (select count(*) from public.feature_flags where flag='${FLAG}' and value='true'::jsonb)<>${after}
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='${FLAG}' and value='true'::jsonb)<>${after}
  or exists(select 1 from public.feature_flags where flag in (${clientFlags}) and value='true'::jsonb)
 then raise exception 'm3_home_flag_postcheck_changed';end if;
end $m3_home_flag$;
select '${enable?"m3-home-accounts-enabled/1":"m3-home-accounts-disabled/1"}' as marker;
commit;`;
}

export async function switchLive(enable,{token=savedCliToken(),read=readLive,write}={}){
  if(typeof enable!=="boolean")throw Error("m3_home_flag_invalid_action");
  const before=await read(token);
  if(enable)assess(before,false);else assessFlagState(before,true);
  const writer=write??(sql=>query(PROJECT,token,sql,false));
  let acknowledged=false;
  try{
    const rows=await writer(flagSql(enable));
    acknowledged=Array.isArray(rows)&&rows.some(row=>row?.marker===
      (enable?"m3-home-accounts-enabled/1":"m3-home-accounts-disabled/1"));
  }catch{/* Unknown write outcome gets one readback, never replay. */}
  let result;
  try{
    const after=await read(token);
    result=enable?assess(after,true):assessFlagState(after,false);
  }
  catch{throw Error("m3_home_flag_outcome_unverified_no_replay");}
  return {...result,writeAcknowledged:acknowledged,readbackVerified:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT)
      throw Error("explicit_exact_live_project_required");
    const mode=process.argv.slice(2).join(" ");
    if(mode==="--live-read-only"){
      const snapshot=await readLive();
      console.log(JSON.stringify(assess(snapshot,snapshot.flags?.[0]?.operator_tenant===1)));
    }
    else if(mode==="--live-enable-drummonds-operator-only")console.log(JSON.stringify(await switchLive(true)));
    else if(mode==="--live-disable-drummonds-operator-only")console.log(JSON.stringify(await switchLive(false)));
    else throw Error("explicit_operator_accounts_action_required");
  }catch(error){console.error(JSON.stringify({state:"m3_home_flag_stopped",
    code:error instanceof Error?error.message:"unknown",retryAllowed:false,providerRequests:0}));
    process.exitCode=1;}
}
