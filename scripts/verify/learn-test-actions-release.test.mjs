import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyActions,expectedActions,MARKER} from './learn-test-actions-release.mjs';
import {readActionsCatalog} from './learn-actions-catalog.mjs';
import {actionsFingerprint,SOURCE_SHA256,MARKER as REHEARSAL_MARKER} from './learn-test-actions-rehearsal.mjs';
import {ACTIONS_RELEASE_NAME as NAME} from './learn-actions-bundle.mjs';
import {TEST_PROJECT,TEST_ORGANIZATION} from './learn-test-readiness.mjs';
const original=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-work-installed-schema-2026-10-09.json',import.meta.url)));
const registry=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-action-registries-before-2026-10-09.json',import.meta.url))).registries;
const e=expectedActions(),token='sbp_'+'a'.repeat(40),now=Date.parse('2026-10-09T22:00:00Z');
function mock({installed=false,unknown=false,registryDrift=false,missingGuard=false,bodyDrift=false,priorDrift=false}={}){
 const calls=[];let wrote=false;
 return {calls,fetcher:async(url,o)=>{
  calls.push(url);const reply=v=>new Response(JSON.stringify(v));
  if(url.endsWith('/database/query')){wrote=true;if(unknown)throw Error(token);return reply([{release:MARKER,source_sha256:SOURCE_SHA256}]);}
  const active=installed||wrote&&!unknown,c=structuredClone(original),registries=structuredClone(active?e.registries:registry);
  if(active){
   c.tables=[...c.tables.filter(t=>!e.tables.some(v=>v.name===t.name)),...structuredClone(e.tables)].sort((a,b)=>a.name.localeCompare(b.name));
   const adapted=t=>({schema:'public',name:t.name,rls:t.rls,forceRls:t.forceRls,authenticatedSelect:t.authenticatedSelect,anonSelect:t.anonAccess,policies:t.policies,columns:t.columns.map(col=>({...col,authenticatedSelect:t.authenticatedSelect}))});
   c.base.inventory.tables=c.base.inventory.tables.filter(t=>t.schema!=='public'||!e.tables.some(v=>v.name===t.name));c.base.inventory.tables.push(...e.tables.map(adapted));
   c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
   c.readiness.customMigrationEntries.push({migration_name:NAME,source_sha256:SOURCE_SHA256,project_ref:TEST_PROJECT,applied_at:'2026-10-09T22:00:00Z'});
   if(missingGuard)c.tables.find(t=>t.name==='profiles').triggers=[];
   if(registryDrift)registries.transitions[0].guard={approval:true};
   if(priorDrift)c.workFunctions[0].definition+=' unexpected';
  }
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(c.base.functions);
  const q=JSON.parse(o.body).query;
  if(q.includes('as inventory'))return reply([{inventory:c.base.inventory}]);
  if(q.includes('as catalog'))return reply([{catalog:{tables:c.tables,helpers:c.helpers,foundationGuard:c.foundationGuard,observedAt:'2026-10-09T21:59:00Z'}}]);
  if(q.includes('as sequences'))return reply([{sequences:c.workSequences}]);
  if(q.includes('as classes'))return reply([{classes:e.classes}]);
  if(q.includes('as registries'))return reply([{registries}]);
  if(q.includes('as functions')){const functions=q.includes("'learn_work_authority'")?(active?structuredClone(e.functions):[]):q.includes("'learn_capture_work_change'")?c.workFunctions:q.includes("'learn_performance_append'")?c.measurementFunctions:c.rulesFunctions;if(active&&bodyDrift&&q.includes("'learn_work_authority'"))functions[0].definition+=' drift';return reply([{functions}]);}
  return reply(c.readiness.customMigrationEntries);
 }};
}
const pre=await readActionsCatalog({allowProjectRef:TEST_PROJECT,token,fetcher:mock().fetcher});
const rehearsal={version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'rehearsed_and_rolled_back',acknowledged:true,catalogUnchanged:true,observedAfter:'2026-10-09T21:59:00Z',beforeCatalogSha256:actionsFingerprint(pre),afterCatalogSha256:actionsFingerprint(pre)};
const args={allowProjectRef:TEST_PROJECT,token,rehearsal,clock:()=>now};
test('action release requires exact prior schema, adds only reviewed guards and vocabulary, and writes once',async()=>{const m=mock(),r=await applyActions({...args,fetcher:m.fetcher});assert.equal(r.state,'installed_needs_user_verification');assert.equal(r.existingSourceCatalogPreserved,true);assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);});
test('an installed action release is read-only',async()=>{const m=mock({installed:true}),r=await applyActions({...args,fetcher:m.fetcher});assert.equal(r.writeAttempted,false);assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);});
test('wrong target or stale/different rehearsal cannot write',async()=>{for(const extra of [{allowProjectRef:'production'},{rehearsal:{...rehearsal,observedAfter:'2026-10-09T20:00:00Z'}},{rehearsal:{...rehearsal,afterCatalogSha256:'wrong'}}]){const m=mock();await assert.rejects(()=>applyActions({...args,fetcher:m.fetcher,...extra}));assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);}});
test('unknown writes, missing input guards, changed registries and existing collector drift require inspection without replay',async()=>{for(const options of [{unknown:true},{missingGuard:true},{registryDrift:true},{bodyDrift:true},{priorDrift:true}]){const m=mock(options),r=await applyActions({...args,fetcher:m.fetcher});assert.equal(r.state,'release_requires_inspection');assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);}});
