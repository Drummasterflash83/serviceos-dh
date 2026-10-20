/** Exact M3 saved-invoice performance repair. No flag or provider action. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {savedCliToken} from './learn-test-readiness.mjs';

export const PROJECT='tgbnakbxwcqjeimygroz';
export const TENANT='00000000-0000-0000-0000-000000000001';
export const VERSION='20261108120000';
export const NAME='new_dawn_invoice_review_candidates_fast';
export const SOURCE_SHA256='b94a50040f21b00d7ecd0b8e50461d0fe751f28b19811c40026761fc7cf709c1';
export const FUNCTION_SHA256='44e35e8874ea6cce56c1ef01384e2825702411154fc98cecc8fd89d325aecee8';
export const INDEX_SHA256='9895a7042e3144abb0a1ac185a99c36832a7a5e227090e75ffd34aad2611cae9';
const BASE_VERSION='20261108110000';
const BASE_NAME='new_dawn_invoice_review_candidates';
const BASE_SOURCE_SHA256='1bc934adf50168eb82c6dc139236911cf9ba6d364d921d7ace98b3b46057e0bc';
const BASE_FUNCTION_SHA256='f8ca4b3da3f719562b9630a734625b348a000513201fe1100a334f6bd2b50a5c';
const DATE_SHA256='a70d57bf99c61c5018a1067f16d260eab6cb356cd0e71bb05b3ca4f3200637a9';
const RPC='public.new_dawn_invoice_review_candidates(uuid,text)';
const DATE='public.new_dawn_invoice_strict_date(text)';
const INDEX='public.learn_quickbooks_latest_invoice_recent_review';
const CLIENT_FLAGS=['new_dawn.owner_money','new_dawn.owner_report_review','new_dawn.owner_accounts_report'];
const quote=value=>"'"+value.replaceAll("'","''")+"'";

export function reviewedSource(){
  const source=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),'utf8');
  const hash=createHash('sha256').update(source).digest('hex');
  if(hash!==SOURCE_SHA256||!/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source)||
    !/\ncommit;\s*$/i.test(source))throw Error('m3_fast_source_changed');
  const body=source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'')
    .replace(/\ncommit;\s*$/i,'');
  if(/^\s*(begin|commit);\s*$/im.test(body))throw Error('m3_fast_nested_transaction');
  return {source,body,hash};
}

const ledgerSql=`select version::text,name,array_length(statements,1) statement_count,
 encode(sha256(convert_to(statements[1],'UTF8')),'hex') source_sha256
 from supabase_migrations.schema_migrations
 where version::text in ('${BASE_VERSION}','${VERSION}') order by version`;
const catalogSql=`select
 to_regprocedure('${RPC}') is not null as rpc_installed,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex') as rpc_sha256,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${DATE}')),'UTF8')),'hex') as date_sha256,
 to_regclass('${INDEX}') is not null as index_installed,
 case when to_regclass('${INDEX}') is null then null else
  encode(sha256(convert_to(pg_get_indexdef(to_regclass('${INDEX}')),'UTF8')),'hex') end as index_sha256,
 case when to_regclass('${INDEX}') is null then null else
  (select indisvalid and indisready from pg_index where indexrelid=to_regclass('${INDEX}')) end as index_ready,
 (select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${RPC}')) as security_definer,
 has_function_privilege('authenticated','${RPC}','execute') as authenticated_grant,
 has_function_privilege('anon','${RPC}','execute') as anon_grant,
 has_function_privilege('service_role','${RPC}','execute') as service_grant,
 has_function_privilege('authenticated','${DATE}','execute') as date_authenticated_grant,
 has_function_privilege('anon','${DATE}','execute') as date_anon_grant,
 has_function_privilege('service_role','${DATE}','execute') as date_service_grant,
 exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as active_tenant,
 (select count(*)::int from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
  and environment='production' and realm_id is not null and confirmed_at is not null
  and status<>'disconnected') as confirmed_connections,
 (select count(*)::int from public.feature_flags where flag in
  (${CLIENT_FLAGS.map(quote).join(',')}) and value='true'::jsonb) as client_flags_on,
 (select count(*)::int from public.feature_flags where flag='new_dawn.invoice_review_candidates_preview'
  and value='true'::jsonb) as invoice_preview_flags_on`;

export function assess(snapshot,installed,source=reviewedSource(),invoicePreviewEnabled=false){
  if(typeof installed!=='boolean'||typeof invoicePreviewEnabled!=='boolean'||
    snapshot?.project?.id!==PROJECT||
    snapshot.project.status!=='ACTIVE_HEALTHY'||!Array.isArray(snapshot.ledger)||
    snapshot.ledger.length!==1+Number(installed))throw Error('m3_fast_project_or_ledger_changed');
  const base=snapshot.ledger.find(row=>row?.version===BASE_VERSION);
  const fast=snapshot.ledger.find(row=>row?.version===VERSION);
  if(base?.name!==BASE_NAME||base?.statement_count!==1||
    base?.source_sha256!==BASE_SOURCE_SHA256||
    (installed && (fast?.name!==NAME||fast?.statement_count!==1||
      fast?.source_sha256!==source.hash))||(!installed&&fast))
    throw Error('m3_fast_ledger_changed');
  const c=snapshot.catalog?.[0];
  if(snapshot.catalog?.length!==1||!c||c.rpc_installed!==true||
    c.rpc_sha256!==(installed?FUNCTION_SHA256:BASE_FUNCTION_SHA256)||
    c.date_sha256!==DATE_SHA256||c.index_installed!==installed||
    c.index_sha256!==(installed?INDEX_SHA256:null)||
    c.index_ready!==(installed?true:null)||c.security_definer!==true||
    c.authenticated_grant!==true||c.anon_grant!==false||c.service_grant!==false||
    c.date_authenticated_grant!==false||c.date_anon_grant!==false||
    c.date_service_grant!==false||c.active_tenant!==true||
    c.confirmed_connections!==1||c.client_flags_on!==0||
    c.invoice_preview_flags_on!==Number(invoicePreviewEnabled))
    throw Error('m3_fast_catalog_or_scope_changed');
  return {state:installed?'fast_invoice_review_installed':'fast_invoice_review_ready',
    version:VERSION,sourceSha256:source.hash,functionSha256:installed?FUNCTION_SHA256:null,
    indexSha256:installed?INDEX_SHA256:null,clientMoneyFlagsEnabled:false,
    invoiceReviewFlagEnabled:invoicePreviewEnabled,providerRequests:0,invoiceValuesRead:0};
}

export function releaseSql(file=reviewedSource()){
  const clientOn=`exists(select 1 from public.feature_flags where flag in
   (${CLIENT_FLAGS.map(quote).join(',')}) and value='true'::jsonb)`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
lock table public.feature_flags in share mode;
do $m3_fast_gate$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations
    where version::text='${BASE_VERSION}' and name='${BASE_NAME}'
     and array_length(statements,1)=1
     and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${BASE_SOURCE_SHA256}')
  or exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${RPC}')),'UTF8')),'hex')
    is distinct from '${BASE_FUNCTION_SHA256}'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('${DATE}')),'UTF8')),'hex')
    is distinct from '${DATE_SHA256}'
  or to_regclass('${INDEX}') is not null
  or not has_function_privilege('authenticated','${RPC}','execute')
  or has_function_privilege('anon','${RPC}','execute')
  or has_function_privilege('service_role','${RPC}','execute')
  or ${clientOn}
  or exists(select 1 from public.feature_flags where flag='new_dawn.invoice_review_candidates_preview'
   and value='true'::jsonb)
 then raise exception 'm3_fast_install_preflight_changed';end if;
end $m3_fast_gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.source)}]);
select '${VERSION}' as installed_m3_fast_invoice_review_version;
commit;`;
}

async function management(project,token,path,query,readOnly=true,fetcher=fetch){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
    method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,...(query?{'Content-Type':'application/json'}:{})},
    ...(query?{body:JSON.stringify({query,...(readOnly?{}:{read_only:false})})}:{})});
  if(!response.ok)throw Error(`m3_fast_management_${readOnly?'read':'write'}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error('m3_fast_management_response_oversized');
  return JSON.parse(bytes.toString('utf8'));
}
export async function readStage(project=PROJECT,token=savedCliToken(),fetcher=fetch){
  if(project!==PROJECT)throw Error('exact_live_project_required');
  const q=sql=>management(project,token,'/database/query/read-only',sql,true,fetcher);
  return {project:await management(project,token,'',null,true,fetcher),
    ledger:await q(ledgerSql),catalog:await q(catalogSql)};
}
export async function installLive({project=PROJECT,token=savedCliToken(),read=readStage,write}={}){
  if(project!==PROJECT)throw Error('exact_live_project_required');
  const file=reviewedSource();
  assess(await read(project,token),false,file);
  const writer=write??(sql=>management(project,token,'/database/query',sql,false));
  let acknowledged=false;
  try{
    const rows=await writer(releaseSql(file));
    acknowledged=Array.isArray(rows)&&rows.some(row=>row?.installed_m3_fast_invoice_review_version===VERSION);
  }catch{/* Unknown outcome gets one independent readback; never replay. */}
  let result;
  try{result=assess(await read(project,token),true,file);}
  catch{throw Error('m3_fast_outcome_unverified_no_replay');}
  return {...result,ledgerReadbackVerified:true,writeAcknowledged:acknowledged};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT)
      throw Error('explicit_exact_live_project_required');
    const mode=process.argv.slice(2).join(' ');
    if(mode==='--live-read-only'){
      const snapshot=await readStage();
      console.log(JSON.stringify(assess(snapshot,snapshot.ledger?.length===2)));
    }else if(mode==='--live-install-exact'){
      if(process.env.NEW_DAWN_M3_ALLOW_VERSION!==VERSION||
        process.env.NEW_DAWN_M3_ALLOW_SOURCE_SHA256!==SOURCE_SHA256)
        throw Error('explicit_exact_fast_source_required');
      console.log(JSON.stringify(await installLive()));
    }else throw Error('explicit_exact_fast_action_required');
  }catch(error){console.error(JSON.stringify({state:'m3_fast_release_stopped',
    code:error instanceof Error?error.message:'unknown',retryAllowed:false,
    providerRequests:0,invoiceValuesRead:0}));process.exitCode=1;}
}
