import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assess, installLive, releaseSql, VERSION, NAME, SOURCE_SHA256, FUNCTION_SHA256 } from './new-dawn-m2-source-user-reference-release.mjs';
import { PROJECT } from './new-dawn-m2-live-preflight.mjs';
const ledger=[
 ['20261105180000','commusoft_source_users','bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501'],
 ['20261105190000','commusoft_source_users_resume','cbb7498d28b2a4bb7c238fed65ee7f1441fcf1cb70cb513e43ed7bcd7a86708d'],
 ['20261106150000','new_dawn_commusoft_shared_lease','a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b'],
 ['20261106160000','new_dawn_commusoft_shared_lease_routes','6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953'],
 ['20261106180000','new_dawn_commusoft_lease_coexistence','e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f'],
 ['20261107160000','new_dawn_commusoft_job_closure_source_facts','ab50173c908aa8e3ed7edcf73cf87793d83a99b28c015d302e6f07eeed2306f8'],
];
function snapshot(installed=false) {
 const rows=[...ledger,...(installed?[[VERSION,NAME,SOURCE_SHA256]]:[])].sort((a,b)=>a[0].localeCompare(b[0]));
 return {project:{id:PROJECT,status:'ACTIVE_HEALTHY'},
  ledger:rows.map(([version,name,source_hash])=>({version,name,source_hash,statement_count:1})),
  functions:[{id:'009b9fb6-8e3c-49b8-8a3e-95531ba370bd',slug:'learn-commusoft-job-detail',
   version:6,ezbr_sha256:'b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb',
   status:'ACTIVE',verify_jwt:false}],
  catalog:{functions:{
   'new_dawn_commusoft_job_actor_access(uuid, uuid)':'c219bb0b06c71235a999e7656504f3eb2b74739dadbd5de47c6a5f21789a2a6d',
   'learn_operator_input_access(uuid, uuid, boolean)':'1fbcfaf5e4fa63e9d645a6c34399a487d100db2053dd6eb14055b4468abcf0d2',
   'new_dawn_commusoft_job_detail_finish(uuid, text)':'7c4bb1e4baf72f56935ed40dd441ea1cbd25412d205576583152677d7f4ce36c'},
   reference:installed?{hash:FUNCTION_SHA256,definer:true,config:['search_path=pg_catalog'],
    anon:false,authenticated:true,service:false}:null,detail_table:true,
   flags:[{flag:'learn.enabled',value:true},{flag:'learn.inputs.commusoft.enabled',value:true}],
   capture:[{resource:'propertyContacts',cursor_hash:'a'.repeat(64),account_hash:'b'.repeat(64)}]}};
}
test('before and after require exact ledger, grants, Edge and default-off flags',()=>{
 assert.equal(assess(snapshot()).state,'source_user_reference_ready_default_off');
 assert.equal(assess(snapshot(true),true).state,'source_user_reference_installed_default_off');
 for(const mutate of [s=>s.ledger[0].source_hash='0'.repeat(64),s=>s.ledger.pop(),
  s=>s.catalog.flags.push({flag:'new_dawn.m2_source_user_reference',value:true}),
  s=>s.catalog.capture[0].resource='users',s=>s.functions[0].ezbr_sha256='0'.repeat(64),
  s=>s.catalog.functions['new_dawn_commusoft_job_actor_access(uuid, uuid)']='0'.repeat(64)]) {
  const s=snapshot();mutate(s);assert.throws(()=>assess(s));
 }
 const s=snapshot(true);s.catalog.reference.service=true;assert.throws(()=>assess(s,true));
});
test('SQL checks exact prerequisite and closure hashes and leaves capture untouched',()=>{
 const sql=releaseSql();
 for(const [version,,hash] of ledger) {assert.ok(sql.includes(version));assert.ok(sql.includes(hash));}
 assert.match(sql,/new_dawn\.m2_source_user_reference/);
 assert.match(sql,/not in\('properties','jobs','propertyContacts'\)/);
 assert.match(sql,/select '20261107130000' as installed_reference_version/);
 assert.match(releaseSql(true),/rollback;$/);
 assert.doesNotMatch(sql,/update public\.(connector_accounts|platform_jobs)/i);
});
test('unknown write is independently read back once; recurring cursor may advance',async()=>{
 let reads=0,writes=0;
 const result=await installLive({token:'synthetic',read:async()=>{
  const s=snapshot(++reads===2);if(reads===2) s.catalog.capture[0].cursor_hash='c'.repeat(64);
  return s;},write:async()=>{writes++;throw Error('timeout');}});
 assert.equal(reads,2);assert.equal(writes,1);assert.equal(result.acknowledged,false);
 assert.equal(result.recurringCaptureChanged,true);
});
test('unverified outcome never replays the write',async()=>{
 let reads=0,writes=0;
 await assert.rejects(installLive({token:'synthetic',read:async()=>{reads++;return snapshot();},
  write:async()=>{writes++;throw Error('timeout');}}),/no_replay/);
 assert.equal(reads,2);assert.equal(writes,1);
});
