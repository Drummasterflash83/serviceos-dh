import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rehearseRules,rulesRehearsalSql,MARKER,SOURCE_SHA256 } from './learn-test-rules-rehearsal.mjs';
import { checkedRules } from './learn-rules-bundle.mjs';
import { TEST_PROJECT,TEST_ORGANIZATION } from './learn-test-readiness.mjs';
const load=n=>JSON.parse(readFileSync(new URL('../../docs/operations/evidence/'+n,import.meta.url)));
const snapshot=load('learn-test-launch-installed-catalog-2026-10-09.json'),foundation=load('learn-test-foundation-installed-schema-2026-10-09.json');
const token='sbp_'+'a'.repeat(40);
function mock({drift=false,failed=false,unknown=false,installed=false,foreign=false}={}){
 let wrote=false;const calls=[];
 const fetcher=async(url,o)=>{
  calls.push({url,o});const reply=(v,status=200)=>new Response(JSON.stringify(v),{status});
  if(url.endsWith('/database/query')){wrote=true;if(unknown)throw Error(token);return failed?reply({code:'42501',message:token},400):reply([{rehearsal:MARKER,tables_absent:true,guard_absent:true,receipt_absent:true}],201);}
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:foreign?'foreign':TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(snapshot.functions);
  const q=JSON.parse(o.body).query;
  if(q.includes('as inventory')){
   const i=structuredClone(snapshot.inventory);
   i.tables=[...i.tables.filter(t=>t.schema!=='public'),...foundation.tables.map(t=>({...t,schema:'public',columns:t.columns.map(c=>({...c,authenticatedSelect:t.authenticatedSelect}))}))];
   i.functions.push({name:'learn_foundation_reference_guard',arguments:'',securityDefiner:true,authenticatedExecute:false,anonExecute:false});
   for(const f of i.functions)if(['current_tenant_id','is_openfolk'].includes(f.name))f.authenticatedExecute=true;
   if(installed)i.functions.push({name:'learn_scorecard_save_draft',authenticatedExecute:true});
   return reply([{inventory:i}]);
  }
  if(q.includes('as catalog')){
   const c=structuredClone(foundation);delete c.readiness;delete c.readinessCatalogSha256;
   if(wrote&&drift)c.tables.find(t=>t.name==='team_members').triggers.push({name:'unexpected'});
   return reply([{catalog:c}]);
  }
  return reply(foundation.readiness.customMigrationEntries);
 };
 return {calls,fetcher};
}
test('rules bundle preserves five sources and transforms exactly one transaction into rollback',()=>{
 const b=checkedRules();assert.equal(b.manifest.sha256,SOURCE_SHA256);assert.equal(b.manifest.sources.length,5);assert.equal(b.manifest.functions.length,10);
 const sql=rulesRehearsalSql();assert.equal((sql.match(/^commit;$/gm)??[]).length,0);assert.equal((sql.match(/^rollback;$/gm)??[]).length,1);
 assert.match(sql,/learn_scorecard_read_draft/);assert.match(sql,/statement_timeout='30s'/);
});
test('rehearsal runs once on the verified foundation and compares all source state',async()=>{
 const m=mock();const r=await rehearseRules({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});
 assert.equal(r.state,'rehearsed_and_rolled_back');assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);
});
test('foreign or already-created objects cannot start; failures and drift never pass or retry',async()=>{
 for(const opts of [{foreign:true},{installed:true}]){const m=mock(opts);await assert.rejects(()=>rehearseRules({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher}));assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);}
 for(const opts of [{failed:true},{unknown:true},{drift:true}]){const m=mock(opts);const r=await rehearseRules({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});assert.equal(r.state,'rehearsal_not_verified');assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);}
});
