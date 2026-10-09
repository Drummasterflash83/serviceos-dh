import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySlack,expectedSlack,MARKER} from './learn-test-slack-release.mjs';
import {readSlackCatalog} from './learn-slack-catalog.mjs';
import {slackFingerprint,SOURCE_SHA256,MARKER as REHEARSAL_MARKER} from './learn-test-slack-rehearsal.mjs';
import {SLACK_RELEASE_NAME as NAME} from './learn-slack-bundle.mjs';
import {TEST_PROJECT,TEST_ORGANIZATION} from './learn-test-readiness.mjs';
const original=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-actions-installed-schema-2026-10-09.json',import.meta.url)));
const e=expectedSlack(),token='sbp_'+'a'.repeat(40),now=Date.parse('2026-10-09T22:00:00Z');
function mock({installed=false,unknown=false,drift=false,bodyDrift=false,priorDrift=false,missingReceipt=false}={}){
 const calls=[];let wrote=false;
 return {calls,fetcher:async(url,o)=>{
  calls.push(url);const reply=v=>new Response(JSON.stringify(v));
  if(url.endsWith('/database/query')){wrote=true;if(unknown)throw Error(token);return reply([{release:MARKER,source_sha256:SOURCE_SHA256}]);}
  const active=installed||wrote&&!unknown,c=structuredClone(original);
  if(active){c.tables=[...c.tables,...structuredClone(e.tables)].sort((a,b)=>a.name.localeCompare(b.name));c.base.inventory.tables.push(...e.tables.map(t=>({schema:'public',name:t.name,rls:t.rls,forceRls:t.forceRls,authenticatedSelect:t.authenticatedSelect,anonSelect:t.anonAccess,policies:t.policies,columns:t.columns.map(col=>({...col,authenticatedSelect:t.authenticatedSelect}))})));c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));if(!missingReceipt)c.readiness.customMigrationEntries.push({migration_name:NAME,source_sha256:SOURCE_SHA256,project_ref:TEST_PROJECT,applied_at:'2026-10-09T22:00:00Z'});}
  if(wrote&&drift)c.tables.find(t=>t.name==='email_messages').owner='unexpected';
  if(active&&priorDrift)c.rulesFunctions[0].definition+=' drift';
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(c.base.functions);
  const q=JSON.parse(o.body).query;
  if(q.includes('as inventory'))return reply([{inventory:c.base.inventory}]);
  if(q.includes('as catalog'))return reply([{catalog:{tables:c.tables,helpers:c.helpers,foundationGuard:c.foundationGuard,observedAt:'2026-10-09T21:59:00Z'}}]);
  if(q.includes('as registries'))return reply([{registries:c.actionRegistries}]);
  if(q.includes('as classes'))return reply([{classes:c.actionClasses}]);
  if(q.includes('as sequences'))return reply([{sequences:c.workSequences}]);
  if(q.includes('as functions')){let functions=q.includes("'slack_history_commit_page'")?(active?structuredClone(e.functions):[]):q.includes("'learn_work_authority'")?c.actionFunctions:q.includes("'learn_capture_work_change'")?c.workFunctions:q.includes("'learn_performance_append'")?c.measurementFunctions:c.rulesFunctions;if(active&&bodyDrift&&q.includes("'slack_history_commit_page'"))functions[0].definition+=' drift';return reply([{functions}]);}
  return reply(c.readiness.customMigrationEntries);
 }};
}
const pre=await readSlackCatalog({allowProjectRef:TEST_PROJECT,token,fetcher:mock().fetcher});
const rehearsal={version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'rehearsed_and_rolled_back',acknowledged:true,catalogUnchanged:true,observedAfter:'2026-10-09T21:59:00Z',beforeCatalogSha256:slackFingerprint(pre),afterCatalogSha256:slackFingerprint(pre)};
const args={allowProjectRef:TEST_PROJECT,token,rehearsal,clock:()=>now};
test('slack release installs once and preserves original schema/functions',async()=>{const m=mock(),r=await applySlack({...args,fetcher:m.fetcher});assert.equal(r.state,'installed_needs_user_verification');assert.equal(r.existingSourceCatalogPreserved,true);assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);});
test('installed release is read-only; changed predecessor refuses installation',async()=>{const m=mock({installed:true}),r=await applySlack({...args,fetcher:m.fetcher});assert.equal(r.writeAttempted,false);assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);const bad=mock({installed:true,priorDrift:true});await assert.rejects(()=>applySlack({...args,fetcher:bad.fetcher}));assert.equal(bad.calls.some(u=>u.endsWith('/database/query')),false);});
test('foreign target and stale rehearsal cannot write',async()=>{for(const override of [{allowProjectRef:'production'},{rehearsal:{...rehearsal,observedAfter:'2026-10-09T20:00:00Z'}},{rehearsal:{...rehearsal,afterCatalogSha256:'wrong'}}]){const m=mock();await assert.rejects(()=>applySlack({...args,fetcher:m.fetcher,...override}));assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);}});
test('unknown write, changed source, changed function or missing receipt never passes or retries',async()=>{for(const options of [{unknown:true},{drift:true},{bodyDrift:true},{priorDrift:true},{missingReceipt:true}]){const m=mock(options),r=await applySlack({...args,fetcher:m.fetcher});assert.equal(r.state,'release_requires_inspection');assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);}});
