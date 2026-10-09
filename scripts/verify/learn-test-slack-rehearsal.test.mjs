import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rehearseSlack,MARKER,SOURCE_SHA256} from './learn-test-slack-rehearsal.mjs';
import {checkedSlack} from './learn-slack-bundle.mjs';
import {TEST_PROJECT,TEST_ORGANIZATION} from './learn-test-readiness.mjs';
const original=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-actions-installed-schema-2026-10-09.json',import.meta.url)));
const registry=original.actionRegistries;
const token='sbp_'+'a'.repeat(40);
function mock({registryDrift=false,sourceDrift=false,afterDrift=false,unknown=false,wrongOrg=false,existingFunction=false}={}){
 const calls=[];let wrote=false;
 return {calls,fetcher:async(url,o)=>{
  calls.push({url,query:o?.body?JSON.parse(o.body).query:null});const reply=v=>new Response(JSON.stringify(v));
  if(url.endsWith('/database/query')){wrote=true;if(unknown)throw Error(token);return reply([{rehearsal:MARKER,receipt_absent:true}]);}
  const c=structuredClone(original),registries=structuredClone(registry);
  if(sourceDrift)c.tables.find(t=>t.name==='domain_object_types').columns[0].default='changed';
  if(registryDrift||wrote&&afterDrift)registries.transitions.push({domain:'serviceos',object_type:'Action',from_state:'ready',to_state:'in_progress',guard:{approval:true}});
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:wrongOrg?'other':TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(c.base.functions);
  const q=JSON.parse(o.body).query;
  if(q.includes('as inventory'))return reply([{inventory:c.base.inventory}]);
  if(q.includes('as catalog'))return reply([{catalog:{tables:c.tables,helpers:c.helpers,foundationGuard:c.foundationGuard,observedAt:'2026-10-09T22:00:00Z'}}]);
  if(q.includes('as sequences'))return reply([{sequences:c.workSequences}]);
  if(q.includes('as registries'))return reply([{registries}]);
  if(q.includes('as classes'))return reply([{classes:c.actionClasses}]);
  if(q.includes('as functions'))return reply([{functions:q.includes("'slack_history_commit_page'")?(existingFunction?[{name:'slack_history_commit_page'}]:[]):q.includes("'learn_work_authority'")?c.actionFunctions:q.includes("'learn_capture_work_change'")?c.workFunctions:q.includes("'learn_performance_append'")?c.measurementFunctions:c.rulesFunctions}]);
  return reply(c.readiness.customMigrationEntries);
 }};
}
const args={allowProjectRef:TEST_PROJECT,token};
test('exact Slack bundle rehearses and leaves prior definitions and public vocabularies unchanged',async()=>{
 const m=mock(),r=await rehearseSlack({...args,fetcher:m.fetcher});assert.equal(r.state,'rehearsed_and_rolled_back');
 const writes=m.calls.filter(c=>c.url.endsWith('/database/query'));assert.equal(writes.length,1);
 assert.match(writes[0].query,/rollback;/);assert.doesNotMatch(writes[0].query,/\ncommit;\n/);
 assert.equal(r.beforeCatalogSha256,r.afterCatalogSha256);assert.equal(r.sourceSha256,SOURCE_SHA256);
});
test('wrong target or organization cannot reach rehearsal writes',async()=>{
 for(const options of [{wrongOrg:true},{}]){const m=mock(options);await assert.rejects(()=>rehearseSlack({...args,fetcher:m.fetcher,...(!options.wrongOrg?{allowProjectRef:'production'}:{})}));assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);}
});
test('changed sources, configured edges or existing functions are not overwritten',async()=>{
 for(const options of [{registryDrift:true},{sourceDrift:true},{existingFunction:true}]){const m=mock(options);await assert.rejects(()=>rehearseSlack({...args,fetcher:m.fetcher}));assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);}
});
test('unknown rehearsal and changed post-state require inspection without replay or credential output',async()=>{
 for(const options of [{unknown:true},{afterDrift:true}]){const m=mock(options),r=await rehearseSlack({...args,fetcher:m.fetcher});assert.equal(r.state,'requires_inspection');assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);}
});
test('reviewed bundle omits original tenant activation, automation and historical baseline',()=>{
 const b=checkedSlack();assert.equal(b.manifest.sha256,SOURCE_SHA256);
 assert.doesNotMatch(b.sql,/insert into tenant_domain_packs|create table if not exists automation_|insert into config_versions|update intelligence_objects set object_class/i);
 assert.equal(b.manifest.tables.length,7);assert.equal(b.manifest.functions.length,3);
 assert.doesNotMatch(b.sql,/v_tenant uuid :=|Simwood 3950|vault\.create_secret|create or replace function public\.provider_secret_read/);
});
