import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLaunchRelease } from './learn-test-launch-release.mjs';
import { SOURCE_SHA256,RELEASE_NAME,catalogFingerprint } from './learn-test-launch-rehearsal.mjs';
import { TEST_PROJECT,TEST_ORGANIZATION,READ_CONTRACT,assessTestCatalog } from './learn-test-readiness.mjs';
const snapshot=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-schema-2026-10-09.json',import.meta.url)));
const bootstrap=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-readiness-2026-10-09.json',import.meta.url))).customMigrationEntries;
const token='sbp_'+'a'.repeat(40),reader='learn_launch_metadata_reader';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
function inventory(installed){
  const s=structuredClone(snapshot);
  s.launchMetadata={reader:null,relations:[]};
  if(!installed)return s;
  s.launchMetadata.reader={name:reader,canLogin:false,inherit:false,superuser:false,bypassRls:false,
    createDb:false,createRole:false,replication:false,publicCreate:false,memberships:[]};
  for(const [name,raw] of Object.entries({profiles:'id,tenant_id,role',...READ_CONTRACT.launch})){
    const t=s.tables.find(t=>t.schema==='public'&&t.name===name);
    t.policies.push({name:name==='profiles'?'learn_launch_metadata_profile':'learn_launch_metadata_select',
      roles:[reader],command:'SELECT',using:'synthetic unverified expression',check:null});
    s.launchMetadata.relations.push({name,kind:'r',owner:'postgres',rls:true,options:[],readerWrite:false,
      authenticatedSelect:false,anonSelect:false,policies:t.policies,
      columns:t.columns.map(c=>({name:c.name,readerSelect:raw.split(',').includes(c.name),readerWrite:false,
        authenticatedSelect:false,anonSelect:false,authenticatedWrite:false}))});
    if(name==='profiles')continue;
    s.launchMetadata.relations.push({name:`learn_launch_${name}`,kind:'v',owner:reader,rls:false,
      options:['security_barrier=true','security_invoker=false'],definition:'synthetic unverified projection',
      authenticatedSelect:true,anonSelect:false,authenticatedWrite:false,policies:[],
      columns:raw.split(',').map(name=>({name,authenticatedSelect:true,anonSelect:false,authenticatedWrite:false}))});
  }
  return s;
}
const receipt={migration_name:RELEASE_NAME,project_ref:TEST_PROJECT,source_sha256:SOURCE_SHA256,applied_at:new Date().toISOString()};
function fixture({already=false,writeError=false,missingReceipt=false,drift=false,postUnavailable=false,org=TEST_ORGANIZATION}={}){
  const before=inventory(false),report=assessTestCatalog(before,[]);report.customMigrationEntries=bootstrap;
  const fingerprint=catalogFingerprint({inventory:before,functions:[],report});
  const proof={version:'learn-test-launch-rehearsal/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,
    state:'rehearsed_and_rolled_back',acknowledged:true,catalogUnchanged:true,observedAfter:new Date(Date.now()-1000).toISOString(),
    beforeCatalogSha256:fingerprint,afterCatalogSha256:fingerprint};
  const calls=[];let written=false;
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/database/query')){
      written=true;
      if(writeError)return reply({message:'secret '+token,code:'42501'},400);
      return reply([{release:'learn-test-launch-release/1',source_sha256:SOURCE_SHA256}],201);
    }
    if(postUnavailable&&written)return reply({},503);
    if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:org,status:'ACTIVE_HEALTHY'});
    if(url.endsWith('/functions'))return reply([]);
    const active=already||(written&&!writeError);
    if(JSON.parse(options.body).query.includes('as inventory')){
      const s=inventory(active);
      if(drift&&written)s.tables.find(t=>t.name==='profiles').columns[0].notNull=false;
      return reply([{inventory:s}]);
    }
    return reply(active&&!missingReceipt?[...bootstrap,receipt]:bootstrap);
  };
  return {proof,fetcher,calls};
}
test('matching fresh rehearsal permits one fixed TEST release with an atomic receipt and checked post-state',async()=>{
  const f=fixture();const r=await applyLaunchRelease({allowProjectRef:TEST_PROJECT,token,rehearsal:f.proof,fetcher:f.fetcher});
  assert.equal(r.state,'installed_needs_user_verification');assert.equal(r.existingSourceCatalogPreserved,true);
  const writes=f.calls.filter(c=>c.url.endsWith('/database/query'));assert.equal(writes.length,1);
  const sql=JSON.parse(writes[0].options.body).query;
  assert.match(sql,/insert into of_test_deploy.migrations/);assert.match(sql,/notify pgrst,'reload schema'/);
  assert.equal((sql.match(/^commit;$/gm)??[]).length,1);
  assert.ok(f.calls.every(c=>c.url.includes(TEST_PROJECT)&&c.options.redirect==='error'));
});
test('existing matching receipt and views are inspected without another write',async()=>{
  const f=fixture({already:true});const r=await applyLaunchRelease({allowProjectRef:TEST_PROJECT,token,rehearsal:null,fetcher:f.fetcher});
  assert.equal(r.state,'already_installed_needs_user_verification');assert.equal(r.writeAttempted,false);
  assert.equal(f.calls.some(c=>c.url.endsWith('/database/query')),false);
});
test('expired, future, mismatched or unacknowledged rehearsal cannot authorize a write',async()=>{
  for(const change of [{observedAfter:'2000-01-01T00:00:00Z'},{observedAfter:'2100-01-01T00:00:00Z'},
    {sourceSha256:'a'.repeat(64)},{afterCatalogSha256:'a'.repeat(64)},{acknowledged:false},{projectRef:'foreign'}]){
    const f=fixture();Object.assign(f.proof,change);
    await assert.rejects(()=>applyLaunchRelease({allowProjectRef:TEST_PROJECT,token,rehearsal:f.proof,fetcher:f.fetcher}),/rehearsal/);
    assert.equal(f.calls.some(c=>c.url.endsWith('/database/query')),false);
  }
});
test('failure, drift, missing receipt and unavailable post-state require inspection and never retry',async()=>{
  for(const options of [{writeError:true},{missingReceipt:true},{drift:true},{postUnavailable:true}]){
    const f=fixture(options);const r=await applyLaunchRelease({allowProjectRef:TEST_PROJECT,token,rehearsal:f.proof,fetcher:f.fetcher});
    assert.equal(r.state,'release_requires_inspection');
    assert.equal(f.calls.filter(c=>c.url.endsWith('/database/query')).length,1);
    assert.equal(JSON.stringify(r).includes(token),false);
  }
});
test('foreign targets and organization changes are rejected before any write',async()=>{
  for(const options of [{allowProjectRef:'production'},{org:'foreign'}]){
    const f=fixture(options);
    await assert.rejects(()=>applyLaunchRelease({allowProjectRef:options.allowProjectRef??TEST_PROJECT,token,rehearsal:f.proof,fetcher:f.fetcher}));
    assert.equal(f.calls.some(c=>c.url.endsWith('/database/query')),false);
  }
});
