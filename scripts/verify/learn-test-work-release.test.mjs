import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyWork,expectedWork,MARKER} from './learn-test-work-release.mjs';
import {readWorkCatalog} from './learn-work-catalog.mjs';
import {workFingerprint,SOURCE_SHA256,MARKER as REHEARSAL_MARKER} from './learn-test-work-rehearsal.mjs';
import {WORK_RELEASE_NAME as NAME} from './learn-work-bundle.mjs';
import {TEST_PROJECT,TEST_ORGANIZATION} from './learn-test-readiness.mjs';
const original=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-measurements-installed-schema-2026-10-09.json',import.meta.url)));
const e=expectedWork(),token='sbp_'+'a'.repeat(40),now=Date.parse('2026-10-09T22:00:00Z');
function mock({installed=false,unknown=false,drift=false,bodyDrift=false,missingWriter=false,sequenceDrift=false}={}){
 const calls=[];let wrote=false;
 return {calls,fetcher:async(url,o)=>{
  calls.push(url);const reply=v=>new Response(JSON.stringify(v));
  if(url.endsWith('/database/query')){wrote=true;if(unknown)throw Error(token);return reply([{release:MARKER,source_sha256:SOURCE_SHA256}]);}
  const active=installed||wrote&&!unknown,c=structuredClone(original);
  if(active){
   c.tables=[...c.tables.filter(t=>!e.tables.some(v=>v.name===t.name)),...structuredClone(e.tables)].sort((a,b)=>a.name.localeCompare(b.name));
   const adapted=t=>({schema:'public',name:t.name,rls:t.rls,forceRls:t.forceRls,authenticatedSelect:t.authenticatedSelect,anonSelect:t.anonAccess,policies:t.policies,columns:t.columns.map(col=>({...col,authenticatedSelect:t.authenticatedSelect}))});
   c.base.inventory.tables=c.base.inventory.tables.filter(t=>t.schema!=='public'||!e.tables.some(v=>v.name===t.name));c.base.inventory.tables.push(...e.tables.map(adapted));
   c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
   if(!missingWriter)c.measurementFunctions.find(f=>f.name==='learn_performance_append').definition=c.measurementFunctions.find(f=>f.name==='learn_performance_append').definition.replace("'jobs','team_members')","'jobs','team_members','learn_work_measurement_runs')");
   c.readiness.customMigrationEntries.push({migration_name:NAME,source_sha256:SOURCE_SHA256,project_ref:TEST_PROJECT,applied_at:'2026-10-09T22:00:00Z'});
  }
  if(wrote&&drift)c.tables.find(t=>t.name==='object_state_history').columns[0].default='unexpected';
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(c.base.functions);
  const q=JSON.parse(o.body).query;
  if(q.includes('as inventory'))return reply([{inventory:c.base.inventory}]);
  if(q.includes('as catalog'))return reply([{catalog:{tables:c.tables,helpers:c.helpers,foundationGuard:c.foundationGuard,observedAt:'2026-10-09T21:59:00Z'}}]);
  if(q.includes('as sequences')){const sequences=active?structuredClone(e.sequences):[];if(active&&sequenceDrift)sequences[0].serviceAccess=true;return reply([{sequences}]);}
  if(q.includes('as functions')){let functions=q.includes("'learn_capture_work_change'")?(active?structuredClone(e.functions):[]):q.includes("'learn_performance_append'")?c.measurementFunctions:c.rulesFunctions;if(active&&bodyDrift&&q.includes("'learn_capture_work_change'"))functions[0].definition+=' drift';return reply([{functions}]);}
  return reply(c.readiness.customMigrationEntries);
 }};
}
const pre=await readWorkCatalog({allowProjectRef:TEST_PROJECT,token,fetcher:mock().fetcher});
const rehearsal={version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'rehearsed_and_rolled_back',acknowledged:true,catalogUnchanged:true,observedAfter:'2026-10-09T21:59:00Z',beforeCatalogSha256:workFingerprint(pre),afterCatalogSha256:workFingerprint(pre)};
const args={allowProjectRef:TEST_PROJECT,token,rehearsal,clock:()=>now};
test('work installs once, permitting only declared history/capture changes and one writer allowlist addition',async()=>{const m=mock(),r=await applyWork({...args,fetcher:m.fetcher});assert.equal(r.state,'installed_needs_user_verification');assert.equal(r.existingSourceCatalogPreserved,true);assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);});
test('installed work is read-only; a missing append extension is not accepted',async()=>{const m=mock({installed:true}),r=await applyWork({...args,fetcher:m.fetcher});assert.equal(r.writeAttempted,false);const bad=mock({installed:true,missingWriter:true});await assert.rejects(()=>applyWork({...args,fetcher:bad.fetcher}));assert.equal(bad.calls.some(u=>u.endsWith('/database/query')),false);});
test('wrong target and stale/mismatched rehearsal cannot write',async()=>{for(const extra of [{allowProjectRef:'production'},{rehearsal:{...rehearsal,observedAfter:'2026-10-09T20:00:00Z'}},{rehearsal:{...rehearsal,afterCatalogSha256:'wrong'}}]){const m=mock();await assert.rejects(()=>applyWork({...args,fetcher:m.fetcher,...extra}));assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);}});
test('unknown write, changed history/function/sequence and missing writer extension never pass or retry',async()=>{for(const options of [{unknown:true},{drift:true},{bodyDrift:true},{sequenceDrift:true},{missingWriter:true}]){const m=mock(options),r=await applyWork({...args,fetcher:m.fetcher});assert.equal(r.state,'release_requires_inspection');assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);}});
