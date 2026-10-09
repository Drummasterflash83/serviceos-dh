import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyRules,expectedRules,MARKER } from './learn-test-rules-release.mjs';
import { readRulesCatalog } from './learn-rules-catalog.mjs';
import { rulesFingerprint,SOURCE_SHA256,MARKER as REHEARSAL_MARKER } from './learn-test-rules-rehearsal.mjs';
import { checkedRules,RULES_RELEASE_NAME } from './learn-rules-bundle.mjs';
import { TEST_PROJECT,TEST_ORGANIZATION } from './learn-test-readiness.mjs';
const load=n=>JSON.parse(readFileSync(new URL('../../docs/operations/evidence/'+n,import.meta.url)));
const old=load('learn-test-launch-installed-catalog-2026-10-09.json'),foundation=load('learn-test-foundation-installed-schema-2026-10-09.json');
const e=expectedRules(),token='sbp_'+'a'.repeat(40),now=Date.parse('2026-10-09T22:00:00Z');
function mock({installed=false,fail=false,unknown=false,drift=false,bodyDrift=false,missingReceipt=false,unavailable=false,foreign=false}={}){
 const calls=[];let wrote=false;
 const fetcher=async(url,o)=>{
  calls.push({url,o});const reply=(v,status=200)=>new Response(JSON.stringify(v),{status});
  if(url.endsWith('/database/query')){wrote=true;if(unknown)throw Error(token);return fail?reply({code:'23514',message:token},400):reply([{release:MARKER,source_sha256:SOURCE_SHA256}],201);}
  if(wrote&&unavailable)return reply({},503);
  const active=installed||(wrote&&!fail&&!unknown);
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:foreign?'other':TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(old.functions);
  const q=JSON.parse(o.body).query;
  if(q.includes('as inventory')){
   const i=structuredClone(old.inventory);
   const tables=foundation.tables.map(t=>active?(e.tables.find(n=>n.name===t.name)??t):t);
   if(active)tables.push(...e.tables.filter(t=>!foundation.tables.some(n=>n.name===t.name)));
   i.tables=[...i.tables.filter(t=>t.schema!=='public'),...tables.map(t=>({schema:'public',name:t.name,rls:t.rls,forceRls:t.forceRls,authenticatedSelect:t.authenticatedSelect,anonSelect:t.anonAccess,policies:t.policies,columns:t.columns.map(c=>({...c,authenticatedSelect:t.authenticatedSelect}))}))].sort((a,b)=>(a.schema+'.'+a.name).localeCompare(b.schema+'.'+b.name));
   i.functions.push({name:'learn_foundation_reference_guard',arguments:'',securityDefiner:true,authenticatedExecute:false,anonExecute:false});
   for(const f of i.functions)if(['current_tenant_id','is_openfolk',...(active?['current_user_role']:[])].includes(f.name))f.authenticatedExecute=true;
   if(active)i.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
   return reply([{inventory:i}]);
  }
  if(q.includes('as catalog')){
   const c=structuredClone(foundation);delete c.readiness;delete c.readinessCatalogSha256;
   if(active)c.tables=[...c.tables.filter(t=>!e.tables.some(n=>n.name===t.name)),...structuredClone(e.tables)].sort((a,b)=>a.name.localeCompare(b.name));
   if(wrote&&drift)c.tables.find(t=>t.name==='team_members').columns[0].default='unexpected';
   return reply([{catalog:c}]);
  }
  if(q.includes('as functions')){
   const f=active?structuredClone(e.functions):[];if(wrote&&bodyDrift)f[0].definition+=' changed';return reply([{functions:f}]);
  }
  const ledger=structuredClone(foundation.readiness.customMigrationEntries);
  if(active&&!missingReceipt)ledger.push({migration_name:RULES_RELEASE_NAME,source_sha256:SOURCE_SHA256,project_ref:TEST_PROJECT,applied_at:'2026-10-09T22:00:00Z'});
  return reply(ledger);
 };
 return {calls,fetcher};
}
const pre=await readRulesCatalog({allowProjectRef:TEST_PROJECT,token,fetcher:mock().fetcher});
const rehearsal={version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'rehearsed_and_rolled_back',acknowledged:true,catalogUnchanged:true,observedAfter:'2026-10-09T21:59:00Z',beforeCatalogSha256:rulesFingerprint(pre),afterCatalogSha256:rulesFingerprint(pre)};
test('checked rules install once with exact functions and narrowly permitted existing-table changes',async()=>{
 const m=mock(),r=await applyRules({allowProjectRef:TEST_PROJECT,token,rehearsal,fetcher:m.fetcher,clock:()=>now});
 assert.equal(r.state,'installed_needs_user_verification');assert.equal(r.existingSourceCatalogPreserved,true);
 assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);
});
test('exact installed rules use read-only recheck',async()=>{
 const m=mock({installed:true}),r=await applyRules({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});
 assert.equal(r.writeAttempted,false);assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);
});
test('foreign targets and invalid rehearsals cannot write',async()=>{
 for(const change of [{observedAfter:'2026-10-09T20:00:00Z'},{observedAfter:'2026-10-09T23:00:00Z'},{acknowledged:false},{afterCatalogSha256:'f'.repeat(64)}]){
  const m=mock();await assert.rejects(()=>applyRules({allowProjectRef:TEST_PROJECT,token,rehearsal:{...rehearsal,...change},fetcher:m.fetcher,clock:()=>now}));assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);
 }
 for(const [target,options] of [['production',{}],[TEST_PROJECT,{foreign:true}]]){const m=mock(options);await assert.rejects(()=>applyRules({allowProjectRef:target,token,fetcher:m.fetcher}));assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);}
});
test('unknown outcomes, wrong function bodies, source drift and missing receipts never pass or retry',async()=>{
 for(const options of [{fail:true},{unknown:true},{bodyDrift:true},{drift:true},{missingReceipt:true},{unavailable:true}]){
  const m=mock(options),r=await applyRules({allowProjectRef:TEST_PROJECT,token,rehearsal,fetcher:m.fetcher,clock:()=>now});
  assert.equal(r.state,'release_requires_inspection',JSON.stringify(options));assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);
 }
});
