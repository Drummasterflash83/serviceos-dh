/** Exact default-off LIVE release controls for the isolated Commusoft /users page. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { PROJECT, TENANT } from './new-dawn-m2-live-preflight.mjs';
import { reviewedEdgeBundle } from './new-dawn-m2-users-page-edge-prepare.mjs';

export const VERSION = '20261108150000';
export const NAME = 'new_dawn_commusoft_isolated_users_page';
export const SOURCE_SHA256 = '4880ba027964fffcf63f64212b81ea265d18bece77cc8cfcdb6634b842c6d6f5';
export const EDGE = Object.freeze({ slug: 'learn-commusoft-users-page', verify_jwt: true,
  closureSha256: '367e6d167d638b0e4c8b853fe0d723accbd6c19f311f5d15dce8ac051962909c',
  ezbrSha256: '51958f3b08a5d99b001310760bb320c5493124c3cb89ce6e77aa70f3410149d5',
  eszipSha256: '70192f03b05070e892bd18328f48966833009288d18ef753f109e47f4bab3f5b',
  ezbrBytes: 129131, eszipBytes: 539191 });
const REQUIRED = Object.freeze([
  ['20261105180000','commusoft_source_users','bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501'],
  ['20261105190000','commusoft_source_users_resume','cbb7498d28b2a4bb7c238fed65ee7f1441fcf1cb70cb513e43ed7bcd7a86708d'],
  ['20261106150000','new_dawn_commusoft_shared_lease','a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b'],
  ['20261106160000','new_dawn_commusoft_shared_lease_routes','6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953'],
  ['20261106180000','new_dawn_commusoft_lease_coexistence','e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f'],
  ['20261107130000','new_dawn_job_source_user_reference','826eec0619cff80897885b329ee4583dcd732f28e0221fa76ee66a6cfa5b3d7d'],
  // The already-published 071600 ledger version belongs to job closure.
  ['20261107160000','new_dawn_commusoft_job_closure_source_facts','ab50173c908aa8e3ed7edcf73cf87793d83a99b28c015d302e6f07eeed2306f8'],
]);
const FUNCTION_PINS = Object.freeze({
  'learn_commusoft_shared_lease_acquire(text, text, text)': ['3d7ba859c9d16777cd525dce0938733a01dc5578a6e4f73bd97c367ef97c2243','80738e960f3cc1846dec411bde34fe3e9e66345352fe3f861a5fc2f84f877273'],
  'learn_commusoft_shared_lease_release(text, text)': ['42a56b8a6a8cd6855be631984c6cb38491dac3f2311dba7184bfc15424e97f28','e1bb249dd5b21814aec7b07441954efc673a67db28650677fd01be2efd3d3bcd'],
  'new_dawn_job_source_user_reference(uuid, uuid, text)': ['9554aa521fe74d19f8220820a84133dbc89289c1a6b00455bf41d493aae093c3','07bd26fad5515f1c6569e232e315144fa1b19de0de20522a49d6039327708983'],
});
const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const TEST_CHAIN = Object.freeze([
  ['20261105180000_commusoft_source_users','bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501'],
  ['20261105190000_commusoft_source_users_resume','cbb7498d28b2a4bb7c238fed65ee7f1441fcf1cb70cb513e43ed7bcd7a86708d'],
  ['20261106120000_new_dawn_commusoft_job_detail_read','efa37817cb8e27246f8044be7aac9543663ae1419924cdf1a0461ee5abd27dae'],
  ['20261106130000_new_dawn_commusoft_opportunities_probe','b69d9e46e89554f1497291f9e72a24aa4338090d4bf37559d23503d8e69a3708'],
  ['20261106150000_new_dawn_commusoft_shared_lease','a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b'],
  ['20261106160000_new_dawn_commusoft_shared_lease_routes','6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953'],
  ['20261106180000_new_dawn_commusoft_lease_coexistence','e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f'],
  ['20261107130000_new_dawn_job_source_user_reference','826eec0619cff80897885b329ee4583dcd732f28e0221fa76ee66a6cfa5b3d7d'],
  [`${VERSION}_${NAME}`,SOURCE_SHA256],
]);
const versions = [...REQUIRED.map(x=>x[0]),VERSION];
const ledgerSql = `select version::text,name,cardinality(statements) statement_count,
 encode(sha256(convert_to(statements[1],'UTF8')),'hex') source_hash
 from supabase_migrations.schema_migrations
 where version::text in (${versions.map(quote).join(',')}) order by version::text`;
const catalogSql = `select jsonb_build_object(
 'functions',(select coalesce(jsonb_object_agg(p.proname||'('||oidvectortypes(p.proargtypes)||')',
  encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')),'{}'::jsonb)
  from pg_proc p where p.oid in (
   to_regprocedure('public.learn_commusoft_shared_lease_acquire(text,text,text)'),
   to_regprocedure('public.learn_commusoft_shared_lease_release(text,text)'),
   to_regprocedure('public.new_dawn_job_source_user_reference(uuid,uuid,text)'))),
 'objects',jsonb_build_object('reference',to_regprocedure('public.new_dawn_job_source_user_reference(uuid,uuid,text)') is not null,
  'reads',to_regclass('public.new_dawn_commusoft_users_page_reads') is not null,
  'versions',to_regclass('public.new_dawn_commusoft_users_page_versions') is not null,
  'start',to_regprocedure('public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)') is not null),
 'security',jsonb_build_object(
  'reads_rls',(select relrowsecurity from pg_class where oid=to_regclass('public.new_dawn_commusoft_users_page_reads')),
  'versions_rls',(select relrowsecurity from pg_class where oid=to_regclass('public.new_dawn_commusoft_users_page_versions')),
  'anon_read',has_table_privilege('anon',to_regclass('public.new_dawn_commusoft_users_page_reads'),'SELECT'),
  'authenticated_read',has_table_privilege('authenticated',to_regclass('public.new_dawn_commusoft_users_page_reads'),'SELECT'),
  'anon_versions',has_table_privilege('anon',to_regclass('public.new_dawn_commusoft_users_page_versions'),'SELECT'),
  'authenticated_versions',has_table_privilege('authenticated',to_regclass('public.new_dawn_commusoft_users_page_versions'),'SELECT'),
  'operator_start',has_function_privilege('authenticated',to_regprocedure('public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)'),'EXECUTE'),
  'anon_start',has_function_privilege('anon',to_regprocedure('public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)'),'EXECUTE')),
 'flags',(select coalesce(jsonb_agg(jsonb_build_object('flag',flag,'value',value) order by flag),'[]'::jsonb)
  from public.feature_flags where tenant_id='${TENANT}'::uuid and flag in
  ('learn.enabled','learn.inputs.commusoft.enabled','learn.inputs.commusoft.users.enabled','new_dawn.m2_source_user_reference')),
 'capture',(select coalesce(jsonb_agg(jsonb_build_object('job_status',j.status,
  'resource',a.settings#>>'{commusoft_import,resource}',
  'account_state_hash',encode(sha256(convert_to(a.settings::text||a.sync_cursor::text,'UTF8')),'hex'),
  'cursor_hash',encode(sha256(convert_to(a.sync_cursor::text,'UTF8')),'hex')) order by j.id),'[]'::jsonb)
  from public.platform_jobs j left join public.connector_accounts a on a.tenant_id=j.tenant_id
   and a.id::text=j.payload->>'connector_account_id'
  where j.tenant_id='${TENANT}'::uuid and j.job_type='commusoft.source_sync'
   and j.status in('queued','running','retrying')),
 'reads_count',(select count(*) from public.new_dawn_commusoft_users_page_reads),
 'versions_count',(select count(*) from public.new_dawn_commusoft_users_page_versions)
 ) as catalog`;
// Before installation the two candidate tables do not exist. Keep a separate
// projection so the preflight never fails while discovering an absent table.
const beforeCatalogSql = catalogSql.replace(
  "(select count(*) from public.new_dawn_commusoft_users_page_reads)", '0').replace(
  "(select count(*) from public.new_dawn_commusoft_users_page_versions)", '0');

export function reviewedSource() {
  const source = readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url),'utf8');
  if (sha(source)!==SOURCE_SHA256 || !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(source) || !/\ncommit;\s*$/i.test(source))
    throw Error('isolated_users_source_changed');
  const body=source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'').replace(/\ncommit;\s*$/i,'');
  if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error('isolated_users_nested_transaction');
  return {source,body};
}
export function reviewedArtifact(path) {
  const full=resolve(path), privateRoot=resolve('.verification-results')+'/';
  if (!full.startsWith(privateRoot) || !full.endsWith('/artifacts/'+EDGE.slug+'.ezbr'))
    throw Error('private_exact_artifact_required');
  const bytes=readFileSync(full);
  if (bytes.length!==EDGE.ezbrBytes || bytes.subarray(0,4).toString()!=='EZBR' || sha(bytes)!==EDGE.ezbrSha256)
    throw Error('isolated_users_artifact_changed');
  const eszip=brotliDecompressSync(bytes.subarray(4),{maxOutputLength:EDGE.eszipBytes});
  if (eszip.length!==EDGE.eszipBytes || sha(eszip)!==EDGE.eszipSha256 ||
    reviewedEdgeBundle().sha256!==EDGE.closureSha256) throw Error('isolated_users_executable_changed');
  return bytes;
}
export function assess(snapshot, stage='before') {
  if (!['before','sql','edge'].includes(stage)) throw Error('isolated_users_stage_invalid');
  const installed=stage!=='before';
  if (snapshot.project?.id!==PROJECT || snapshot.project.status!=='ACTIVE_HEALTHY' ||
      !Array.isArray(snapshot.ledger) || !snapshot.catalog || !Array.isArray(snapshot.functions))
    throw Error('isolated_users_snapshot_unconfirmed');
  const expected=[...REQUIRED,...(installed?[[VERSION,NAME,SOURCE_SHA256]]:[])];
  if (snapshot.ledger.length!==expected.length || expected.some((pin,i)=>
    snapshot.ledger[i]?.version!==pin[0] || snapshot.ledger[i]?.name!==pin[1] ||
    snapshot.ledger[i]?.statement_count!==1 || snapshot.ledger[i]?.source_hash!==pin[2]))
    throw Error('isolated_users_prerequisite_hash_or_ledger_changed');
  const c=snapshot.catalog;
  if (Object.entries(FUNCTION_PINS).some(([k,v])=>
     c.functions?.[k]!==v[installed?1:0]) || c.objects?.reference!==true ||
    ['reads','versions','start'].some(k=>c.objects?.[k]!==installed) ||
    (installed && (Number(c.reads_count)!==0 || Number(c.versions_count)!==0)))
    throw Error('isolated_users_function_or_object_changed');
  if (installed && (c.security?.reads_rls!==true || c.security?.versions_rls!==true ||
    c.security?.anon_read!==false || c.security?.authenticated_read!==false ||
    c.security?.anon_versions!==false || c.security?.authenticated_versions!==false ||
    c.security?.operator_start!==true || c.security?.anon_start!==false))
    throw Error('isolated_users_security_readback_changed');
  if (JSON.stringify(c.flags)!==JSON.stringify([
    {flag:'learn.enabled',value:true},{flag:'learn.inputs.commusoft.enabled',value:true}]))
    throw Error('isolated_users_flags_changed');
  if (!Array.isArray(c.capture) || c.capture.some(row=>
    !['properties','jobs','propertyContacts'].includes(row.resource) ||
    !/^[0-9a-f]{64}$/.test(row.cursor_hash) || !/^[0-9a-f]{64}$/.test(row.account_state_hash)))
    throw Error('isolated_users_recurring_capture_unconfirmed');
  const edge=snapshot.functions.filter(row=>row.slug===EDGE.slug);
  if (edge.length!==(stage==='edge'?1:0) || (stage==='edge' && (edge[0].status!=='ACTIVE' ||
    edge[0].version!==1 || edge[0].verify_jwt!==true || edge[0].ezbr_sha256!==EDGE.ezbrSha256)))
    throw Error('isolated_users_edge_state_changed');
  return {state:stage==='before'?'isolated_users_prerequisite_ready':stage==='sql'?'isolated_users_sql_default_off_readback':'isolated_users_edge_default_off_readback',
    version:VERSION,sourceSha256:SOURCE_SHA256,edgeSha256:EDGE.ezbrSha256,
    recurringActiveJobs:c.capture.length,recurringResources:c.capture.map(x=>x.resource),
    captureFingerprints:c.capture.map(x=>x.account_state_hash),flagsUnchanged:true,providerRequests:0};
}
export function releaseSql(rollback=false) {
  const {source,body}=reviewedSource();
  const prerequisite=REQUIRED.map(([v,n,h])=>`not exists(select 1 from supabase_migrations.schema_migrations
   where version::text='${v}' and name='${n}' and cardinality(statements)=1
    and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${h}')`).join(' or\n  ');
  return `begin;
set local lock_timeout='3s';set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $users_gate$ begin
 if ${prerequisite}
  or exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or to_regprocedure('public.new_dawn_job_source_user_reference(uuid,uuid,text)') is null
  or to_regclass('public.new_dawn_commusoft_users_page_reads') is not null
  or exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag in ('learn.inputs.commusoft.users.enabled','new_dawn.m2_source_user_reference'))
  or exists(select 1 from public.platform_jobs j left join public.connector_accounts a
   on a.tenant_id=j.tenant_id and a.id::text=j.payload->>'connector_account_id'
   where j.tenant_id='${TENANT}'::uuid and j.job_type='commusoft.source_sync'
    and j.status in('queued','running','retrying') and
    (a.id is null or a.status is distinct from 'active' or
     coalesce(a.settings#>>'{commusoft_import,resource}','') not in('properties','jobs','propertyContacts') or
     nullif(a.settings#>>'{commusoft_import,approvalId}','') is null))
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag in('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb)<>2
  or encode(sha256(convert_to(pg_get_functiondef('public.learn_commusoft_shared_lease_acquire(text,text,text)'::regprocedure),'UTF8')),'hex')<>'${FUNCTION_PINS['learn_commusoft_shared_lease_acquire(text, text, text)'][0]}'
  or encode(sha256(convert_to(pg_get_functiondef('public.learn_commusoft_shared_lease_release(text,text)'::regprocedure),'UTF8')),'hex')<>'${FUNCTION_PINS['learn_commusoft_shared_lease_release(text, text)'][0]}'
   or encode(sha256(convert_to(pg_get_functiondef('public.new_dawn_job_source_user_reference(uuid,uuid,text)'::regprocedure),'UTF8')),'hex')<>'${FUNCTION_PINS['new_dawn_job_source_user_reference(uuid, uuid, text)'][0]}'
 then raise exception 'isolated_users_exact_live_preflight_changed';end if;
end $users_gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(source)}]);
select '${VERSION}' as installed_users_version;
${rollback?'rollback':'commit'};`;
}
async function management(project,token,path,query=null,readOnly=true,fetcher=fetch) {
  const response=await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
    method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,...(query?{'Content-Type':'application/json'}:{})},
    ...(query?{body:JSON.stringify({query,read_only:readOnly})}:{})});
  if (!response.ok) throw Error(`isolated_users_${readOnly?'read':'write'}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if (bytes.length>1024*1024) throw Error('isolated_users_management_result_oversized');
  return JSON.parse(bytes.toString('utf8'));
}
export async function readStage({project=PROJECT,token=savedCliToken(),fetcher=fetch}={}) {
  if (project!==PROJECT) throw Error('exact_live_project_required');
  const [info,ledger,functions]=await Promise.all([
    management(project,token,'',null,true,fetcher),
    management(project,token,'/database/query/read-only',ledgerSql,true,fetcher),
    management(project,token,'/functions',null,true,fetcher)]);
  const installed=ledger?.some(row=>row.version===VERSION);
  const rows=await management(project,token,'/database/query/read-only',installed?catalogSql:beforeCatalogSql,true,fetcher);
  if (!Array.isArray(rows) || rows.length!==1) throw Error('isolated_users_catalog_unconfirmed');
  return {project:info,ledger,functions,catalog:rows[0].catalog};
}
export async function installLive({token=savedCliToken(),read=readStage,write}={}) {
  const before=await read({token});assess(before,'before');
  const writer=write??(sql=>management(PROJECT,token,'/database/query',sql,false));
  let acknowledged=false;
  try {const rows=await writer(releaseSql());acknowledged=rows?.some?.(r=>r.installed_users_version===VERSION)===true;}
  catch { /* Unknown outcome: independent readback, never automatic replay. */ }
  let after;try {after=await read({token});assess(after,'sql');}
  catch {throw Error('isolated_users_sql_outcome_unverified_no_replay');}
  return {state:'isolated_users_sql_installed_default_off',version:VERSION,
    sourceSha256:SOURCE_SHA256,acknowledged,recurringCaptureChanged:
      JSON.stringify(before.catalog.capture)!==JSON.stringify(after.catalog.capture),providerRequests:0};
}
export async function sqlReadback({token=savedCliToken(),read=readStage}={}) {
  const s=await read({token});
  return assess(s,'sql');
}
export function edgeRequest() {
  const params=new URLSearchParams({verify_jwt:'true',
    entrypoint_path:`file:///work/supabase/functions/${EDGE.slug}/index.ts`,
    ezbr_sha256:EDGE.ezbrSha256,slug:EDGE.slug,name:EDGE.slug});
  return {method:'POST',url:`https://api.supabase.com/v1/projects/${PROJECT}/functions?${params}`,
    contentType:'application/vnd.denoland.eszip'};
}
export function testRollbackSql() {
  const bodies=TEST_CHAIN.map(([name,hash])=>{
    const source=readFileSync(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
    if (sha(source)!==hash) throw Error('isolated_users_test_chain_source_changed');
    return source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'').replace(/\ncommit;\s*$/i,'');
  });
  return `begin;\n${bodies.join('\n')}\nselect
  encode(sha256(convert_to(pg_get_functiondef('public.learn_commusoft_shared_lease_acquire(text,text,text)'::regprocedure),'UTF8')),'hex') as acquire_hash,
  encode(sha256(convert_to(pg_get_functiondef('public.learn_commusoft_shared_lease_release(text,text)'::regprocedure),'UTF8')),'hex') as release_hash,
  encode(sha256(convert_to(pg_get_functiondef('public.new_dawn_job_source_user_reference(uuid,uuid,text)'::regprocedure),'UTF8')),'hex') as reference_hash,
  to_regclass('public.new_dawn_commusoft_users_page_reads') is not null as reads_present,
  to_regclass('public.new_dawn_commusoft_users_page_versions') is not null as versions_present,
  has_function_privilege('authenticated','public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)','EXECUTE') as operator_granted,
  not has_function_privilege('anon','public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)','EXECUTE') as anon_denied,
  not has_function_privilege('authenticated','public.new_dawn_commusoft_users_page_acquire(uuid)','EXECUTE') as acquire_denied,
  (select relrowsecurity from pg_class where oid='public.new_dawn_commusoft_users_page_reads'::regclass) as reads_rls,
  (select relrowsecurity from pg_class where oid='public.new_dawn_commusoft_users_page_versions'::regclass) as versions_rls,
  not has_table_privilege('anon','public.new_dawn_commusoft_users_page_versions','SELECT') as anon_versions_denied;
rollback;`;
}
const testCatalogSql = `select
 to_regclass('public.new_dawn_commusoft_users_page_reads') is null as reads_absent,
 to_regclass('public.new_dawn_commusoft_users_page_versions') is null as versions_absent,
 to_regprocedure('public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)') is null as start_absent`;
