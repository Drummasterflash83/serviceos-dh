import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLaunchMetadata, READER_ROLE } from './learn-launch-metadata-catalog.mjs';
import { READ_CONTRACT } from './learn-test-readiness.mjs';
const contract = READ_CONTRACT.launch;
function fixture() {
  const reader = {name:READER_ROLE,canLogin:false,inherit:false,superuser:false,bypassRls:false,
    createDb:false,createRole:false,replication:false,publicCreate:false,memberships:[]};
  const sources = Object.entries({profiles:'id,tenant_id,role',...contract}).map(([name,raw]) => ({
    name,kind:'r',owner:'synthetic_admin',rls:true,options:[],readerWrite:false,
    authenticatedSelect:false,anonSelect:false,
    columns:raw.split(',').map(name=>({name,readerSelect:true,readerWrite:false,authenticatedSelect:false,anonSelect:false,authenticatedWrite:false})),
    policies:[{name:name==='profiles'?'learn_launch_metadata_profile':'learn_launch_metadata_select',command:'SELECT',roles:[READER_ROLE]}],
  }));
  const views = Object.entries(contract).map(([name,raw])=>({
    name:`learn_launch_${name}`,kind:'v',owner:READER_ROLE,rls:false,
    options:['security_barrier=true','security_invoker=false'],definition:'Synthetic unverified definition',
    authenticatedSelect:true,authenticatedWrite:false,anonSelect:false,policies:[],
    columns:raw.split(',').map(name=>({name,authenticatedSelect:true,authenticatedWrite:false,anonSelect:false})),
  }));
  return {reader,relations:[...sources,...views]};
}
test('missing historical catalog remains unobserved; no role or views remains blocked',()=>{
  assert.equal(assessLaunchMetadata(undefined,contract).state,'not_observed');
  const r=assessLaunchMetadata({reader:null,relations:[]},contract);
  assert.equal(r.state,'blocked');assert.deepEqual(r.roleIssues,['missing_reader_role']);
  assert.equal(r.views.length,8);
  assert.ok(r.views.every(v=>v.issues.includes('missing_view')));
});
test('matching metadata never proves view redaction, tenant isolation or deployment',()=>{
  const r=assessLaunchMetadata(fixture(),contract);
  assert.equal(r.state,'needs_semantic_and_user_verification');
  assert.ok(r.views.every(v=>v.state==='needs_projection_and_user_verification'));
  assert.ok(r.sources.every(s=>s.state==='needs_policy_semantics_verification'));
});
test('powerful, inherited, accessible or incompletely observed reader roles cannot pass',()=>{
  for(const key of ['canLogin','inherit','superuser','bypassRls','createDb','createRole','replication','publicCreate']) {
    for(const value of [true,undefined]) {
      const c=fixture();c.reader[key]=value;
      assert.equal(assessLaunchMetadata(c,contract).state,'blocked',key);
    }
  }
  const c=fixture();c.reader.memberships=[{role:READER_ROLE,member:'authenticated'}];
  assert.equal(assessLaunchMetadata(c,contract).state,'blocked');
});
test('only the known source owner may retain PostgreSQL automatic ADMIN without SET or INHERIT',()=>{
  const c=fixture();for(const r of c.relations.filter(r=>r.kind==='r'))r.owner='postgres';
  c.reader.memberships=[{role:READER_ROLE,member:'postgres',grantor:'supabase_admin',admin:true,inherit:false,set:false}];
  assert.equal(assessLaunchMetadata(c,contract).state,'needs_semantic_and_user_verification');
  for(const change of [{member:'authenticated'},{member:'another_owner'},{grantor:'unknown'},{set:true},{inherit:true},{admin:false}]){
    const altered=structuredClone(c);Object.assign(altered.reader.memberships[0],change);
    assert.equal(assessLaunchMetadata(altered,contract).state,'blocked');
  }
  c.relations.find(r=>r.name==='profiles').owner='unknown';
  assert.equal(assessLaunchMetadata(c,contract).state,'blocked');
});
test('unsafe view owners/options/columns and column-only grants are recognized',()=>{
  const mutations=[r=>r.owner='postgres',r=>r.kind='m',r=>r.options=['security_invoker=true'],
    r=>r.columns.push({name:'transcript_text'}),r=>r.columns.pop(),r=>r.authenticatedSelect=false,
    r=>r.columns[0].anonSelect=true,r=>r.columns[0].authenticatedWrite=true,
    r=>delete r.columns[0].authenticatedWrite,r=>r.definition=null];
  for(const mutate of mutations){
    const c=fixture();mutate(c.relations.find(r=>r.kind==='v'));
    assert.equal(assessLaunchMetadata(c,contract).state,'blocked');
  }
});
test('source exposure, RLS bypass and changed reader policy scope remain blocked',()=>{
  const mutations=[r=>r.rls=false,r=>r.owner=READER_ROLE,r=>r.readerWrite=true,
    r=>r.columns[0].readerWrite=true,r=>r.columns[0].readerSelect=false,
    r=>r.columns.push({name:'secret',readerSelect:true,readerWrite:false}),
    r=>r.columns[0].authenticatedSelect=true,r=>r.columns[0].anonSelect=true,
    r=>r.policies[0].roles=['public'],r=>r.policies[0].command='ALL'];
  for(const mutate of mutations){
    const c=fixture();mutate(c.relations.find(r=>r.name==='phone_transcripts'));
    assert.equal(assessLaunchMetadata(c,contract).state,'blocked');
  }
});
test('duplicate or malformed relation evidence cannot be silently accepted',()=>{
  const c=fixture();c.relations.push(c.relations[0]);
  assert.throws(()=>assessLaunchMetadata(c,contract),/Invalid/);
  assert.throws(()=>assessLaunchMetadata({},contract),/Incomplete/);
  const unexpected=fixture();unexpected.relations.push({...unexpected.relations.at(-1),name:'learn_launch_extra'});
  assert.equal(assessLaunchMetadata(unexpected,contract).state,'blocked');
});
