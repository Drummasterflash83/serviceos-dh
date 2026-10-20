/** Exact additive M3 report-pair selector release. No flags or provider calls. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";

export const PROJECT="tgbnakbxwcqjeimygroz";
export const TENANT="00000000-0000-0000-0000-000000000001";
export const VERSION="20261108100000";
export const NAME="new_dawn_report_pair_candidates";
export const SOURCE_SHA256="ae5ba9536974b6a94e6478355fb4338279fdee59336d23c63e28f40651a5d53e";
// Prior functions are installed without ledger rows. These definition hashes
// matched a rollback-only TEST install of the reviewed capture/summary sources.
const PRIOR_FUNCTIONS={
  summary_sha256:"b98df331e0613be5cc490ed0f8f0f283233378b058433ceb81cfb9e75ea531a4",
  extract_sha256:"a8aa46ebcdbb07e24dfb0d103c37ced3a84b33efb76f77b89e5d0e11e30e8642",
  capture_finish_sha256:"351da00347b7e9a4df4f73bc2619c096afb2af593a3ca136ece2dd90f864996c",
};
const SIGNATURE="public.learn_quickbooks_report_pair_candidates(uuid,text)";
const CLIENT_FLAGS=["new_dawn.owner_money","new_dawn.owner_report_review",
  "new_dawn.owner_accounts_report"];
const quote=value=>"'"+value.replaceAll("'","''")+"'";

export function reviewedSource(){
  const source=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),"utf8");
  const hash=createHash("sha256").update(source).digest("hex");
  if(hash!==SOURCE_SHA256||!/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source)||
    !/\ncommit;\s*$/i.test(source))throw Error("m3_pairs_reviewed_source_changed");
  const body=source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,"").replace(/\ncommit;\s*$/i,"");
  if(/^\s*(begin|commit);\s*$/im.test(body))throw Error("m3_pairs_nested_transaction");
  return {source,body,hash};
}

const ledgerSql=`select version::text,name,array_length(statements,1) as statement_count,
 encode(sha256(convert_to(statements[1],'UTF8')),'hex') as source_sha256
 from supabase_migrations.schema_migrations where version::text='${VERSION}'`;
const catalogSql=`select
 to_regprocedure('${SIGNATURE}') is not null as installed,
 coalesce((select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${SIGNATURE}')),false) as security_definer,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('authenticated','${SIGNATURE}','execute') end as authenticated_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('anon','${SIGNATURE}','execute') end as anon_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false else
  has_function_privilege('service_role','${SIGNATURE}','execute') end as service_grant,
 to_regprocedure('public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)') is not null as summary_rpc,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
  'public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)')),'UTF8')),'hex') as summary_sha256,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
  'public.learn_quickbooks_report_summary_extract(jsonb,jsonb)')),'UTF8')),'hex') as extract_sha256,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
  'public.learn_quickbooks_report_finish(uuid,text)')),'UTF8')),'hex') as capture_finish_sha256,
 exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as active_tenant,
 (select count(*)::int from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
  and environment='production' and realm_id is not null and confirmed_at is not null
  and status in ('active','paused')) as confirmed_connections,
 (select count(*)::int from public.feature_flags where flag in
  (${CLIENT_FLAGS.map(quote).join(",")}) and value='true'::jsonb) as client_flags_on,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='new_dawn.job_home_accounts_preview' and value='true'::jsonb) as home_operator_on,
 (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='new_dawn.report_summary_preview' and value='true'::jsonb) as report_preview_on`;
const countsSql=`select
 (select count(*)::bigint from public.learn_quickbooks_report_requests where tenant_id='${TENANT}'::uuid) as report_requests,
 (select count(*)::bigint from public.learn_quickbooks_report_receipts where tenant_id='${TENANT}'::uuid) as report_receipts,
 (select count(*)::bigint from public.learn_quickbooks_finance_events where tenant_id='${TENANT}'::uuid) as finance_events`;

export function assess(snapshot,installed,source=reviewedSource(),operatorPreviewEnabled=false){
  if(snapshot?.project?.id!==PROJECT||snapshot.project.status!=="ACTIVE_HEALTHY")
    throw Error("m3_pairs_live_project_changed");
  if(!Array.isArray(snapshot.ledger)||snapshot.ledger.length!==Number(installed))
    throw Error("m3_pairs_ledger_changed");
  if(installed){
    const row=snapshot.ledger[0];
    if(String(row?.version)!==VERSION||row.name!==NAME||row.statement_count!==1||
      row.source_sha256!==source.hash)throw Error("m3_pairs_receipt_changed");
  }
  const c=snapshot.catalog?.[0];
  if(snapshot.catalog?.length!==1||!c||c.installed!==installed||
    c.security_definer!==installed||c.authenticated_grant!==installed||
    c.anon_grant!==false||c.service_grant!==false||c.summary_rpc!==true||
    c.active_tenant!==true||c.confirmed_connections!==1||c.client_flags_on!==0||
    c.home_operator_on!==Number(operatorPreviewEnabled)||
    c.report_preview_on!==1)throw Error("m3_pairs_boundary_changed");
  if(Object.entries(PRIOR_FUNCTIONS).some(([key,hash])=>c[key]!==hash))
    throw Error("m3_pairs_prerequisite_function_changed");
  const counts=snapshot.counts?.[0];
  if(snapshot.counts?.length!==1||!["report_requests","report_receipts","finance_events"]
    .every(key=>Number.isSafeInteger(Number(counts?.[key]))&&Number(counts[key])>=0))
    throw Error("m3_pairs_counts_unconfirmed");
  return {state:installed?"installed_default_off_readback":"exact_m3_pairs_ready",
    version:VERSION,sourceSha256:source.hash,providerRequests:0,
    clientMoneyFlagsEnabled:false,operatorPreviewEnabled,
    reportRequests:Number(counts.report_requests),
    reportReceipts:Number(counts.report_receipts),financeEvents:Number(counts.finance_events)};
}

export function releaseSql(file=reviewedSource()){
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $m3_pairs_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('${SIGNATURE}') is not null
  or to_regprocedure('public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)') is null
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
   'public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)')),'UTF8')),'hex')
   is distinct from '${PRIOR_FUNCTIONS.summary_sha256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
   'public.learn_quickbooks_report_summary_extract(jsonb,jsonb)')),'UTF8')),'hex')
   is distinct from '${PRIOR_FUNCTIONS.extract_sha256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
   'public.learn_quickbooks_report_finish(uuid,text)')),'UTF8')),'hex')
   is distinct from '${PRIOR_FUNCTIONS.capture_finish_sha256}'
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
   and environment='production' and realm_id is not null and confirmed_at is not null
   and status in ('active','paused'))<>1
  or exists(select 1 from public.feature_flags where flag in (${CLIENT_FLAGS.map(quote).join(",")})
   and value='true'::jsonb)
  or exists(select 1 from public.feature_flags where flag='new_dawn.job_home_accounts_preview'
   and value='true'::jsonb)
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='new_dawn.report_summary_preview' and value='true'::jsonb)<>1
 then raise exception 'm3_pairs_install_preflight_changed';end if;
end $m3_pairs_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.source)}]);
select '${VERSION}' as installed_m3_pairs_version;
commit;`;
}

async function management(project,token,path,query,readOnly=true,fetcher=fetch){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
    method:query?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,...(query?{"Content-Type":"application/json"}:{})},
    ...(query?{body:JSON.stringify({query,...(readOnly?{}:{read_only:false})})}:{})});
  if(!response.ok)throw Error(`m3_pairs_management_${readOnly?"read":"write"}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error("m3_pairs_management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}
export async function readStage(project,token,fetcher=fetch){
  if(project!==PROJECT)throw Error("exact_live_project_required");
  const q=sql=>management(project,token,"/database/query/read-only",sql,true,fetcher);
  return {project:await management(project,token,"",null,true,fetcher),
    ledger:await q(ledgerSql),catalog:await q(catalogSql),counts:await q(countsSql)};
}
export async function installLive({project=PROJECT,token=savedCliToken(),read=readStage,write}={}){
  if(project!==PROJECT)throw Error("exact_live_project_required");
  const file=reviewedSource();
  const before=await read(project,token);
  assess(before,false,file);
  const writer=write??(sql=>management(project,token,"/database/query",sql,false));
  let acknowledged=false;
  try{
    const rows=await writer(releaseSql(file));
    acknowledged=Array.isArray(rows)&&rows.some(row=>row?.installed_m3_pairs_version===VERSION);
  }catch{/* Unknown outcome is read back once; never replay an uncertain write. */}
  let after;
  try{after=await read(project,token);}
  catch{throw Error("m3_pairs_install_outcome_unverified_no_replay");}
  let result;
  try{
    result=assess(after,true,file);
    if(result.reportRequests!==Number(before.counts[0].report_requests)||
      result.reportReceipts!==Number(before.counts[0].report_receipts)||
      result.financeEvents!==Number(before.counts[0].finance_events))
      throw Error("m3_pairs_install_counts_changed");
  }catch{throw Error("m3_pairs_install_outcome_unverified_no_replay");}
  return {...result,ledgerReadbackVerified:true,writeAcknowledged:acknowledged};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT)
      throw Error("explicit_exact_live_project_required");
    const mode=process.argv.slice(2).join(" ");
    if(mode==="--live-read-only"){
      const snapshot=await readStage(PROJECT,savedCliToken());
      console.log(JSON.stringify(assess(snapshot,snapshot.ledger?.length===1,
        reviewedSource(),snapshot.catalog?.[0]?.home_operator_on===1)));
    }else if(mode==="--live-install-exact")console.log(JSON.stringify(await installLive()));
    else throw Error("explicit_exact_m3_pairs_action_required");
  }catch(error){
    console.error(JSON.stringify({state:"m3_pairs_release_stopped",
      code:error instanceof Error?error.message:"unknown",retryAllowed:false,providerRequests:0}));
    process.exitCode=1;
  }
}
