import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, failCloseSql, switchSql } from './new-dawn-m2-isolated-users-one-page-trial.mjs';

const startHash='77d837d144b2100b025b86e8adcb1dd04fd176c811f75609c087c286c850b9a1';
const base={flags:[{flag:'learn.enabled',value:true},
  {flag:'learn.inputs.commusoft.enabled',value:true}],enabled_tenants:0,
  page_requests:0,page_states:[],versions:0,arms:0,disarms:0,aborts:0,
  flag_audit:[],connections:1,start_hash:startHash};

test('one-page release accepts only the intended Drummonds sequence',()=>{
  assert.equal(assess(base,'before').pageRequests,0);
  assert.equal(assess({...base,flags:[...base.flags,
    {flag:'new_dawn.m2_isolated_users_page',value:false}],arms:1,aborts:1,
    flag_audit:[{action:'new_dawn.m2.users_page_gate_enabled'},
      {action:'new_dawn.m2.users_page_gate_aborted'}]},'before').pageRequests,0);
  const armed={...base,flags:[...base.flags,
    {flag:'new_dawn.m2_isolated_users_page',value:true}],enabled_tenants:1,
    arms:1,flag_audit:[{action:'new_dawn.m2.users_page_gate_enabled'}]};
  assert.equal(assess(armed,'armed').isolatedGateEnabled,true);
  const closed={...armed,flags:[...base.flags,
    {flag:'new_dawn.m2_isolated_users_page',value:false}],enabled_tenants:0,
    page_requests:1,page_states:[{state:'complete',record_count:2,has_more:true}],
    versions:2,disarms:1,flag_audit:[...armed.flag_audit,
      {action:'new_dawn.m2.users_page_gate_disabled'}]};
  assert.equal(assess(closed,'closed').retainedVersions,2);
  assert.throws(()=>assess({...closed,versions:3},'closed'),/scope_changed/);
  assert.throws(()=>assess({...base,flags:[...base.flags,
    {flag:'learn.inputs.commusoft.users.enabled',value:true}]},'before'),/scope_changed/);
});

test('arm, close and emergency close touch only the isolated gate',()=>{
  const armed=switchSql(true),closed=switchSql(false),failed=failCloseSql();
  for(const sql of [armed,closed,failed]){
    assert.match(sql,/lock table public\.feature_flags/);
    assert.match(sql,/controlplane_change_log/);
    assert.match(sql,/new_dawn\.m2_isolated_users_page/);
    assert.doesNotMatch(sql,/(?:insert into|update) public\.provider_connections/i);
    assert.doesNotMatch(sql,/(?:insert into|update) public\.learn_commusoft_recurring/i);
    assert.doesNotMatch(sql,/(?:insert into|update) public\.learn_business_input_versions/i);
    assert.doesNotMatch(sql,/(?:insert into|update) public\.feature_flags[^;]*learn\.inputs\.commusoft\.users\.enabled/i);
  }
  assert.match(armed,/values\('[^']+'::uuid,'new_dawn\.m2_isolated_users_page','true'::jsonb\)/);
  assert.match(closed,/state='complete'/);
  assert.match(failed,/claimed_at>clock_timestamp\(\)-interval '45 seconds'/);
});
