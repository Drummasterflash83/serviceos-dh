/** Exact additive M3 invoice-review SQL release. No flag, invoice read or provider call. */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {savedCliToken} from "./learn-test-readiness.mjs";

export const PROJECT="tgbnakbxwcqjeimygroz";
export const TENANT="00000000-0000-0000-0000-000000000001";
export const VERSION="20261108110000";
export const NAME="new_dawn_invoice_review_candidates";
export const SOURCE_SHA256="1bc934adf50168eb82c6dc139236911cf9ba6d364d921d7ace98b3b46057e0bc";
const RPC_SHA256="f8ca4b3da3f719562b9630a734625b348a000513201fe1100a334f6bd2b50a5c";
const DATE_SHA256="a70d57bf99c61c5018a1067f16d260eab6cb356cd0e71bb05b3ca4f3200637a9";
const RPC="public.new_dawn_invoice_review_candidates(uuid,text)";
const DATE="public.new_dawn_invoice_strict_date(text)";
const CLIENT_FLAGS=["new_dawn.owner_money","new_dawn.owner_report_review",
  "new_dawn.owner_accounts_report"];
const quote=value=>"'"+value.replaceAll("'","''")+"'";

export function reviewedSource(){
  const source=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),"utf8");
  const hash=createHash("sha256").update(source).digest("hex");
  if(hash!==SOURCE_SHA256||!/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source)||
    !/\ncommit;\s*$/i.test(source))throw Error("m3_invoice_review_source_changed");
  const body=source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,"").replace(/\ncommit;\s*$/i,"");
  if(/^\s*(begin|commit);\s*$/im.test(body))throw Error("m3_invoice_review_nested_transaction");
  return {source,body,hash};
}

const ledgerSql=`select version::text,name,array_length(statements,1) as statement_count,
 encode(sha256(convert_to(statements[1],'UTF8')),'hex') as source_sha256
 from supabase_migrations.schema_migrations where version::text='${VERSION}'`;
const catalogSql=`select
 to_regprocedure('${RPC}') is not null as rpc_installed,
 to_regprocedure('${DATE}') is not null as date_installed,
 coalesce((select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${RPC}')),false) as security_definer,
 case when to_regprocedure('${RPC}') is null then false else
  has_function_privilege('authenticated','${RPC}','execute') end as authenticated_grant,
 case when to_regprocedure('${RPC}') is null then false else
  has_function_privilege('anon','${RPC}','execute') end as anon_grant,
 case when to_regprocedure('${RPC}') is null then false else
  has_function_privilege('service_role','${RPC}','execute') end as service_grant,
 case when to_regprocedure('${DATE}') is null then false else
  has_function_privilege('authenticated','${DATE}','execute') end as date_authenticated_grant,
 case when to_regprocedure('${DATE}') is null then false else
  has_function_privilege('anon','${DATE}','execute') end as date_anon_grant,
 case when to_regprocedure('${DATE}') is null then false else
  has_function_privilege('service_role','${DATE}','execute') end as date_service_grant,
 case when to_regprocedure('${RPC}') is null then null else
  encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex') end as rpc_sha256,
 case when to_regprocedure('${DATE}') is null then null else
  encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${DATE}')),'UTF8')),'hex') end as date_sha256,
 to_regprocedure('public.learn_operator_input_access(uuid,uuid,boolean)') is not null as operator_access,
 to_regprocedure('public.learn_quickbooks_actor_access(uuid,uuid)') is not null as quickbooks_access,
 to_regclass('public.learn_quickbooks_latest') is not null as source_latest,
 to_regclass('public.learn_quickbooks_source_versions') is not null as source_versions,
 to_regclass('public.learn_quickbooks_finance_events') is not null as finance_audit,
 exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as active_tenant,
 (select count(*)::int from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
  and environment='production' and realm_id is not null and confirmed_at is not null
  and status<>'disconnected') as confirmed_connections,
 (select count(*)::int from public.feature_flags where flag in
  (${CLIENT_FLAGS.map(quote).join(",")}) and value='true'::jsonb) as client_flags_on,
 (select count(*)::int from public.feature_flags where flag='new_dawn.invoice_review_candidates_preview'
  and value='true'::jsonb) as invoice_preview_flags_on`;

