import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyFoundation,expectedFoundation,MARKER } from './learn-test-foundation-release.mjs';
import { readFoundationCatalog } from './learn-foundation-catalog.mjs';
import { foundationFingerprint,SOURCE_SHA256,MARKER as REHEARSAL_MARKER } from './learn-test-foundation-rehearsal.mjs';
import { TEST_PROJECT,TEST_ORGANIZATION } from './learn-test-readiness.mjs';
import { RELEASE_NAME } from './learn-foundation-bundle.mjs';
const load=n=>JSON.parse(readFileSync(new URL('../../docs/operations/evidence/'+n,import.meta.url)));
const base=load('learn-test-launch-installed-catalog-2026-10-09.json'),foundation=load('learn-test-foundation-schema-2026-10-09.json');
const expected=expectedFoundation(),token='sbp_'+'a'.repeat(40),now=Date.parse('2026-10-09T21:00:00Z');
function mock({installed=false,fail=false,unknown=false,drift=false,guardDrift=false,missingReceipt=false,unavailable=false,org=TEST_ORGANIZATION}={}){
 const calls=[];let wrote=false;
 const fetcher=async(url,o)=>{
  calls.push({url,o});
  if(url.endsWith('/database/query')){wrote=true;if(unknown)throw Error(token);return new Response(JSON.stringify(fail?{code:'23514',message:token}:[{release:MARKER,source_sha256:SOURCE_SHA256}]),{status:fail?400:201});}
  const active=installed||(wrote&&!fail&&!unknown);
  const reply=v=>new Response(JSON.stringify(v),{status:200});
  if(wrote&&unavailable)return new Response('unavailable',{status:503});
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:org,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(base.functions);
  const query=JSON.parse(o.body).query;
  if(query.includes('as inventory')){
   const i=structuredClone(base.inventory);
   if(active){
    i.tables.push(...expected.tables.map(t=>({...t,schema:'public',columns:t.columns.map(c=>({...c,authenticatedSelect:true}))})));
    i.functions.push({name:'learn_foundation_reference_guard',arguments:'',securityDefiner:true,authenticatedExecute:false,anonExecute:false});
   }
   return reply([{inventory:i}]);
  }
  if(query.includes('as catalog')){
   const c=structuredClone(foundation);delete c.base;delete c.readiness;delete c.readinessCatalogSha256;
   c.foundationGuard=active?structuredClone(expected.guard):null;
   if(active)c.tables.push(...structuredClone(expected.tables));
   c.tables.sort((a,b)=>a.name.localeCompare(b.name));
   if(wrote&&drift)c.tables.find(t=>t.name==='profiles').columns[0].default='changed';
   if(wrote&&guardDrift)c.foundationGuard.authenticatedExecute=true;
   return reply([{catalog:c}]);
  }
  const entries=structuredClone(base.report.customMigrationEntries);
  if(active&&!missingReceipt)entries.push({migration_name:RELEASE_NAME,source_sha256:SOURCE_SHA256,project_ref:TEST_PROJECT,applied_at:'2026-10-09T21:00:00Z'});
  return reply(entries);
 };
 return {calls,fetcher};
}
async function rehearsal(){
 const c=await readFoundationCatalog({allowProjectRef:TEST_PROJECT,token,fetcher:mock().fetcher});
 return {version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'rehearsed_and_rolled_back',acknowledged:true,catalogUnchanged:true,observedAfter:'2026-10-09T20:59:00Z',beforeCatalogSha256:foundationFingerprint(c),afterCatalogSha256:foundationFingerprint(c)};
}
test('fresh matching rehearsal installs once and verifies expected schema plus old sources',async()=>{
 const m=mock(),r=await applyFoundation({allowProjectRef:TEST_PROJECT,token,rehearsal:await rehearsal(),fetcher:m.fetcher,clock:()=>now});
 assert.equal(r.state,'installed_needs_user_verification');assert.equal(r.existingSourceCatalogPreserved,true);
 assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);
});
test('exact existing installation is read-only, with no repeat DDL',async()=>{
 const m=mock({installed:true}),r=await applyFoundation({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});
 assert.equal(r.state,'already_installed_needs_user_verification');assert.equal(r.writeAttempted,false);assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);
});
test('invalid rehearsal and foreign target or organization reject before writes',async()=>{
 for(const change of [{observedAfter:'2026-10-09T19:00:00Z'},{observedAfter:'2026-10-09T22:00:00Z'},{acknowledged:false},{afterCatalogSha256:'a'.repeat(64)},{sourceSha256:'b'.repeat(64)}]){
  const m=mock();await assert.rejects(()=>applyFoundation({allowProjectRef:TEST_PROJECT,token,rehearsal:{...rehearsalFixture,...change},fetcher:m.fetcher,clock:()=>now}));
  assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);
 }
 for(const [allow,opts] of [['production',{}],[TEST_PROJECT,{org:'foreign'}]]){
  const m=mock(opts);await assert.rejects(()=>applyFoundation({allowProjectRef:allow,token,fetcher:m.fetcher}));assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);
 }
});
const rehearsalFixture=await rehearsal();
test('failed, uncertain, drifted or unverifiable installations never pass or retry',async()=>{
 for(const options of [{fail:true},{unknown:true},{drift:true},{guardDrift:true},{missingReceipt:true},{unavailable:true}]){
  const m=mock(options),r=await applyFoundation({allowProjectRef:TEST_PROJECT,token,rehearsal:rehearsalFixture,fetcher:m.fetcher,clock:()=>now});
  assert.equal(r.state,'release_requires_inspection',JSON.stringify(options));assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);
 }
});
