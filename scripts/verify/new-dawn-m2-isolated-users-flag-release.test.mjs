import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, releaseSql, SOURCE_SHA256, VERSION } from './new-dawn-m2-isolated-users-flag-release.mjs';

const project='tgbnakbxwcqjeimygroz';
const hashes={
  new_dawn_commusoft_users_page_guard:['800b61e6aff71dc6eeeaf8a1a896f8c262688091239b840604ad207b2a4c3be2','f425670d145b9147a3a58ad80bec93e1db41b5c7654e6aa4aec9300b24ba9dff'],
  new_dawn_commusoft_users_page_saved:['66db4e28c972b7292eb9ac4f1e5959fe13d1aea3e27c39d03fb55ffda2248e6c','8453be050286fd9edabdba5a89d82815ac4c4143078ad181d69a330e2b7049ab'],
  new_dawn_commusoft_users_page_start:['59a91835ea5b7170f0053dd5d0a4ea11808a8a6b4907f068eb81a3b895625ef9','77d837d144b2100b025b86e8adcb1dd04fd176c811f75609c087c286c850b9a1'],
};
const prior=[
  ['20261108150000','new_dawn_commusoft_isolated_users_page','4880ba027964fffcf63f64212b81ea265d18bece77cc8cfcdb6634b842c6d6f5'],
  ['20261108160000','new_dawn_commusoft_isolated_users_page_saved_read','c7d6c42f08a5026d2a0f59e8740fcb5a4232f5d60ca07c2b70d5eae841e2ca46'],
];
function snapshot(installed=false) {
  return {project:{id:project,status:'ACTIVE_HEALTHY'},functions:[{
    slug:'learn-commusoft-users-page',id:'88886e8a-5c3b-4763-8851-31584c9a5319',
    version:1,ezbr_sha256:'51958f3b08a5d99b001310760bb320c5493124c3cb89ce6e77aa70f3410149d5',
    status:'ACTIVE',verify_jwt:true}],catalog:{
    functions:Object.fromEntries(Object.entries(hashes).map(([name,pair])=>[name,pair[installed?1:0]])),
    grants:[
      {name:'new_dawn_commusoft_users_page_guard',anon:false,auth:false,service:true},
      {name:'new_dawn_commusoft_users_page_saved',anon:false,auth:true,service:false},
      {name:'new_dawn_commusoft_users_page_start',anon:false,auth:true,service:false},
    ],
    ledger:[...prior,...(installed?[[VERSION,'new_dawn_isolated_users_page_flag',SOURCE_SHA256]]:[])]
      .map(([version,name,hash])=>({version,name,hash,statements:1})),
    flags:[{flag:'learn.enabled',value:true},{flag:'learn.inputs.commusoft.enabled',value:true}],
    reads:0,versions:0}};
}
test('the isolated route is independently gated; neither legacy import nor page is enabled by installation',()=>{
  assert.equal(assess(snapshot()).state,'isolated_users_flag_ready');
  assert.equal(assess(snapshot(true),true).state,'isolated_users_flag_installed_default_off');
  for(const flag of ['learn.inputs.commusoft.users.enabled','new_dawn.m2_isolated_users_page']){
    const changed=snapshot(true);changed.catalog.flags.push({flag,value:true});
    assert.throws(()=>assess(changed,true));
  }
  const retained=snapshot(true);retained.catalog.reads=1;
  assert.throws(()=>assess(retained,true));
  const altered=snapshot(true);altered.catalog.functions.new_dawn_commusoft_users_page_start='0'.repeat(64);
  assert.throws(()=>assess(altered,true));
  const widened=snapshot(true);widened.catalog.grants[1].anon=true;
  assert.throws(()=>assess(widened,true));
});
test('release records one pinned migration without enabling either users path',()=>{
  const sql=releaseSql();
  assert.match(sql,/insert into supabase_migrations\.schema_migrations/);
  assert.match(sql,/new_dawn\.m2_isolated_users_page/);
  assert.doesNotMatch(sql,/insert into public\.feature_flags/);
  assert.doesNotMatch(sql,/update public\.feature_flags/);
});
