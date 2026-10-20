import test from 'node:test';
import assert from 'node:assert/strict';
import {assess,flagSql,PROJECT,TENANT,FLAG} from './new-dawn-daily-job-status-flag.mjs';

const snapshot=on=>({project:{id:PROJECT,status:'ACTIVE_HEALTHY'},scope:{
 installed:true,migration_rows:1,target_rows:on?1:0,global_on:Number(on),
 tenant_on:Number(on),other_rows:0,input_flags_on:2,connections:1,audit_immutable:true}});

test('Drummonds-only scope needs installed worker SQL, inputs and append-only audit',()=>{
 assert.equal(assess(snapshot(false),false,{activation:true}).providerRequests,0);
 for(const change of [{project:{id:'another'}},{scope:{input_flags_on:1}},
  {scope:{other_rows:1}},{scope:{audit_immutable:false}},
  {scope:{migration_rows:0}},{scope:{connections:2}}]){
  const wrong=structuredClone(snapshot(false));
  Object.assign(wrong.project,change.project);
  Object.assign(wrong.scope,change.scope);
  assert.throws(()=>assess(wrong,false,{activation:true}),/scope_changed/);
 }
});

test('switch SQL fences the exact project tenant and audit without provider writes',()=>{
 const id='9f4cf88a-496c-45d9-a804-f62978443212';
 const on=flagSql(true,id),off=flagSql(false,id);
 for(const sql of [on,off]){
  assert.match(sql,/lock table public\.feature_flags/);
  assert.match(sql,/lock table public\.controlplane_change_log/);
  assert.match(sql,new RegExp(TENANT));
  assert.match(sql,new RegExp(FLAG.replaceAll('.','\\.')));
  assert.match(sql,/insert into public\.controlplane_change_log/);
  assert.doesNotMatch(sql,/\bdelete from|\btruncate\s|https?:\/\/|\/api\/v2\/jobs/);
 }
 assert.match(on,/insert into public\.feature_flags/);
 assert.match(on,/update public\.feature_flags set value='true'/);
 assert.match(on,/\(select count\(\*\) from public\.feature_flags where flag='new_dawn\.daily_job_status\.enabled'\)>1/);
 assert.match(off,/update public\.feature_flags set value='false'/);
 assert.throws(()=>flagSql(true,'invalid'),/invalid_action/);
});
