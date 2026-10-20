import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assess, installLive, releaseSql, reviewedSource, VERSION, NAME,
 SOURCE_SHA256, FUNCTION_SHA256 } from './new-dawn-m2-users-page-saved-read-release.mjs';
import { PROJECT } from './new-dawn-m2-live-preflight.mjs';

const ledger=[
 ['20261105180000','commusoft_source_users','bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501'],
 ['20261105190000','commusoft_source_users_resume','cbb7498d28b2a4bb7c238fed65ee7f1441fcf1cb70cb513e43ed7bcd7a86708d'],
 ['20261106150000','new_dawn_commusoft_shared_lease','a984a2fc235699d3d92ea4980191cb786bc94740e481b3c1ffa8c9004f41848b'],
 ['20261106160000','new_dawn_commusoft_shared_lease_routes','6a9eaac74785cefb1ca53351dfc77f55adce112af97cd721d71cb6789935c953'],
 ['20261106180000','new_dawn_commusoft_lease_coexistence','e1e631ff7c6f2142120e32ffe9132b22cf9bba9301481204f23ab22a3759067f'],
 ['20261107130000','new_dawn_job_source_user_reference','826eec0619cff80897885b329ee4583dcd732f28e0221fa76ee66a6cfa5b3d7d'],
 ['20261107160000','new_dawn_commusoft_job_closure_source_facts','ab50173c908aa8e3ed7edcf73cf87793d83a99b28c015d302e6f07eeed2306f8'],
 ['20261108150000','new_dawn_commusoft_isolated_users_page','4880ba027964fffcf63f64212b81ea265d18bece77cc8cfcdb6634b842c6d6f5'],
];
const functionHashes={
 'learn_commusoft_shared_lease_acquire(text, text, text)':'80738e960f3cc1846dec411bde34fe3e9e66345352fe3f861a5fc2f84f877273',
 'learn_commusoft_shared_lease_release(text, text)':'e1bb249dd5b21814aec7b07441954efc673a67db28650677fd01be2efd3d3bcd',
 'learn_operator_input_access(uuid, uuid, boolean)':'1fbcfaf5e4fa63e9d645a6c34399a487d100db2053dd6eb14055b4468abcf0d2',
 'new_dawn_commusoft_job_actor_access(uuid, uuid)':'c219bb0b06c71235a999e7656504f3eb2b74739dadbd5de47c6a5f21789a2a6d',
 'new_dawn_commusoft_users_page_finish(uuid, jsonb)':'6708060ebb83b163f051ad3bce6cae8a8a70fd01a3d2a3993a0c6eda9312817d',
 'new_dawn_commusoft_users_page_start(uuid, uuid, uuid, bigint, text)':'59a91835ea5b7170f0053dd5d0a4ea11808a8a6b4907f068eb81a3b895625ef9',
};
function snapshot(installed=false) {
 const rows=[...ledger,...(installed?[[VERSION,NAME,SOURCE_SHA256]]:[])].sort((a,b)=>a[0].localeCompare(b[0]));
 return {project:{id:PROJECT,status:'ACTIVE_HEALTHY'},
  ledger:rows.map(([version,name,source_hash])=>({version,name,source_hash,statement_count:1})),
  functions:[{id:'88886e8a-5c3b-4763-8851-31584c9a5319',slug:'learn-commusoft-users-page',
   version:1,verify_jwt:true,status:'ACTIVE',ezbr_sha256:'51958f3b08a5d99b001310760bb320c5493124c3cb89ce6e77aa70f3410149d5'}],
  catalog:{functions:{...functionHashes},saved:installed?{hash:FUNCTION_SHA256,definer:true,
   config:['search_path=pg_catalog'],anon:false,authenticated:true,service:false}:null,
   tenant_status:'active',operator_admin_count:1,security:{reads_rls:true,versions_rls:true,
    authenticated_reads:false,anon_reads:false,service_reads:false,
    authenticated_versions:false,anon_versions:false,service_versions:false,
    operator_start:true,anon_start:false,service_start:false},
   flags:[{flag:'learn.enabled',value:true},{flag:'learn.inputs.commusoft.enabled',value:true}],
   capture:[{status:'running',resource:'propertyContacts',cursor_hash:'a'.repeat(64),account_hash:'b'.repeat(64)}],
   reads_count:0,versions_count:0}};
}
test('exact before and after snapshots require tenant, grants, flags, Edge and ledger',()=>{
 assert.equal(assess(snapshot()).state,'saved_users_page_ready_default_off');
 assert.equal(assess(snapshot(true),true).functionSha256,FUNCTION_SHA256);
 for(const mutate of [s=>s.ledger[0].source_hash='0'.repeat(64),
  s=>s.catalog.functions['new_dawn_commusoft_users_page_start(uuid, uuid, uuid, bigint, text)']='0'.repeat(64),
  s=>s.catalog.flags.push({flag:'learn.inputs.commusoft.users.enabled',value:true}),
  s=>s.catalog.tenant_status='suspended',s=>s.catalog.operator_admin_count=0,
  s=>s.catalog.security.authenticated_versions=true,
  s=>s.functions[0].ezbr_sha256='0'.repeat(64),s=>s.catalog.capture[0].resource='users']) {
  const value=snapshot();mutate(value);assert.throws(()=>assess(value));
 }
 const installed=snapshot(true);installed.catalog.saved.service=true;
 assert.throws(()=>assess(installed,true));
});
test('installer uses exact source and transaction gate with rollback form',()=>{
 assert.ok(reviewedSource().body.includes('new_dawn_commusoft_users_page_saved'));
 const sql=releaseSql();
 for(const [version,,hash] of ledger) {assert.ok(sql.includes(version));assert.ok(sql.includes(hash));}
 for(const hash of Object.values(functionHashes)) assert.ok(sql.includes(hash));
 assert.match(sql,/new_dawn\.m2_source_user_reference/);
 assert.match(sql,/new_dawn_commusoft_users_page_saved\(uuid,uuid,uuid\)/);
 assert.match(sql,/select '20261108160000' as installed_saved_version/);
 assert.match(releaseSql(true),/rollback;$/);
 assert.doesNotMatch(sql,/update public\.(feature_flags|connector_accounts|platform_jobs)/i);
});
test('unknown write is read back independently once without replay; recurring cursor can advance',async()=>{
 let reads=0,writes=0;
 const result=await installLive({token:'synthetic',read:async()=>{
  const value=snapshot(++reads===2);
  if(reads===2) value.catalog.capture[0].cursor_hash='c'.repeat(64);
  return value;},write:async()=>{writes++;throw Error('timeout');}});
 assert.equal(reads,2);assert.equal(writes,1);
 assert.equal(result.acknowledged,false);assert.equal(result.recurringCaptureChanged,true);
});
test('unverified write outcome stops without a second install attempt',async()=>{
 let reads=0,writes=0;
 await assert.rejects(installLive({token:'synthetic',read:async()=>{reads++;return snapshot();},
  write:async()=>{writes++;throw Error('timeout');}}),/no_replay/);
 assert.equal(reads,2);assert.equal(writes,1);
});
