/** Exact, default-off LIVE release for the held source-user-reference RPC. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { PROJECT, TENANT } from './new-dawn-m2-live-preflight.mjs';

export const VERSION='20261107130000';
export const NAME='new_dawn_job_source_user_reference';
export const SOURCE_SHA256='826eec0619cff80897885b329ee4583dcd732f28e0221fa76ee66a6cfa5b3d7d';
export const FUNCTION_SHA256='9554aa521fe74d19f8220820a84133dbc89289c1a6b00455bf41d493aae093c3';
const EDGE=Object.freeze({id:'009b9fb6-8e3c-49b8-8a3e-95531ba370bd',slug:'learn-commusoft-job-detail',
 version:6,ezbr_sha256:'b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb',
 status:'ACTIVE',verify_jwt:false});
const PRIOR=Object.freeze([
 ['20261105180000','commusoft_source_users','bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501'],
 ['20261105190000','commusoft_source_users_resume','cbb7498d28b2a4bb7c238fed65ee7f1441fcf1cb70cb513e43ed7bcd7a86708d'],
 ['20261106150000','new_dawn_commusoft_shared_lease','a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b'],
 ['20261106160000','new_dawn_commusoft_shared_lease_routes','6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953'],
 ['20261106180000','new_dawn_commusoft_lease_coexistence','e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f'],
 // Already published closure owns 071600; this retroactive 071300 insert must not collide.
 ['20261107160000','new_dawn_commusoft_job_closure_source_facts','ab50173c908aa8e3ed7edcf73cf87793d83a99b28c015d302e6f07eeed2306f8'],
]);
const FUNCTIONS=Object.freeze({
 'new_dawn_commusoft_job_actor_access(uuid, uuid)':'c219bb0b06c71235a999e7656504f3eb2b74739dadbd5de47c6a5f21789a2a6d',
 'learn_operator_input_access(uuid, uuid, boolean)':'1fbcfaf5e4fa63e9d645a6c34399a487d100db2053dd6eb14055b4468abcf0d2',
 'new_dawn_commusoft_job_detail_finish(uuid, text)':'7c4bb1e4baf72f56935ed40dd441ea1cbd25412d205576583152677d7f4ce36c',
});
const sha=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const versions=[...PRIOR.map(x=>x[0]),VERSION];
const ledgerSql=`select version::text,name,cardinality(statements) statement_count,
 encode(sha256(convert_to(statements[1],'UTF8')),'hex') source_hash
 from supabase_migrations.schema_migrations where version::text in (${versions.map(quote).join(',')})
 order by version::text`;
const catalogSql=`select jsonb_build_object(
 'functions',(select coalesce(jsonb_object_agg(p.proname||'('||oidvectortypes(p.proargtypes)||')',
  encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')),'{}'::jsonb)
  from pg_proc p where p.oid in(
   to_regprocedure('public.new_dawn_commusoft_job_actor_access(uuid,uuid)'),
   to_regprocedure('public.learn_operator_input_access(uuid,uuid,boolean)'),
   to_regprocedure('public.new_dawn_commusoft_job_detail_finish(uuid,text)'))),
 'reference',(select jsonb_build_object('hash',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
  'definer',p.prosecdef,'config',p.proconfig,
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service',has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_proc p where p.oid=to_regprocedure('public.new_dawn_job_source_user_reference(uuid,uuid,text)')),
 'detail_table',to_regclass('public.new_dawn_commusoft_job_detail_reads') is not null,
 'flags',(select coalesce(jsonb_agg(jsonb_build_object('flag',flag,'value',value) order by flag),'[]'::jsonb)
  from public.feature_flags where tenant_id='${TENANT}'::uuid and flag in
  ('learn.enabled','learn.inputs.commusoft.enabled','learn.inputs.commusoft.users.enabled','new_dawn.m2_source_user_reference')),
 'capture',(select coalesce(jsonb_agg(jsonb_build_object('resource',a.settings#>>'{commusoft_import,resource}',
  'cursor_hash',encode(sha256(convert_to(a.sync_cursor::text,'UTF8')),'hex'),
  'account_hash',encode(sha256(convert_to(a.settings::text||a.sync_cursor::text,'UTF8')),'hex')) order by j.id),'[]'::jsonb)
  from public.platform_jobs j left join public.connector_accounts a on a.tenant_id=j.tenant_id
   and a.id::text=j.payload->>'connector_account_id'
  where j.tenant_id='${TENANT}'::uuid and j.job_type='commusoft.source_sync'
   and j.status in('queued','running','retrying'))
) as catalog`;
export function reviewedSource() {
 const source=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),'utf8');
 if(sha(source)!==SOURCE_SHA256 || !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source) || !/\ncommit;\s*$/i.test(source))
  throw Error('source_user_reference_reviewed_sql_changed');
 const body=source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'').replace(/\ncommit;\s*$/i,'');
 if(/^\s*(begin|commit);\s*$/im.test(body) || /\b(?:update|delete|truncate)\s+public\.(?:connector_accounts|platform_jobs)\b/i.test(body))
  throw Error('source_user_reference_scope_changed');
 return {source,body};
}
export function assess(snapshot,installed=false) {
 if(snapshot?.project?.id!==PROJECT || snapshot.project.status!=='ACTIVE_HEALTHY' ||
   !Array.isArray(snapshot.ledger) || !Array.isArray(snapshot.functions) || !snapshot.catalog)
  throw Error('source_user_reference_project_unconfirmed');
 const expected=[...PRIOR,...(installed?[[VERSION,NAME,SOURCE_SHA256]]:[])].sort((a,b)=>a[0].localeCompare(b[0]));
 if(snapshot.ledger.length!==expected.length || expected.some(([v,n,h],i)=>{
  const row=snapshot.ledger[i];return row?.version!==v || row.name!==n || row.statement_count!==1 || row.source_hash!==h;}))
  throw Error('source_user_reference_prerequisite_ledger_changed');
 const c=snapshot.catalog;
 if(Object.entries(FUNCTIONS).some(([name,hash])=>c.functions?.[name]!==hash) || c.detail_table!==true ||
   (installed ? c.reference?.hash!==FUNCTION_SHA256 || c.reference.definer!==true ||
    JSON.stringify(c.reference.config)!==JSON.stringify(['search_path=pg_catalog']) ||
    c.reference.anon!==false || c.reference.authenticated!==true || c.reference.service!==false
    : c.reference!==null)) throw Error('source_user_reference_function_or_grant_changed');
 if(JSON.stringify(c.flags)!==JSON.stringify([
  {flag:'learn.enabled',value:true},{flag:'learn.inputs.commusoft.enabled',value:true}]))
  throw Error('source_user_reference_default_off_flags_changed');
 if(!Array.isArray(c.capture) || c.capture.some(row=>
  !['properties','jobs','propertyContacts'].includes(row.resource) ||
  !/^[a-f0-9]{64}$/.test(row.cursor_hash) || !/^[a-f0-9]{64}$/.test(row.account_hash)))
  throw Error('source_user_reference_recurring_capture_unconfirmed');
 const edge=snapshot.functions.filter(f=>f.slug===EDGE.slug);
 if(edge.length!==1 || Object.entries(EDGE).some(([key,value])=>edge[0][key]!==value))
  throw Error('source_user_reference_job_detail_edge_changed');
 return {state:installed?'source_user_reference_installed_default_off':'source_user_reference_ready_default_off',
  version:VERSION,sourceSha256:SOURCE_SHA256,functionSha256:installed?FUNCTION_SHA256:null,
  recurringJobs:c.capture.length,captureFingerprints:c.capture.map(x=>x.account_hash),providerRequests:0};
}
export function releaseSql(rollback=false) {
 const {source,body}=reviewedSource();
 const prerequisites=PRIOR.map(([v,n,h])=>`not exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${v}' and name='${n}' and cardinality(statements)=1
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${h}')`).join(' or\n  ');
 const functionChecks=Object.entries(FUNCTIONS).map(([name,hash])=>{
  const sig=name.replaceAll(', ', ',');
  return `encode(sha256(convert_to(pg_get_functiondef('public.${sig}'::regprocedure),'UTF8')),'hex')<>'${hash}'`;
 }).join(' or\n  ');
 return `begin;
set local lock_timeout='3s';set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $reference_gate$ begin
 if ${prerequisites}
  or ${functionChecks}
  or exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('public.new_dawn_job_source_user_reference(uuid,uuid,text)') is not null
  or to_regclass('public.new_dawn_commusoft_job_detail_reads') is null
  or exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag in('learn.inputs.commusoft.users.enabled','new_dawn.m2_source_user_reference'))
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag in('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb)<>2
  or exists(select 1 from public.platform_jobs j left join public.connector_accounts a
   on a.tenant_id=j.tenant_id and a.id::text=j.payload->>'connector_account_id'
   where j.tenant_id='${TENANT}'::uuid and j.job_type='commusoft.source_sync'
    and j.status in('queued','running','retrying') and
    (a.id is null or a.status is distinct from 'active' or
     coalesce(a.settings#>>'{commusoft_import,resource}','') not in('properties','jobs','propertyContacts') or
     nullif(a.settings#>>'{commusoft_import,approvalId}','') is null))
 then raise exception 'source_user_reference_exact_live_preflight_changed';end if;
end $reference_gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(source)}]);
select '${VERSION}' as installed_reference_version;
${rollback?'rollback':'commit'};`;
}
async function management(project,token,path,query=null,readOnly=true,fetcher=fetch) {
 const response=await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
  method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(90000),
  headers:{Authorization:`Bearer ${token}`,...(query?{'Content-Type':'application/json'}:{})},
  ...(query?{body:JSON.stringify({query,read_only:readOnly})}:{})});
 if(!response.ok) throw Error(`source_user_reference_${readOnly?'read':'write'}_http_${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>1024*1024) throw Error('source_user_reference_management_oversized');
 return JSON.parse(bytes.toString('utf8'));
}
export async function readStage({token=savedCliToken(),fetcher=fetch}={}) {
 const [project,ledger,functions,rows]=await Promise.all([
  management(PROJECT,token,'',null,true,fetcher),
  management(PROJECT,token,'/database/query/read-only',ledgerSql,true,fetcher),
  management(PROJECT,token,'/functions',null,true,fetcher),
  management(PROJECT,token,'/database/query/read-only',catalogSql,true,fetcher)]);
 if(!Array.isArray(rows)||rows.length!==1) throw Error('source_user_reference_catalog_unconfirmed');
 return {project,ledger,functions,catalog:rows[0].catalog};
}
export async function installLive({token=savedCliToken(),read=readStage,write}={}) {
 const before=await read({token});assess(before,false);
 const writer=write??(sql=>management(PROJECT,token,'/database/query',sql,false));
 let acknowledged=false;
 try {const rows=await writer(releaseSql());acknowledged=rows?.some?.(r=>r.installed_reference_version===VERSION)===true;}
 catch { /* Unknown outcome: independent readback, no automatic replay. */ }
 let after;try {after=await read({token});assess(after,true);}
 catch {throw Error('source_user_reference_install_outcome_unverified_no_replay');}
 return {state:'source_user_reference_installed_default_off',version:VERSION,
  sourceSha256:SOURCE_SHA256,functionSha256:FUNCTION_SHA256,acknowledged,
  recurringCaptureChanged:JSON.stringify(before.catalog.capture)!==JSON.stringify(after.catalog.capture),
  providerRequests:0};
}
export async function liveReadback({token=savedCliToken(),read=readStage}={}) {
 return assess(await read({token}),true);
}
export async function rehearseTest({token=savedCliToken(),fetcher=fetch}={}) {
 const base=readFileSync(new URL('../../supabase/migrations/20261106120000_new_dawn_commusoft_job_detail_read.sql',import.meta.url),'utf8');
 if(sha(base)!=='efa37817cb8e27246f8044be7aac9543663ae1419924cdf1a0461ee5abd27dae')
  throw Error('source_user_reference_test_base_changed');
 const presence=`select to_regclass('public.new_dawn_commusoft_job_detail_reads') is not null as detail,
  to_regprocedure('public.new_dawn_job_source_user_reference(uuid,uuid,text)') is null as reference_absent`;
 const before=await management(TEST_PROJECT,token,'/database/query/read-only',presence,true,fetcher);
 if(before.length!==1 || before[0].reference_absent!==true) throw Error('source_user_reference_test_baseline_changed');
 const strip=sql=>sql.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'').replace(/\ncommit;\s*$/i,'');
 const q=`begin;\n${before[0].detail?'':strip(base)}\n${reviewedSource().body}\nselect
  encode(sha256(convert_to(pg_get_functiondef('public.new_dawn_job_source_user_reference(uuid,uuid,text)'::regprocedure),'UTF8')),'hex') function_hash,
  has_function_privilege('authenticated','public.new_dawn_job_source_user_reference(uuid,uuid,text)','EXECUTE') authenticated_granted,
  not has_function_privilege('anon','public.new_dawn_job_source_user_reference(uuid,uuid,text)','EXECUTE') anon_denied,
  not has_function_privilege('service_role','public.new_dawn_job_source_user_reference(uuid,uuid,text)','EXECUTE') service_denied;
rollback;`;
 const rows=await management(TEST_PROJECT,token,'/database/query',q,false,fetcher);
 if(rows.length!==1 || rows[0].function_hash!==FUNCTION_SHA256 ||
  ['authenticated_granted','anon_denied','service_denied'].some(k=>rows[0][k]!==true))
  throw Error('source_user_reference_test_compile_or_grants_changed');
 const after=await management(TEST_PROJECT,token,'/database/query/read-only',presence,true,fetcher);
 if(JSON.stringify(after)!==JSON.stringify(before)) throw Error('source_user_reference_test_rollback_changed');
 return {state:'source_user_reference_test_compiled_and_rolled_back',sourceSha256:SOURCE_SHA256,providerRequests:0};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {const [mode,pin]=process.argv.slice(2);
  if(mode==='--test-rollback-only' && !pin) console.log(JSON.stringify(await rehearseTest()));
  else {if(process.env.NEW_DAWN_M2_ALLOW_PROJECT!==PROJECT) throw Error('exact_live_project_required');
   if(mode==='--live-read-only' && !pin) console.log(JSON.stringify(assess(await readStage(),false)));
   else if(mode==='--live-readback' && !pin) console.log(JSON.stringify(await liveReadback()));
   else if(mode==='--live-install-exact' && pin===`--source-sha=${SOURCE_SHA256}` &&
    process.env.NEW_DAWN_M2_REFERENCE_ALLOW_SHA===SOURCE_SHA256)
    console.log(JSON.stringify(await installLive()));
   else throw Error('source_user_reference_exact_mode_or_pin_required');}
 } catch(error) {console.error(JSON.stringify({state:'source_user_reference_release_stopped',
   code:error instanceof Error?error.message:'unknown',retryAllowed:false,providerRequests:0}));process.exitCode=1;}
}
