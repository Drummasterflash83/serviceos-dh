import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {conflictSql,conflictFingerprint,installedConflictRepair,preservedConflictSources,repairConflicts,SOURCE_SHA256,NAME,MARKER} from './learn-test-scorecard-conflicts.mjs';
import {TEST_PROJECT,TEST_ORGANIZATION} from './learn-test-readiness.mjs';
import {readRulesCatalog} from './learn-rules-catalog.mjs';
const original=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-rules-installed-schema-2026-10-09.json',import.meta.url)));
const token='sbp_'+'a'.repeat(40),now=Date.parse('2026-10-09T22:00:00Z');
function patched(){const c=structuredClone(original);c.rulesFunctions.forEach(f=>f.definition=f.definition.replaceAll("errcode='40001'","errcode='PT409'"));const e={migration_name:NAME,source_sha256:SOURCE_SHA256,project_ref:TEST_PROJECT,applied_at:'2026-10-09T21:00:00Z'};c.readiness.customMigrationEntries.push(e);c.base.report.customMigrationEntries.push(e);return c;}
function mock({active=false,unknown=false,failed=false,drift=false,foreign=false}={}){
 const calls=[];let wrote=false,rehearse=false;
 return {calls,fetcher:async(url,o)=>{
  calls.push(url);const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
  if(url.endsWith('/database/query')){wrote=true;rehearse=JSON.parse(o.body).query.includes('\nrollback;');if(unknown)throw Error(token);if(failed)return reply({message:'ERROR: 23514: test failure'},400);return reply([{marker:MARKER,...(rehearse?{receipt_absent:true}:{source_sha256:SOURCE_SHA256})}],201);}
  const c=(active||wrote&&!rehearse&&!unknown&&!failed)?patched():structuredClone(original);
  if(wrote&&drift)c.tables[0].owner='unexpected';
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:foreign?'other':TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(c.base.functions);
  const q=JSON.parse(o.body).query;
  if(q.includes('as inventory'))return reply([{inventory:c.base.inventory}]);
  if(q.includes('as catalog'))return reply([{catalog:{tables:c.tables,helpers:c.helpers,foundationGuard:c.foundationGuard,observedAt:'2026-10-09T21:59:00Z'}}]);
  if(q.includes('as functions'))return reply([{functions:c.rulesFunctions}]);
  return reply(c.readiness.customMigrationEntries);
 }};
}
const args={allowProjectRef:TEST_PROJECT,token};
const pre=await readRulesCatalog({...args,fetcher:mock().fetcher});
const rehearsal={version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'rehearsed_and_rolled_back',acknowledged:true,catalogUnchanged:true,observedAfter:'2026-10-09T21:59:00Z',beforeCatalogSha256:conflictFingerprint(pre),afterCatalogSha256:conflictFingerprint(pre)};
test('repair only permits two exact function code changes and its receipt',()=>{
 const c=patched();assert.equal(installedConflictRepair(c),true);assert.equal(preservedConflictSources(original,c),true);
 c.rulesFunctions.find(f=>f.name==='learn_scorecard_publish').definition+=' unauthorized';assert.equal(installedConflictRepair(c),false);
 const changed=patched();changed.tables[0].owner='other';assert.equal(preservedConflictSources(original,changed),false);
 assert.match(conflictSql({rehearse:true}),/rollback;/);assert.match(conflictSql(),/errcode='PT409'/);
});
test('rehearsal and install use one request and verify catalog; installed repair is read-only',async()=>{
 for(const rehearse of [true,false]){const m=mock();const r=await repairConflicts({...args,fetcher:m.fetcher,rehearse,rehearsal,clock:()=>now});assert.equal(r.state,rehearse?'rehearsed_and_rolled_back':'installed_needs_user_verification');assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);}
 const m=mock({active:true});assert.equal((await repairConflicts({...args,fetcher:m.fetcher})).writeAttempted,false);assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);
});
test('wrong target, stale or mismatched rehearsal cannot write',async()=>{
 for(const extra of [{allowProjectRef:'production'},{rehearsal:{...rehearsal,sourceSha256:'wrong'}},{rehearsal:{...rehearsal,observedAfter:'2026-10-09T20:00:00Z'}}]){const m=mock();await assert.rejects(()=>repairConflicts({...args,rehearsal,fetcher:m.fetcher,clock:()=>now,...extra}));assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);}
 const m=mock({foreign:true});await assert.rejects(()=>repairConflicts({...args,fetcher:m.fetcher,rehearse:true}));assert.equal(m.calls.some(u=>u.endsWith('/database/query')),false);
});
test('uncertain or rejected writes and unrelated drift are never retried or reported successful',async()=>{
 for(const options of [{unknown:true},{failed:true},{drift:true}]){const m=mock(options);const r=await repairConflicts({...args,fetcher:m.fetcher,rehearsal,clock:()=>now});assert.equal(r.state,'requires_inspection');assert.equal(m.calls.filter(u=>u.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);}
});
