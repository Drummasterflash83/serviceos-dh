import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assess, releaseSql, edgeRequest, installLive, deployEdge, SOURCE_SHA256, VERSION, EDGE } from './new-dawn-m2-isolated-users-page-release.mjs';
import { PROJECT } from './new-dawn-m2-live-preflight.mjs';
const required=[
 ['20261105180000','commusoft_source_users','bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501'],
 ['20261105190000','commusoft_source_users_resume','cbb7498d28b2a4bb7c238fed65ee7f1441fcf1cb70cb513e43ed7bcd7a86708d'],
 ['20261106150000','new_dawn_commusoft_shared_lease','a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b'],
 ['20261106160000','new_dawn_commusoft_shared_lease_routes','6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953'],
 ['20261106180000','new_dawn_commusoft_lease_coexistence','e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f'],
 ['20261107130000','new_dawn_job_source_user_reference','826eec0619cff80897885b329ee4583dcd732f28e0221fa76ee66a6cfa5b3d7d'],
 ['20261107160000','new_dawn_commusoft_job_closure_source_facts','ab50173c908aa8e3ed7edcf73cf87793d83a99b28c015d302e6f07eeed2306f8'],
];
const hashes={
 'learn_commusoft_shared_lease_acquire(text, text, text)':['3d7ba859c9d16777cd525dce0938733a01dc5578a6e4f73bd97c367ef97c2243','80738e960f3cc1846dec411bde34fe3e9e66345352fe3f861a5fc2f84f877273'],
 'learn_commusoft_shared_lease_release(text, text)':['42a56b8a6a8cd6855be631984c6cb38491dac3f2311dba7184bfc15424e97f28','e1bb249dd5b21814aec7b07441954efc673a67db28650677fd01be2efd3d3bcd'],
 'new_dawn_job_source_user_reference(uuid, uuid, text)':['9554aa521fe74d19f8220820a84133dbc89289c1a6b00455bf41d493aae093c3','07bd26fad5515f1c6569e232e315144fa1b19de0de20522a49d6039327708983'],
};
function snapshot(stage='before') {
 const installed=stage!=='before';
 return {project:{id:PROJECT,status:'ACTIVE_HEALTHY'},
  ledger:[...required,...(installed?[[VERSION,'new_dawn_commusoft_isolated_users_page',SOURCE_SHA256]]:[])]
   .map(([version,name,source_hash])=>({version,name,source_hash,statement_count:1})),
  catalog:{functions:Object.fromEntries(Object.entries(hashes).map(([k,v])=>[k,v[installed?1:0]])),
   objects:{reference:true,reads:installed,versions:installed,start:installed},
   security:{reads_rls:installed,versions_rls:installed,anon_read:false,authenticated_read:false,
    anon_versions:false,authenticated_versions:false,operator_start:installed,anon_start:false},
   flags:[{flag:'learn.enabled',value:true},{flag:'learn.inputs.commusoft.enabled',value:true}],
   capture:[{job_status:'running',resource:'propertyContacts',cursor_hash:'a'.repeat(64),account_state_hash:'b'.repeat(64)}],
   reads_count:0,versions_count:0},
  functions:stage==='edge'?[{slug:EDGE.slug,status:'ACTIVE',version:1,verify_jwt:true,ezbr_sha256:EDGE.ezbrSha256}]:[]};
}
test('exact stage checks enforce prerequisite hashes, default-off flags and no existing route',()=>{
 assert.equal(assess(snapshot(),'before').state,'isolated_users_prerequisite_ready');
 assert.equal(assess(snapshot('sql'),'sql').state,'isolated_users_sql_default_off_readback');
 assert.equal(assess(snapshot('edge'),'edge').state,'isolated_users_edge_default_off_readback');
 for (const mutate of [s=>s.ledger.pop(),s=>s.ledger[0].source_hash='0'.repeat(64),
  s=>s.catalog.flags.push({flag:'learn.inputs.commusoft.users.enabled',value:true}),
  s=>s.catalog.capture[0].resource='users',s=>s.catalog.objects.reference=false,
  s=>s.functions.push({slug:EDGE.slug})]) {
  const s=snapshot();mutate(s);assert.throws(()=>assess(s,'before'));
 }
});
test('release SQL is pinned, default-off and rollback-capable',()=>{
 const sql=releaseSql();
 for(const [version,,hash] of required) {assert.ok(sql.includes(version));assert.ok(sql.includes(hash));}
 assert.ok(sql.includes(SOURCE_SHA256)===false); // source itself is inserted; only its exact reviewed bytes are used.
 assert.match(sql,/lock table supabase_migrations\.schema_migrations/);
 assert.match(sql,/new_dawn_job_source_user_reference/);
 assert.match(sql,/select '20261108150000' as installed_users_version/);
 assert.match(releaseSql(true),/rollback;$/);
 assert.doesNotMatch(sql,/update public\.connector_accounts|update public\.platform_jobs/i);
});
test('uncertain SQL write is read back once and never replayed, while capture may advance',async()=>{
 let reads=0,writes=0;
 const result=await installLive({token:'synthetic',read:async()=>{
  reads++;const s=snapshot(reads===1?'before':'sql');
  if(reads===2) s.catalog.capture[0].cursor_hash='c'.repeat(64);
  return s;},write:async()=>{writes++;throw Error('transport_timeout');}});
 assert.equal(reads,2);assert.equal(writes,1);assert.equal(result.acknowledged,false);
 assert.equal(result.recurringCaptureChanged,true);
});
test('uncertain SQL outcome never replays when independent readback fails',async()=>{
 let reads=0,writes=0;
 await assert.rejects(installLive({token:'synthetic',read:async()=>{
  reads++;return reads===1?snapshot():snapshot();},
  write:async()=>{writes++;throw Error('transport_timeout');}}),/no_replay/);
 assert.equal(writes,1);assert.equal(reads,2);
});
test('new Edge endpoint request is pinned and JWT-verified',()=>{
 const req=edgeRequest();const url=new URL(req.url);
 assert.equal(req.method,'POST');assert.equal(url.searchParams.get('slug'),EDGE.slug);
 assert.equal(url.searchParams.get('verify_jwt'),'true');
 assert.equal(url.searchParams.get('ezbr_sha256'),EDGE.ezbrSha256);
});
test('Edge prewrite read catches flag drift before any upload',async()=>{
 let reads=0,writes=0;
 await assert.rejects(deployEdge({artifactPath:'synthetic',token:'synthetic',
  artifactReader:()=>Buffer.from('synthetic-artifact'),read:async()=>{
   const s=snapshot('sql');if(++reads===2) s.catalog.flags.push({flag:'learn.inputs.commusoft.users.enabled',value:true});
   return s;},fetcher:async()=>{writes++;throw Error('should_not_write');}}));
 assert.equal(reads,2);assert.equal(writes,0);
});
test('uncertain Edge upload invokes independent readback once and never replays',async()=>{
 let reads=0,writes=0,postReads=0;
 const result=await deployEdge({artifactPath:'synthetic',token:'synthetic',
  artifactReader:()=>Buffer.from('synthetic-artifact'),read:async()=>{reads++;return snapshot('sql');},
  fetcher:async()=>{writes++;throw Error('transport_timeout');},
  post:async()=>{postReads++;return {state:'isolated_users_edge_executable_readback'};}});
 assert.equal(reads,2);assert.equal(writes,1);assert.equal(postReads,1);
 assert.equal(result.acknowledged,false);
});
