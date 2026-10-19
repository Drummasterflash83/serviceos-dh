/** Exact additive SQL release for an operator-only QuickBooks credential refresh gate. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { rehearse } from './new-dawn-report-refresh-rehearse.mjs';
export const PROJECT='tgbnakbxwcqjeimygroz';
export const TENANT='00000000-0000-0000-0000-000000000001';
export const VERSION='20261107120000';
export const NAME='new_dawn_quickbooks_report_refresh_authorize';
export const SHA256='2fc64bb642c4e61b555eef8dcf9b205e9b0edf0a44d233613393802211a4f2df';
const SIGNATURE='public.learn_quickbooks_report_refresh_authorize(uuid,uuid,uuid,text,text,text)';
const FLAGS=['new_dawn.owner_money','new_dawn.owner_accounts_report','new_dawn.owner_report_review'];
const quote=s=>"'"+s.replaceAll("'","''")+"'";
export function source() {
  const sql=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),'utf8');
  if(createHash('sha256').update(sql).digest('hex')!==SHA256||!/^begin;\n/i.test(sql)||!/\ncommit;\s*$/i.test(sql))
    throw Error('reviewed_refresh_source_changed');
  return {sql,body:sql.replace(/^begin;\n/i,'').replace(/\ncommit;\s*$/i,'\n')};
}
const ledgerSql=`select version::text,name,statements from supabase_migrations.schema_migrations where version::text='${VERSION}'`;
const schemaSql=`select to_regprocedure('${SIGNATURE}') is not null as installed,
 coalesce((select p.prosecdef from pg_proc p where p.oid=to_regprocedure('${SIGNATURE}')),false) as security_definer,
 case when to_regprocedure('${SIGNATURE}') is null then false else has_function_privilege('authenticated',to_regprocedure('${SIGNATURE}'),'execute') end as authenticated_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false else has_function_privilege('anon',to_regprocedure('${SIGNATURE}'),'execute') end as anon_grant,
 case when to_regprocedure('${SIGNATURE}') is null then false else has_function_privilege('service_role',to_regprocedure('${SIGNATURE}'),'execute') end as service_grant,
 to_regprocedure('public.learn_quickbooks_refresh_acquire(uuid,uuid)') is not null as existing_lease,
 to_regprocedure('public.learn_quickbooks_refresh_finish(uuid,uuid,uuid,bigint,bigint,jsonb)') is not null as existing_finish`;
const scopeSql=`select exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active') as active_tenant,
 (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
 and environment='production' and realm_id is not null and confirmed_at is not null
 and status in('active','paused')) as confirmed_connections,
 (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
 and refresh_lease is not null) as active_refresh_leases`;
const flagsSql=`select flag,value from public.feature_flags where tenant_id='${TENANT}'::uuid
 and flag in (${FLAGS.map(quote).join(',')}) order by flag`;
async function management(project,token,path,query,readOnly=true,fetcher=fetch) {
  const response=await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
    method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,...(query?{'Content-Type':'application/json'}:{})},
    ...(query?{body:JSON.stringify({query,read_only:readOnly})}:{})});
  if(!response.ok)throw Error(`refresh_management_${readOnly?'read':'write'}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error('refresh_management_response_oversized');
  return JSON.parse(bytes.toString('utf8'));
}
export async function readStage(project,token,fetcher=fetch) {
  const q=sql=>management(project,token,'/database/query/read-only',sql,true,fetcher);
  return {project:await management(project,token,'',null,true,fetcher),ledger:await q(ledgerSql),
    schema:await q(schemaSql),scope:await q(scopeSql),flags:await q(flagsSql)};
}
export function assess(s,installed,expectedFlags=s.flags) {
  if(s.project?.id!==PROJECT||s.project?.status!=='ACTIVE_HEALTHY')throw Error('refresh_live_project_unconfirmed');
  if(!Array.isArray(s.scope)||s.scope.length!==1||s.scope[0]?.active_tenant!==true||
    s.scope[0]?.confirmed_connections!==1||s.scope[0]?.active_refresh_leases!==0)
    throw Error('refresh_connection_scope_changed');
  const f=s.flags;
  if(!Array.isArray(f)||f.some(x=>!FLAGS.includes(x?.flag)||x.value!==false)||
    JSON.stringify(f)!==JSON.stringify(expectedFlags))throw Error('refresh_money_flag_changed');
  const x=s.schema?.[0];
  if(!x||x.existing_lease!==true||x.existing_finish!==true||x.installed!==installed||
    x.security_definer!==installed||x.authenticated_grant!==installed||x.anon_grant!==false||x.service_grant!==false)
    throw Error('refresh_schema_boundary_changed');
  if(!Array.isArray(s.ledger)||s.ledger.length!==Number(installed))throw Error('refresh_ledger_changed');
  if(installed&&(String(s.ledger[0]?.version)!==VERSION||s.ledger[0]?.name!==NAME||
    s.ledger[0]?.statements?.length!==1||s.ledger[0]?.statements?.[0]!==source().sql))
    throw Error('refresh_exact_source_changed');
  return {state:installed?'installed_default_off':'absent',version:VERSION,sourceSha256:SHA256,
    moneyFlagsOff:true,activeRefreshLeases:0,providerRequests:0};
}
export function releaseSql() {
  const {sql,body}=source();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
 or to_regprocedure('${SIGNATURE}') is not null then raise exception 'refresh_source_already_installed';end if;
 if not exists(select 1 from public.tenants where id='${TENANT}'::uuid and status='active')
 or (select count(*) from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
  and environment='production' and realm_id is not null and confirmed_at is not null
  and status in('active','paused'))<>1
 or exists(select 1 from public.learn_quickbooks_connections where tenant_id='${TENANT}'::uuid
  and refresh_lease is not null)
 or exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag in (${FLAGS.map(quote).join(',')}) and value is distinct from 'false'::jsonb)
 then raise exception 'refresh_release_boundary_changed';end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(sql)}]);
select '${VERSION}' as refresh_version;
commit;`;
}
export async function applyExact({project,token=savedCliToken(),fetcher=fetch,read=readStage,write}={}) {
  if(project!==PROJECT)throw Error('exact_refresh_live_project_required');
  const before=await read(project,token,fetcher);assess(before,false);
  let acknowledged=false;
  try { const result=await (write??(sql=>management(project,token,'/database/query',sql,false,fetcher)))(releaseSql());
    acknowledged=Array.isArray(result)&&result.some(x=>x?.refresh_version===VERSION);
  } catch { /* Read once after an uncertain write. Never replay. */ }
  let after;
  try { after=await read(project,token,fetcher);assess(after,true,before.flags); }
  catch { throw Error('refresh_write_outcome_unverified_no_replay'); }
  return {state:'installed_default_off',version:VERSION,sourceSha256:SHA256,
    writeAcknowledged:acknowledged,ledgerReadbackVerified:true,moneyFlagsOff:true,providerRequests:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const args=process.argv.slice(2),allowed=process.env.NEW_DAWN_M3_ALLOW_PROJECT;
    if(args.length===1&&args[0]==='--test-rollback-only'&&allowed===TEST_PROJECT)
      console.log(JSON.stringify(await rehearse()));
    else if(args.length===1&&args[0]==='--live-read-only'&&allowed===PROJECT) {
      const s=await readStage(PROJECT,savedCliToken());console.log(JSON.stringify(assess(s,s.ledger.length===1)));
    } else if(args.length===3&&args[0]==='--live-apply-exact'&&args[1]==='--version'&&args[2]===VERSION&&allowed===PROJECT)
      console.log(JSON.stringify(await applyExact({project:PROJECT})));
    else throw Error('explicit_refresh_release_scope_required');
  } catch(error) { console.error(JSON.stringify({state:'refresh_release_stopped',code:error.message,
    retryAllowed:false,providerRequests:0}));process.exitCode=1; }
}
