/** Exact default-off release for the separately gated isolated /users page. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { PROJECT, TENANT } from './new-dawn-m2-live-preflight.mjs';
import { TEST_CHAIN } from './new-dawn-m2-users-page-saved-read-release.mjs';

export const VERSION='20261109110000';
export const NAME='new_dawn_isolated_users_page_flag';
export const SOURCE_SHA256='d642116a58070a81f10aa6e5ba78f69be37097618cda989536e1c911ba2962cb';
const EDGE={slug:'learn-commusoft-users-page',id:'88886e8a-5c3b-4763-8851-31584c9a5319',
  version:1,sha:'51958f3b08a5d99b001310760bb320c5493124c3cb89ce6e77aa70f3410149d5'};
const FUNCTIONS={
  new_dawn_commusoft_users_page_guard:['800b61e6aff71dc6eeeaf8a1a896f8c262688091239b840604ad207b2a4c3be2','f425670d145b9147a3a58ad80bec93e1db41b5c7654e6aa4aec9300b24ba9dff'],
  new_dawn_commusoft_users_page_saved:['66db4e28c972b7292eb9ac4f1e5959fe13d1aea3e27c39d03fb55ffda2248e6c','8453be050286fd9edabdba5a89d82815ac4c4143078ad181d69a330e2b7049ab'],
  new_dawn_commusoft_users_page_start:['59a91835ea5b7170f0053dd5d0a4ea11808a8a6b4907f068eb81a3b895625ef9','77d837d144b2100b025b86e8adcb1dd04fd176c811f75609c087c286c850b9a1'],
};
const SIGNATURES=[
  'new_dawn_commusoft_users_page_guard(uuid)',
  'new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)',
  'new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)',
];
const PRIOR=[
  ['20261108150000','new_dawn_commusoft_isolated_users_page','4880ba027964fffcf63f64212b81ea265d18bece77cc8cfcdb6634b842c6d6f5'],
  ['20261108160000','new_dawn_commusoft_isolated_users_page_saved_read','c7d6c42f08a5026d2a0f59e8740fcb5a4232f5d60ca07c2b70d5eae841e2ca46'],
];
const sha=s=>createHash('sha256').update(s).digest('hex');
const strip=s=>s.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im,'').replace(/\ncommit;\s*$/i,'');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
export function reviewedSource() {
  const source=readFileSync(new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url),'utf8');
  if(sha(source)!==SOURCE_SHA256 || !source.includes('commit;')) throw Error('isolated_flag_source_changed');
  return {source,body:strip(source)};
}
const sql=`select
 (select coalesce(jsonb_object_agg(p.proname,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')),'{}'::jsonb)
  from pg_proc p where p.oid in (${SIGNATURES.map(s=>`to_regprocedure('public.${s}')`).join(',')})) functions,
 (select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname),'[]'::jsonb)
  from pg_proc p where p.oid in (${SIGNATURES.map(s=>`to_regprocedure('public.${s}')`).join(',')})) grants,
 (select coalesce(jsonb_agg(jsonb_build_object('version',version::text,'name',name,
  'hash',encode(sha256(convert_to(statements[1],'UTF8')),'hex'),'statements',cardinality(statements))
  order by version),'[]'::jsonb) from supabase_migrations.schema_migrations
  where version::text in (${[...PRIOR.map(x=>x[0]),VERSION].map(quote).join(',')})) ledger,
 (select coalesce(jsonb_agg(jsonb_build_object('flag',flag,'value',value) order by flag),'[]'::jsonb)
  from public.feature_flags where tenant_id='${TENANT}'::uuid and flag in
   ('learn.enabled','learn.inputs.commusoft.enabled','learn.inputs.commusoft.users.enabled',
    'new_dawn.m2_isolated_users_page')) flags,
 (select count(*)::integer from public.new_dawn_commusoft_users_page_reads) reads,
 (select count(*)::integer from public.new_dawn_commusoft_users_page_versions) versions`;
async function management(project,token,path,query=null,write=false,fetcher=fetch) {
  const response=await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
    method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,...(query?{'Content-Type':'application/json'}:{})},
    ...(query?{body:JSON.stringify({query,...(write?{read_only:false}:{})})}:{})});
  if(!response.ok) throw Error(`isolated_flag_${write?'write':'read'}_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>1024*1024)throw Error('isolated_flag_response_oversized');
  return JSON.parse(bytes.toString('utf8'));
}
export async function readStage(project=PROJECT,token=savedCliToken(),fetcher=fetch) {
  if(project!==PROJECT)throw Error('exact_live_project_required');
  const [info,functions,rows]=await Promise.all([
    management(project,token,'',null,false,fetcher),
    management(project,token,'/functions',null,false,fetcher),
    management(project,token,'/database/query/read-only',sql,false,fetcher)]);
  if(!Array.isArray(rows)||rows.length!==1)throw Error('isolated_flag_catalog_unconfirmed');
  return {project:info,functions,catalog:rows[0]};
}
export function assess(snapshot,installed=false) {
  const c=snapshot?.catalog;
  const edge=snapshot?.functions?.filter(f=>f.slug===EDGE.slug);
  const expectedGrants=[
    ['new_dawn_commusoft_users_page_guard',false,false,true],
    ['new_dawn_commusoft_users_page_saved',false,true,false],
    ['new_dawn_commusoft_users_page_start',false,true,false],
  ];
  if(snapshot?.project?.id!==PROJECT||snapshot.project.status!=='ACTIVE_HEALTHY'||
    edge?.length!==1||edge[0].id!==EDGE.id||edge[0].version!==EDGE.version||
    edge[0].ezbr_sha256!==EDGE.sha||edge[0].status!=='ACTIVE'||edge[0].verify_jwt!==true||
    !c||c.reads!==0||c.versions!==0||
    JSON.stringify(c.flags)!==JSON.stringify([
      {flag:'learn.enabled',value:true},{flag:'learn.inputs.commusoft.enabled',value:true}])||
    !Array.isArray(c.ledger)||c.ledger.length!==PRIOR.length+(installed?1:0)||
    [...PRIOR,...(installed?[[VERSION,NAME,SOURCE_SHA256]]:[])].some(([version,name,hash],i)=>
      c.ledger[i]?.version!==version||c.ledger[i]?.name!==name||
      c.ledger[i]?.hash!==hash||c.ledger[i]?.statements!==1)||
    Object.entries(FUNCTIONS).some(([name,hashes])=>c.functions?.[name]!==hashes[installed?1:0])||
    !Array.isArray(c.grants)||c.grants.length!==3||expectedGrants.some(([name,anon,auth,service],i)=>
      c.grants[i]?.name!==name||c.grants[i]?.anon!==anon||c.grants[i]?.auth!==auth||
      c.grants[i]?.service!==service))
    throw Error('isolated_flag_scope_or_release_changed');
  return {state:installed?'isolated_users_flag_installed_default_off':'isolated_users_flag_ready',
    version:VERSION,sourceSha256:SOURCE_SHA256,legacyUsersImport:false,isolatedPageEnabled:false,
    retainedUsersPages:0,providerRequests:0};
}
export function releaseSql() {
  const {source,body}=reviewedSource();
  return `begin;\nset local lock_timeout='3s';set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(source)}]);
select '${VERSION}' as installed_flag_version;
commit;`;
}
export async function testRollback(token=savedCliToken(),fetcher=fetch) {
  const source=reviewedSource();
  const before=await management(TEST_PROJECT,token,'/database/query/read-only',
    "select to_regprocedure('public.new_dawn_commusoft_users_page_guard(uuid)') is null as absent",false,fetcher);
  if(before?.[0]?.absent!==true)throw Error('isolated_flag_test_baseline_changed');
  const bodies=TEST_CHAIN.map(([name,hash])=>{
    const s=readFileSync(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
    if(sha(s)!==hash)throw Error('isolated_flag_test_dependency_changed');return strip(s);
  });
  const testSql=`select
    (select jsonb_object_agg(p.proname,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'))
     from pg_proc p where p.oid in (${SIGNATURES.map(s=>`to_regprocedure('public.${s}')`).join(',')})) functions,
    (select jsonb_agg(jsonb_build_object('name',p.proname,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname)
     from pg_proc p where p.oid in (${SIGNATURES.map(s=>`to_regprocedure('public.${s}')`).join(',')})) grants,
    (select count(*)::integer from public.new_dawn_commusoft_users_page_reads) reads,
    (select count(*)::integer from public.new_dawn_commusoft_users_page_versions) versions`;
  const rows=await management(TEST_PROJECT,token,'/database/query',`begin;\n${bodies.join('\n')}
${source.body}\n${testSql};\nrollback;`,true,fetcher);
  if(rows?.length!==1||Object.entries(FUNCTIONS).some(([name,hashes])=>rows[0].functions?.[name]!==hashes[1])||
    rows[0].grants?.[0]?.service!==true||rows[0].grants?.[0]?.auth!==false||
    rows[0].grants?.[1]?.auth!==true||rows[0].grants?.[1]?.service!==false||
    rows[0].grants?.[2]?.auth!==true||rows[0].grants?.[2]?.service!==false||
    rows[0].grants?.some?.(g=>g.anon!==false)||
    rows[0].reads!==0||rows[0].versions!==0)throw Error('isolated_flag_test_compile_changed');
  const after=await management(TEST_PROJECT,token,'/database/query/read-only',
    "select to_regprocedure('public.new_dawn_commusoft_users_page_guard(uuid)') is null as absent",false,fetcher);
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('isolated_flag_test_rollback_changed');
  return {state:'isolated_flag_test_compiled_and_rolled_back',dependencyFiles:TEST_CHAIN.length,
    sourceSha256:SOURCE_SHA256,providerRequests:0};
}
export async function installLive(token=savedCliToken(),read=readStage,write=releaseSql) {
  await testRollback(token);
  assess(await read(PROJECT,token),false);
  let acknowledged=false;
  try {const rows=await management(PROJECT,token,'/database/query',write(),true);
    acknowledged=rows?.some?.(r=>r.installed_flag_version===VERSION)===true;}
  catch { /* Unknown write outcome: one independent readback, never replay automatically. */ }
  try {assess(await read(PROJECT,token),true);}
  catch {throw Error('isolated_flag_outcome_unverified_no_replay');}
  return {state:'isolated_users_flag_installed_default_off',version:VERSION,
    sourceSha256:SOURCE_SHA256,acknowledged,providerRequests:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {const [mode,pin]=process.argv.slice(2);
  if(mode==='--test-rollback-only'&&!pin)console.log(JSON.stringify(await testRollback()));
  else {if(process.env.NEW_DAWN_M2_ALLOW_PROJECT!==PROJECT)throw Error('exact_live_project_required');
   if(mode==='--live-read-only'&&!pin)console.log(JSON.stringify(assess(await readStage(),false)));
   else if(mode==='--live-readback'&&!pin)console.log(JSON.stringify(assess(await readStage(),true)));
   else if(mode==='--live-install-exact'&&pin===`--source-sha=${SOURCE_SHA256}`&&
     process.env.NEW_DAWN_M2_ISOLATED_FLAG_ALLOW_SHA===SOURCE_SHA256)
     console.log(JSON.stringify(await installLive()));
   else throw Error('isolated_flag_exact_mode_or_pin_required');}
 }catch(error){console.error(JSON.stringify({state:'isolated_flag_release_stopped',
  code:error instanceof Error?error.message:'unknown',retryAllowed:false,providerRequests:0}));
  process.exitCode=1;}
}