export async function rehearseTest({token=savedCliToken(),fetcher=fetch}={}) {
  const before=await management(TEST_PROJECT,token,'/database/query/read-only',testCatalogSql,true,fetcher);
  if (before.length!==1 || Object.values(before[0]).some(v=>v!==true))
    throw Error('isolated_users_test_baseline_changed');
  const rows=await management(TEST_PROJECT,token,'/database/query',testRollbackSql(),false,fetcher);
  if (rows.length!==1 || rows[0].acquire_hash!==FUNCTION_PINS['learn_commusoft_shared_lease_acquire(text, text, text)'][1] ||
    rows[0].release_hash!==FUNCTION_PINS['learn_commusoft_shared_lease_release(text, text)'][1] ||
    rows[0].reference_hash!==FUNCTION_PINS['new_dawn_job_source_user_reference(uuid, uuid, text)'][1] ||
    ['reads_present','versions_present','operator_granted','anon_denied','acquire_denied',
      'reads_rls','versions_rls','anon_versions_denied'].some(k=>rows[0][k]!==true))
    throw Error('isolated_users_test_compile_or_grants_changed');
  const after=await management(TEST_PROJECT,token,'/database/query/read-only',testCatalogSql,true,fetcher);
  if (JSON.stringify(after)!==JSON.stringify(before)) throw Error('isolated_users_test_rollback_changed');
  return {state:'isolated_users_test_compiled_and_rolled_back',chainFiles:TEST_CHAIN.length,
    sourceSha256:SOURCE_SHA256,providerRequests:0};
}
export async function edgeReadback({token=savedCliToken(),read=readStage,fetcher=fetch}={}) {
  const s=await read({token});const result=assess(s,'edge');
  const response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/functions/${EDGE.slug}/body`,{
    redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${token}`}});
  if (!response.ok) throw Error('isolated_users_edge_body_readback_unconfirmed');
  const body=Buffer.from(await response.arrayBuffer());
  if (body.length!==EDGE.eszipBytes || sha(body)!==EDGE.eszipSha256)
    throw Error('isolated_users_edge_executable_changed');
  return {...result,state:'isolated_users_edge_executable_readback',executableSha256:EDGE.eszipSha256};
}
export async function deployEdge({artifactPath,token=savedCliToken(),read=readStage,fetcher=fetch,
  post=edgeReadback,artifactReader=reviewedArtifact}={}) {
  const bytes=artifactReader(artifactPath);
  const before=await read({token});
  const edge=before.functions.filter(row=>row.slug===EDGE.slug);
  if (edge.length) throw Error('isolated_users_edge_already_exists');
  // SQL-only stage: exact ledger/objects/flags required, no source records.
  assess(before,'sql');
  const immediate=await read({token});assess(immediate,'sql');
  const stable=s=>JSON.stringify({project:s.project?.id,ledger:s.ledger,
    functions:s.functions.map(f=>[f.id,f.slug,f.version,f.ezbr_sha256,f.verify_jwt,f.status]),
    hashes:s.catalog.functions,objects:s.catalog.objects,security:s.catalog.security,
    flags:s.catalog.flags});
  if (stable(immediate)!==stable(before)) throw Error('isolated_users_edge_prewrite_state_changed');
  const request=edgeRequest();let acknowledged=false;
  try {const response=await fetcher(request.url,{method:request.method,redirect:'error',
    signal:AbortSignal.timeout(90000),headers:{Authorization:`Bearer ${token}`,
      'Content-Type':request.contentType},body:bytes});acknowledged=response.ok;
    await response.body?.cancel().catch(()=>{});}
  catch { /* Unknown outcome: independently read back, never retry automatically. */ }
  let after;try {after=await post({token});}
  catch {throw Error('isolated_users_edge_outcome_unverified_no_replay');}
  return {...after,acknowledged};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [mode,pin,artifactArg]=process.argv.slice(2);
    if (mode==='--test-rollback-only' && !pin && !artifactArg) console.log(JSON.stringify(await rehearseTest()));
    else {
    if (process.env.NEW_DAWN_M2_ALLOW_PROJECT!==PROJECT) throw Error('explicit_exact_live_project_required');
    if (mode==='--live-read-only' && !pin && !artifactArg) console.log(JSON.stringify(assess(await readStage(),'before')));
    else if (mode==='--live-sql-readback' && !pin && !artifactArg) console.log(JSON.stringify(await sqlReadback()));
    else if (mode==='--live-edge-readback' && !pin && !artifactArg) console.log(JSON.stringify(await edgeReadback()));
    else if (mode==='--live-install-sql-exact' && pin===`--source-sha=${SOURCE_SHA256}` && !artifactArg &&
      process.env.NEW_DAWN_M2_USERS_SQL_ALLOW_SHA===SOURCE_SHA256)
      console.log(JSON.stringify(await installLive()));
    else if (mode==='--live-deploy-edge-exact' && pin===`--edge-sha=${EDGE.ezbrSha256}` &&
      artifactArg?.startsWith('--artifact=') && process.env.NEW_DAWN_M2_USERS_EDGE_ALLOW_SHA===EDGE.ezbrSha256)
      console.log(JSON.stringify(await deployEdge({artifactPath:artifactArg.slice(11)})));
    else throw Error('isolated_users_exact_mode_or_pin_required');
    }
  } catch(error) {console.error(JSON.stringify({state:'isolated_users_release_stopped',
    code:error instanceof Error?error.message:'unknown',retryAllowed:false,providerRequests:0}));process.exitCode=1;}
}