export function assess(snapshot,installed,source=reviewedSource()){
  if(snapshot?.project?.id!==PROJECT||snapshot.project.status!=="ACTIVE_HEALTHY")
    throw Error("m3_invoice_review_live_project_changed");
  if(!Array.isArray(snapshot.ledger)||snapshot.ledger.length!==Number(installed))
    throw Error("m3_invoice_review_ledger_changed");
  if(installed){
    const row=snapshot.ledger[0];
    if(String(row?.version)!==VERSION||row.name!==NAME||row.statement_count!==1||
      row.source_sha256!==source.hash)throw Error("m3_invoice_review_receipt_changed");
  }
  const c=snapshot.catalog?.[0];
  if(snapshot.catalog?.length!==1||!c||
    c.rpc_installed!==installed||c.date_installed!==installed||
    c.security_definer!==installed||c.authenticated_grant!==installed||
    c.anon_grant!==false||c.service_grant!==false||
    c.date_authenticated_grant!==false||c.date_anon_grant!==false||
    c.date_service_grant!==false||
    c.rpc_sha256!==(installed?RPC_SHA256:null)||
    c.date_sha256!==(installed?DATE_SHA256:null)||
    c.operator_access!==true||c.quickbooks_access!==true||
    c.source_latest!==true||c.source_versions!==true||c.finance_audit!==true||
    c.active_tenant!==true||c.confirmed_connections!==1||
    c.client_flags_on!==0||c.invoice_preview_flags_on!==0)
    throw Error("m3_invoice_review_boundary_changed");
  return {state:installed?"installed_default_off_readback":"exact_m3_invoice_review_ready",
    version:VERSION,sourceSha256:source.hash,providerRequests:0,invoiceValuesRead:0,
    clientMoneyFlagsEnabled:false,invoiceReviewFlagEnabled:false};
}

export function releaseSql(file=reviewedSource()){
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
lock table public.feature_flags in share mode;
do $m3_invoice_review_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('${RPC}') is not null or to_regprocedure('${DATE}') is not null
  or to_regprocedure('public.learn_operator_input_access(uuid,uuid,boolean)') is null
  or to_regprocedure('public.learn_quickbooks_actor_access(uuid,uuid)') is null
  or to_regclass('public.learn_quickbooks_latest') is null
  or to_regclass('public.learn_quickbooks_source_versions') is null
  or to_regclass('public.learn_quickbooks_finance_events') is null
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
   and environment='production' and realm_id is not null and confirmed_at is not null
   and status<>'disconnected')<>1
  or exists(select 1 from public.feature_flags where flag in (${CLIENT_FLAGS.map(quote).join(",")})
   and value='true'::jsonb)
  or exists(select 1 from public.feature_flags where flag='new_dawn.invoice_review_candidates_preview'
   and value='true'::jsonb)
 then raise exception 'm3_invoice_review_install_preflight_changed';end if;
end $m3_invoice_review_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.source)}]);
select '${VERSION}' as installed_m3_invoice_review_version;
commit;`;
}

async function management(project,token,path,query,readOnly=true,fetcher=fetch){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
    method:query?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,...(query?{"Content-Type":"application/json"}:{})},
    ...(query?{body:JSON.stringify({query,...(readOnly?{}:{read_only:false})})}:{})});
  if(!response.ok)throw Error(`m3_invoice_review_management_${readOnly?"read":"write"}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error("m3_invoice_review_management_response_oversized");
  return JSON.parse(bytes.toString("utf8"));
}
export async function readStage(project,token,fetcher=fetch){
  if(project!==PROJECT)throw Error("exact_live_project_required");
  const q=sql=>management(project,token,"/database/query/read-only",sql,true,fetcher);
  return {project:await management(project,token,"",null,true,fetcher),
    ledger:await q(ledgerSql),catalog:await q(catalogSql)};
}
export async function installLive({project=PROJECT,token=savedCliToken(),read=readStage,write}={}){
  if(project!==PROJECT)throw Error("exact_live_project_required");
  const file=reviewedSource();
  assess(await read(project,token),false,file);
  const writer=write??(sql=>management(project,token,"/database/query",sql,false));
  let acknowledged=false;
  try{
    const rows=await writer(releaseSql(file));
    acknowledged=Array.isArray(rows)&&rows.some(row=>row?.installed_m3_invoice_review_version===VERSION);
  }catch{/* Unknown outcome gets one independent readback; never replay the write. */}
  let after;
  try{after=await read(project,token);}
  catch{throw Error("m3_invoice_review_outcome_unverified_no_replay");}
  let result;
  try{result=assess(after,true,file);}
  catch{throw Error("m3_invoice_review_outcome_unverified_no_replay");}
  return {...result,ledgerReadbackVerified:true,writeAcknowledged:acknowledged};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT)
      throw Error("explicit_exact_live_project_required");
    const mode=process.argv.slice(2).join(" ");
    if(mode==="--live-read-only"){
      const snapshot=await readStage(PROJECT,savedCliToken());
      console.log(JSON.stringify(assess(snapshot,snapshot.ledger?.length===1)));
    }else if(mode==="--live-install-exact"){
      if(process.env.NEW_DAWN_M3_ALLOW_VERSION!==VERSION||
        process.env.NEW_DAWN_M3_ALLOW_SOURCE_SHA256!==SOURCE_SHA256)
        throw Error("explicit_exact_invoice_review_source_required");
      console.log(JSON.stringify(await installLive()));
    }else throw Error("explicit_exact_m3_invoice_review_action_required");
  }catch(error){
    console.error(JSON.stringify({state:"m3_invoice_review_release_stopped",
      code:error instanceof Error?error.message:"unknown",retryAllowed:false,
      providerRequests:0,invoiceValuesRead:0}));
    process.exitCode=1;
  }
}
