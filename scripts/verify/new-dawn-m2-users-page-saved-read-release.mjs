/** Exact default-off LIVE release for the operator-only saved /users page read. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { PROJECT, TENANT } from './new-dawn-m2-live-preflight.mjs';

export const VERSION='20261108160000';
export const NAME='new_dawn_commusoft_isolated_users_page_saved_read';
export const SOURCE_SHA256='c7d6c42f08a5026d2a0f59e8740fcb5a4232f5d60ca07c2b70d5eae841e2ca46';
export const FUNCTION_SHA256='66db4e28c972b7292eb9ac4f1e5959fe13d1aea3e27c39d03fb55ffda2248e6c';
const EDGE=Object.freeze({id:'88886e8a-5c3b-4763-8851-31584c9a5319',
 slug:'learn-commusoft-users-page',version:1,verify_jwt:true,status:'ACTIVE',
 ezbr_sha256:'51958f3b08a5d99b001310760bb320c5493124c3cb89ce6e77aa70f3410149d5'});
const PRIOR=Object.freeze([
 ['20261105180000','commusoft_source_users','bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501'],
 ['20261105190000','commusoft_source_users_resume','cbb7498d28b2a4bb7c238fed65ee7f1441fcf1cb70cb513e43ed7bcd7a86708d'],
 ['20261106150000','new_dawn_commusoft_shared_lease','a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b'],
 ['20261106160000','new_dawn_commusoft_shared_lease_routes','6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953'],
 ['20261106180000','new_dawn_commusoft_lease_coexistence','e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f'],
 ['20261107130000','new_dawn_job_source_user_reference','826eec0619cff80897885b329ee4583dcd732f28e0221fa76ee66a6cfa5b3d7d'],
 ['20261107160000','new_dawn_commusoft_job_closure_source_facts','ab50173c908aa8e3ed7edcf73cf87793d83a99b28c015d302e6f07eeed2306f8'],
 ['20261108150000','new_dawn_commusoft_isolated_users_page','4880ba027964fffcf63f64212b81ea265d18bece77cc8cfcdb6634b842c6d6f5'],
]);
const FUNCTIONS=Object.freeze({
 'learn_commusoft_shared_lease_acquire(text, text, text)':'80738e960f3cc1846dec411bde34fe3e9e66345352fe3f861a5fc2f84f877273',
 'learn_commusoft_shared_lease_release(text, text)':'e1bb249dd5b21814aec7b07441954efc673a67db28650677fd01be2efd3d3bcd',
 'learn_operator_input_access(uuid, uuid, boolean)':'1fbcfaf5e4fa63e9d645a6c34399a487d100db2053dd6eb14055b4468abcf0d2',
 'new_dawn_commusoft_job_actor_access(uuid, uuid)':'c219bb0b06c71235a999e7656504f3eb2b74739dadbd5de47c6a5f21789a2a6d',
 'new_dawn_commusoft_users_page_finish(uuid, jsonb)':'6708060ebb83b163f051ad3bce6cae8a8a70fd01a3d2a3993a0c6eda9312817d',
 'new_dawn_commusoft_users_page_start(uuid, uuid, uuid, bigint, text)':'59a91835ea5b7170f0053dd5d0a4ea11808a8a6b4907f068eb81a3b895625ef9',
});
const TEST_CHAIN=Object.freeze([
 ['20261105180000_commusoft_source_users',PRIOR[0][2]],
 ['20261105190000_commusoft_source_users_resume',PRIOR[1][2]],
 ['20261106120000_new_dawn_commusoft_job_detail_read','efa37817cb8e27246f8044be7aac9543663ae1419924cdf1a0461ee5abd27dae'],
 ['20261106130000_new_dawn_commusoft_opportunities_probe','b69d9e46e89554f1497291f9e72a24aa4338090d4bf37559d23503d8e69a3708'],
 ['20261106150000_new_dawn_commusoft_shared_lease',PRIOR[2][2]],
 ['20261106160000_new_dawn_commusoft_shared_lease_routes',PRIOR[3][2]],
 ['20261106180000_new_dawn_commusoft_lease_coexistence',PRIOR[4][2]],
 ['20261107130000_new_dawn_job_source_user_reference',PRIOR[5][2]],
 ['20261108150000_new_dawn_commusoft_isolated_users_page',PRIOR[7][2]],
 [`${VERSION}_${NAME}`,SOURCE_SHA256],
]);
const sha=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const signature=name=>`public.${name.replaceAll(', ', ',')}`;
const versions=[...PRIOR.map(x=>x[0]),VERSION];
const ledgerSql=`select version::text,name,cardinality(statements) statement_count,
 encode(sha256(convert_to(statements[1],'UTF8')),'hex') source_hash
 from supabase_migrations.schema_migrations where version::text in (${versions.map(quote).join(',')})
 order by version::text`;
const catalogSql=`select jsonb_build_object(
 'functions',(select coalesce(jsonb_object_agg(p.proname||'('||oidvectortypes(p.proargtypes)||')',
  encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')),'{}'::jsonb)
  from pg_proc p where p.oid in (${Object.keys(FUNCTIONS).map(name=>`to_regprocedure('${signature(name)}')`).join(',')})),
 'saved',(select jsonb_build_object('hash',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
  'definer',p.prosecdef,'config',p.proconfig,
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service',has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_proc p where p.oid=to_regprocedure('public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)')),
 'tenant_status',(select status from public.tenants where id='${TENANT}'::uuid),
 'operator_admin_count',(select count(*) from public.platform_authority_grants g
  join public.profiles p on p.id=g.profile_id join auth.users u on u.id=g.profile_id
  where g.permission='platform.controlplane.admin' and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp()),
 'security',jsonb_build_object(
  'reads_rls',(select relrowsecurity from pg_class where oid=to_regclass('public.new_dawn_commusoft_users_page_reads')),
  'versions_rls',(select relrowsecurity from pg_class where oid=to_regclass('public.new_dawn_commusoft_users_page_versions')),
  'authenticated_reads',has_table_privilege('authenticated','public.new_dawn_commusoft_users_page_reads','SELECT'),
  'anon_reads',has_table_privilege('anon','public.new_dawn_commusoft_users_page_reads','SELECT'),
  'service_reads',has_table_privilege('service_role','public.new_dawn_commusoft_users_page_reads','SELECT'),
  'authenticated_versions',has_table_privilege('authenticated','public.new_dawn_commusoft_users_page_versions','SELECT'),
  'anon_versions',has_table_privilege('anon','public.new_dawn_commusoft_users_page_versions','SELECT'),
  'service_versions',has_table_privilege('service_role','public.new_dawn_commusoft_users_page_versions','SELECT'),
  'operator_start',has_function_privilege('authenticated','public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)','EXECUTE'),
  'anon_start',has_function_privilege('anon','public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)','EXECUTE'),
  'service_start',has_function_privilege('service_role','public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)','EXECUTE')),
 'flags',(select coalesce(jsonb_agg(jsonb_build_object('flag',flag,'value',value) order by flag),'[]'::jsonb)
  from public.feature_flags where tenant_id='${TENANT}'::uuid and flag in
  ('learn.enabled','learn.inputs.commusoft.enabled','learn.inputs.commusoft.users.enabled','new_dawn.m2_source_user_reference')),
 'capture',(select coalesce(jsonb_agg(jsonb_build_object('status',j.status,
  'resource',a.settings#>>'{commusoft_import,resource}',
  'cursor_hash',encode(sha256(convert_to(a.sync_cursor::text,'UTF8')),'hex'),
  'account_hash',encode(sha256(convert_to(a.settings::text||a.sync_cursor::text,'UTF8')),'hex')) order by j.id),'[]'::jsonb)
  from public.platform_jobs j left join public.connector_accounts a on a.tenant_id=j.tenant_id
   and a.id::text=j.payload->>'connector_account_id'
  where j.tenant_id='${TENANT}'::uuid and j.job_type='commusoft.source_sync'
   and j.status in('queued','running','retrying')),
 'reads_count',(select count(*) from public.new_dawn_commusoft_users_page_reads),
 'versions_count',(select count(*) from public.new_dawn_commusoft_users_page_versions)
) as catalog`;

export function reviewedSource() {
 const source=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),'utf8');
 if(sha(source)!==SOURCE_SHA256 || !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source) || !/\ncommit;\s*$/i.test(source))
  throw Error('saved_users_page_reviewed_sql_changed');
 const body=source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'').replace(/\ncommit;\s*$/i,'');
 if(/^\s*(begin|commit);\s*$/im.test(body) || /\b(?:update|delete|truncate)\s+public\.(?:connector_accounts|platform_jobs|feature_flags)\b/i.test(body))
  throw Error('saved_users_page_scope_changed');
 return {source,body};
}
export function assess(snapshot,installed=false) {
 if(snapshot?.project?.id!==PROJECT || snapshot.project.status!=='ACTIVE_HEALTHY' ||
  !Array.isArray(snapshot.ledger) || !Array.isArray(snapshot.functions) || !snapshot.catalog)
  throw Error('saved_users_page_project_unconfirmed');
 const expected=[...PRIOR,...(installed?[[VERSION,NAME,SOURCE_SHA256]]:[])].sort((a,b)=>a[0].localeCompare(b[0]));
 if(snapshot.ledger.length!==expected.length || expected.some(([v,n,h],i)=>{
  const row=snapshot.ledger[i];return row?.version!==v || row.name!==n || row.statement_count!==1 || row.source_hash!==h;}))
  throw Error('saved_users_page_prerequisite_ledger_changed');
 const c=snapshot.catalog;
 if(Object.entries(FUNCTIONS).some(([name,hash])=>c.functions?.[name]!==hash) ||
  c.tenant_status!=='active' || !Number.isInteger(Number(c.operator_admin_count)) ||
  Number(c.operator_admin_count)<1 || Number(c.reads_count)!==0 || Number(c.versions_count)!==0 ||
  (installed ? c.saved?.hash!==FUNCTION_SHA256 || c.saved.definer!==true ||
   JSON.stringify(c.saved.config)!==JSON.stringify(['search_path=pg_catalog']) ||
   c.saved.anon!==false || c.saved.authenticated!==true || c.saved.service!==false
   : c.saved!==null)) throw Error('saved_users_page_function_or_tenant_changed');
 if(c.security?.reads_rls!==true || c.security?.versions_rls!==true ||
  c.security?.authenticated_reads!==false || c.security?.anon_reads!==false ||
  c.security?.service_reads!==false || c.security?.authenticated_versions!==false ||
  c.security?.anon_versions!==false || c.security?.service_versions!==false ||
  c.security?.operator_start!==true || c.security?.anon_start!==false ||
  c.security?.service_start!==false) throw Error('saved_users_page_table_grants_changed');
 if(JSON.stringify(c.flags)!==JSON.stringify([
  {flag:'learn.enabled',value:true},{flag:'learn.inputs.commusoft.enabled',value:true}]))
  throw Error('saved_users_page_default_off_flags_changed');
 if(!Array.isArray(c.capture) || c.capture.some(row=>
  !['queued','running','retrying'].includes(row.status) ||
  !['properties','jobs','propertyContacts'].includes(row.resource) ||
  !/^[a-f0-9]{64}$/.test(row.cursor_hash) || !/^[a-f0-9]{64}$/.test(row.account_hash)))
  throw Error('saved_users_page_recurring_capture_unconfirmed');
 const edge=snapshot.functions.filter(f=>f.slug===EDGE.slug);
 if(edge.length!==1 || Object.entries(EDGE).some(([key,value])=>edge[0][key]!==value))
  throw Error('saved_users_page_edge_changed');
 return {state:installed?'saved_users_page_installed_default_off':'saved_users_page_ready_default_off',
  version:VERSION,sourceSha256:SOURCE_SHA256,functionSha256:installed?FUNCTION_SHA256:null,
  recurringJobs:c.capture.length,captureFingerprints:c.capture.map(x=>x.account_hash),providerRequests:0};
}
export function releaseSql(rollback=false) {
 const {source,body}=reviewedSource();
 const prerequisites=PRIOR.map(([v,n,h])=>`not exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${v}' and name='${n}' and cardinality(statements)=1
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${h}')`).join(' or\n  ');
 const functionChecks=Object.entries(FUNCTIONS).map(([name,hash])=>
  `encode(sha256(convert_to(pg_get_functiondef('${signature(name)}'::regprocedure),'UTF8')),'hex')<>'${hash}'`).join(' or\n  ');
 return `begin;
set local lock_timeout='3s';set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $saved_gate$ begin
 if ${prerequisites}
  or ${functionChecks}
  or exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)') is not null
  or (select status from public.tenants where id='${TENANT}'::uuid) is distinct from 'active'
  or not exists(select 1 from public.platform_authority_grants g
   join public.profiles p on p.id=g.profile_id join auth.users u on u.id=g.profile_id
   where g.permission='platform.controlplane.admin' and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp())
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
    and coalesce(g.effective_to,'infinity')>clock_timestamp())
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
  or exists(select 1 from public.new_dawn_commusoft_users_page_reads)
  or exists(select 1 from public.new_dawn_commusoft_users_page_versions)
  or (select relrowsecurity from pg_class where oid='public.new_dawn_commusoft_users_page_reads'::regclass) is distinct from true
  or (select relrowsecurity from pg_class where oid='public.new_dawn_commusoft_users_page_versions'::regclass) is distinct from true
  or has_table_privilege('authenticated','public.new_dawn_commusoft_users_page_versions','SELECT')
  or has_table_privilege('authenticated','public.new_dawn_commusoft_users_page_reads','SELECT')
  or has_table_privilege('anon','public.new_dawn_commusoft_users_page_versions','SELECT')
  or has_table_privilege('anon','public.new_dawn_commusoft_users_page_reads','SELECT')
  or has_table_privilege('service_role','public.new_dawn_commusoft_users_page_versions','SELECT')
  or has_table_privilege('service_role','public.new_dawn_commusoft_users_page_reads','SELECT')
  or not has_function_privilege('authenticated','public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)','EXECUTE')
  or has_function_privilege('anon','public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)','EXECUTE')
  or has_function_privilege('service_role','public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)','EXECUTE')
 then raise exception 'saved_users_page_exact_live_preflight_changed';end if;
end $saved_gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(source)}]);
select '${VERSION}' as installed_saved_version;
${rollback?'rollback':'commit'};`;
}
async function management(project,token,path,query=null,readOnly=true,fetcher=fetch) {
 const response=await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
  method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(90000),
  headers:{Authorization:`Bearer ${token}`,...(query?{'Content-Type':'application/json'}:{})},
  ...(query?{body:JSON.stringify({query,read_only:readOnly})}:{})});
 if(!response.ok) throw Error(`saved_users_page_${readOnly?'read':'write'}_http_${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>1024*1024) throw Error('saved_users_page_management_oversized');
 return JSON.parse(bytes.toString('utf8'));
}
export async function readStage({token=savedCliToken(),fetcher=fetch}={}) {
 const [project,ledger,functions,rows]=await Promise.all([
  management(PROJECT,token,'',null,true,fetcher),
  management(PROJECT,token,'/database/query/read-only',ledgerSql,true,fetcher),
  management(PROJECT,token,'/functions',null,true,fetcher),
  management(PROJECT,token,'/database/query/read-only',catalogSql,true,fetcher)]);
 if(!Array.isArray(rows)||rows.length!==1) throw Error('saved_users_page_catalog_unconfirmed');
 return {project,ledger,functions,catalog:rows[0].catalog};
}
export async function installLive({token=savedCliToken(),read=readStage,write}={}) {
 const before=await read({token});assess(before,false);
 const writer=write??(sql=>management(PROJECT,token,'/database/query',sql,false));
 let acknowledged=false;
 try {const rows=await writer(releaseSql());acknowledged=rows?.some?.(r=>r.installed_saved_version===VERSION)===true;}
 catch { /* Unknown outcome: independent readback, never automatic replay. */ }
 let after;try {after=await read({token});assess(after,true);}
 catch {throw Error('saved_users_page_install_outcome_unverified_no_replay');}
 return {state:'saved_users_page_installed_default_off',version:VERSION,
  sourceSha256:SOURCE_SHA256,functionSha256:FUNCTION_SHA256,acknowledged,
  recurringCaptureChanged:JSON.stringify(before.catalog.capture)!==JSON.stringify(after.catalog.capture),
  providerRequests:0};
}
export async function liveReadback({token=savedCliToken(),read=readStage}={}) {
 return assess(await read({token}),true);
}
export async function rehearseTest({token=savedCliToken(),fetcher=fetch}={}) {
 const presence=`select to_regclass('public.new_dawn_commusoft_users_page_reads') is null as reads_absent,
  to_regprocedure('public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)') is null as saved_absent`;
 const before=await management(TEST_PROJECT,token,'/database/query/read-only',presence,true,fetcher);
 if(before.length!==1 || before[0].reads_absent!==true || before[0].saved_absent!==true)
  throw Error('saved_users_page_test_baseline_changed');
 const strip=sql=>sql.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'').replace(/\ncommit;\s*$/i,'');
 const bodies=TEST_CHAIN.map(([name,hash])=>{
  const source=readFileSync(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
  if(sha(source)!==hash) throw Error('saved_users_page_test_chain_changed');
  return strip(source);
 });
 const q=`begin;\n${bodies.join('\n')}\nselect
  encode(sha256(convert_to(pg_get_functiondef('public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)'::regprocedure),'UTF8')),'hex') as function_hash,
  has_function_privilege('authenticated','public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)','EXECUTE') as authenticated_granted,
  not has_function_privilege('anon','public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)','EXECUTE') as anon_denied,
  not has_function_privilege('service_role','public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)','EXECUTE') as service_denied,
  not has_table_privilege('authenticated','public.new_dawn_commusoft_users_page_versions','SELECT') as raw_versions_denied;
rollback;`;
 const rows=await management(TEST_PROJECT,token,'/database/query',q,false,fetcher);
 if(rows.length!==1 || rows[0].function_hash!==FUNCTION_SHA256 ||
  ['authenticated_granted','anon_denied','service_denied','raw_versions_denied'].some(k=>rows[0][k]!==true))
  throw Error('saved_users_page_test_compile_or_grants_changed');
 const after=await management(TEST_PROJECT,token,'/database/query/read-only',presence,true,fetcher);
 if(JSON.stringify(after)!==JSON.stringify(before)) throw Error('saved_users_page_test_rollback_changed');
 return {state:'saved_users_page_test_compiled_and_rolled_back',chainFiles:TEST_CHAIN.length,
  sourceSha256:SOURCE_SHA256,functionSha256:FUNCTION_SHA256,providerRequests:0};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {const [mode,pin]=process.argv.slice(2);
  if(mode==='--test-rollback-only' && !pin) console.log(JSON.stringify(await rehearseTest()));
  else {if(process.env.NEW_DAWN_M2_ALLOW_PROJECT!==PROJECT) throw Error('exact_live_project_required');
   if(mode==='--live-read-only' && !pin) console.log(JSON.stringify(assess(await readStage(),false)));
   else if(mode==='--live-readback' && !pin) console.log(JSON.stringify(await liveReadback()));
   else if(mode==='--live-install-exact' && pin===`--source-sha=${SOURCE_SHA256}` &&
    process.env.NEW_DAWN_M2_SAVED_READ_ALLOW_SHA===SOURCE_SHA256)
    console.log(JSON.stringify(await installLive()));
   else throw Error('saved_users_page_exact_mode_or_pin_required');}
 } catch(error) {console.error(JSON.stringify({state:'saved_users_page_release_stopped',
   code:error instanceof Error?error.message:'unknown',retryAllowed:false,providerRequests:0}));process.exitCode=1;}
}
