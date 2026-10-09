import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedMeasurements} from './learn-measurements-bundle.mjs';
import {measurementRehearsalSql,rehearseMeasurements,MARKER,SOURCE_SHA256} from './learn-test-measurements-rehearsal.mjs';
import {TEST_PROJECT,TEST_ORGANIZATION} from './learn-test-readiness.mjs';
const original=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-rules-repaired-schema-2026-10-09.json',import.meta.url)));
const token='sbp_'+'a'.repeat(40);
function mock({foreign=false,existing=false,unknown=false,drift=false}={}){
 const calls=[];let wrote=false;
 return {calls,fetcher:async(url,o)=>{
  calls.push(url);const reply=data=>new Response(JSON.stringify(data));
  if(url.endsWith('/database/query')){wrote=true;if(unknown)throw Error(token);return reply([{rehearsal:MARKER,receipt_absent:true}]);}
  const c=structuredClone(original);
  if(wrote&&drift)c.tables[0].owner='unexpected';
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:foreign?'other':TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(c.base.functions);
  const q=JSON.parse(o.body).query;
  if(q.includes('as inventory'))return reply([{inventory:c.base.inventory}]);
  if(q.includes('as catalog'))return reply([{catalog:{tables:c.tables,helpers:c.helpers,foundationGuard:c.foundationGuard,observedAt:'2026-10-09T22:00:00Z'}}]);
  if(q.includes('as functions'))return reply([{functions:q.includes("'learn_performance_append'")?(existing?[{name:'learn_performance_append'}]:[]):c.rulesFunctions}]);
  return reply(c.readiness.customMigrationEntries);
 }};
}
test('bundle retains six source records and one explicit transaction; rehearsal rolls all objects back',()=>{
 const b=checkedMeasurements();assert.equal(b.manifest.sha256,SOURCE_SHA256);assert.equal(b.manifest.sources.length,6);assert.equal(b.manifest.tables.length,16);assert.equal(b.manifest.functions.length,9);
 const sql=measurementRehearsalSql();assert.equal(sql.split('\nbegin;\n').length,2);assert.equal(sql.includes('\ncommit;\n'),false);assert.equal(sql.split('\nrollback;\n').length,2);assert.match(sql,/learn_measurement_tenant_boundary/);assert.match(sql,/learn_measurements_no_truncate/);
});
test('reviewed rehearsal uses one request and requires unchanged catalog including function bodies',async()=>{const m=mock();const r=await rehearseMeasurements({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});assert.equal(r.state,'rehearsed_and_rolled_back');assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);});
test('wrong environment or preexisting objects fail before writes; unknown outcomes and drift never pass or retry',async()=>{
 for(const options of [{foreign:true},{existing:true}]){const m=mock(options);await assert.rejects(()=>rehearseMeasurements({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher}));assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);}
 const m=mock();await assert.rejects(()=>rehearseMeasurements({allowProjectRef:'production',token,fetcher:m.fetcher}));assert.equal(m.calls.length,0);
 for(const options of [{unknown:true},{drift:true}]){const m=mock(options);const r=await rehearseMeasurements({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});assert.equal(r.state,'requires_inspection');assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);}
});
