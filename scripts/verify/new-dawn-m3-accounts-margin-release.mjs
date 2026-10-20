/** Exact additive LIVE release for the operator-only accounts margin RPC. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const PROJECT='tgbnakbxwcqjeimygroz';
const TENANT='00000000-0000-0000-0000-000000000001';
const VERSION='20261109100000';
const NAME='new_dawn_accounts_margin_preview';
const SOURCE_SHA256='beb907fe598df16238a04a7e218c31205bf58b0f06328c7f9ee535aeef3d9fae';
const PRIOR_SUMMARY_SHA256='b98df331e0613be5cc490ed0f8f0f283233378b058433ceb81cfb9e75ea531a4';
const SIGNATURE='public.learn_quickbooks_accounts_margin_preview(uuid,uuid,uuid,text)';
const quote=value=>"'"+value.replaceAll("'","''")+"'";

function source(){
  const value=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),'utf8');
  const hash=createHash('sha256').update(value).digest('hex');
  if(hash!==SOURCE_SHA256||!/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(value)||
    !/\ncommit;\s*$/i.test(value))throw Error('accounts_margin_reviewed_source_changed');
  return {value,hash,body:value.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'').replace(/\ncommit;\s*$/i,'')};
}

async function management(token,path,query,fetcher=fetch){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${path}`,{
    method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,...(query?{'Content-Type':'application/json'}:{})},
    ...(query?{body:JSON.stringify({query})}:{})});
  if(!response.ok)throw Error(`accounts_margin_management_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error('accounts_margin_management_response_oversized');
  return JSON.parse(bytes.toString('utf8'));
}

async function readStage(token,fetcher=fetch){
  const query=sql=>management(token,'/database/query/read-only',sql,fetcher);
  const [project,ledger,catalog,counts]=await Promise.all([
    management(token,'',null,fetcher),
    query(`select version::text,name,array_length(statements,1) as statements,
      encode(sha256(convert_to(statements[1],'UTF8')),'hex') as source_sha256
      from supabase_migrations.schema_migrations where version::text='${VERSION}'`),
    query(`select to_regprocedure('${SIGNATURE}') is not null as installed,
      case when to_regprocedure('${SIGNATURE}') is null then false else
        has_function_privilege('authenticated','${SIGNATURE}','execute') end as authenticated_grant,
      case when to_regprocedure('${SIGNATURE}') is null then false else
        has_function_privilege('anon','${SIGNATURE}','execute') end as anon_grant,
      case when to_regprocedure('${SIGNATURE}') is null then false else
        has_function_privilege('service_role','${SIGNATURE}','execute') end as service_grant,
      encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
        'public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)')),'UTF8')),'hex') as summary_sha256,
      (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
        and flag='new_dawn.report_summary_preview' and value='true'::jsonb) as summary_on,
      (select count(*)::int from public.feature_flags where tenant_id='${TENANT}'::uuid
        and flag='new_dawn.report_margin_preview' and value='true'::jsonb) as margin_on,
      (select count(*)::int from public.feature_flags where flag in
        ('new_dawn.owner_money','new_dawn.owner_report_review','new_dawn.owner_accounts_report')
        and value='true'::jsonb) as client_money_on,
      exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as tenant_active`),
    query(`select (select count(*)::bigint from public.learn_quickbooks_report_requests
       where tenant_id='${TENANT}'::uuid) as requests,
      (select count(*)::bigint from public.learn_quickbooks_report_receipts
       where tenant_id='${TENANT}'::uuid) as receipts,
      (select count(*)::bigint from public.learn_quickbooks_finance_events
       where tenant_id='${TENANT}'::uuid) as audits`),
  ]);
  return {project,ledger,catalog,counts};
}

function assess(stage,installed){
  if(stage.project?.id!==PROJECT||stage.project.status!=='ACTIVE_HEALTHY'||
    !Array.isArray(stage.ledger)||stage.ledger.length!==Number(installed)||
    !Array.isArray(stage.catalog)||stage.catalog.length!==1||
    !Array.isArray(stage.counts)||stage.counts.length!==1)
    throw Error('accounts_margin_target_changed');
  if(installed){
    const row=stage.ledger[0];
    if(String(row.version)!==VERSION||row.name!==NAME||row.statements!==1||
      row.source_sha256!==SOURCE_SHA256)throw Error('accounts_margin_ledger_changed');
  }
  const c=stage.catalog[0];
  if(c.installed!==installed||c.authenticated_grant!==installed||
    c.anon_grant!==false||c.service_grant!==false||
    c.summary_sha256!==PRIOR_SUMMARY_SHA256||c.summary_on!==1||
    c.margin_on!==0||c.client_money_on!==0||c.tenant_active!==true)
    throw Error('accounts_margin_boundary_changed');
  const counts=stage.counts[0];
  if(!['requests','receipts','audits'].every(key=>
    Number.isSafeInteger(Number(counts[key]))&&Number(counts[key])>=0))
    throw Error('accounts_margin_counts_changed');
  return {state:installed?'installed_default_off':'exact_margin_ready',
    version:VERSION,sourceSha256:SOURCE_SHA256,providerRequests:0,
    clientMoneyFlagsEnabled:false,marginFlagEnabled:false,
    reportRequests:Number(counts.requests),reportReceipts:Number(counts.receipts),
    auditEvents:Number(counts.audits)};
}

function installSql(file){
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('${SIGNATURE}') is not null
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
    'public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)')),'UTF8')),'hex')
    is distinct from '${PRIOR_SUMMARY_SHA256}'
  or not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
    and flag='new_dawn.report_summary_preview' and value='true'::jsonb)<>1
  or exists(select 1 from public.feature_flags where flag in
    ('new_dawn.report_margin_preview','new_dawn.owner_money',
     'new_dawn.owner_report_review','new_dawn.owner_accounts_report')
    and value='true'::jsonb)
 then raise exception 'accounts_margin_install_preflight_changed';end if;
end $gate$;
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.value)}]);
select '${VERSION}' as installed_margin_version;
commit;`;
}

export async function release(mode,token=savedCliToken(),fetcher=fetch){
  const file=source();
  const before=await readStage(token,fetcher);
  if(mode==='--live-read-only')return assess(before,before.catalog?.[0]?.installed===true);
  if(mode!=='--live-install-exact')throw Error('accounts_margin_mode_required');
  assess(before,false);
  let acknowledged=false;
  try{
    const rows=await management(token,'/database/query',installSql(file),fetcher);
    acknowledged=Array.isArray(rows)&&rows.some(row=>row?.installed_margin_version===VERSION);
  }catch{/* An uncertain outcome is read back once; never replay automatically. */}
  let after;
  try{after=await readStage(token,fetcher);}catch{throw Error('accounts_margin_install_outcome_unverified_no_replay');}
  let result;
  try{
    result=assess(after,true);
    for(const key of ['reportRequests','reportReceipts','auditEvents'])
      if(result[key]!==Number(before.counts[0][{reportRequests:'requests',reportReceipts:'receipts',auditEvents:'audits'}[key]]))
        throw Error('accounts_margin_count_changed');
  }catch{throw Error('accounts_margin_install_outcome_unverified_no_replay');}
  return {...result,ledgerReadbackVerified:true,writeAcknowledged:acknowledged};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT)
      throw Error('explicit_exact_live_project_required');
    console.log(JSON.stringify(await release(process.argv.slice(2).join(' '))));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
