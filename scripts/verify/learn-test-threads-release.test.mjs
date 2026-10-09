import test from 'node:test';import assert from 'node:assert/strict';
import {applyThreads,rehearseThreads,installedThreads,expectedThreads,threadsBefore,threadsFingerprint,SOURCE_SHA256,MARKER,REHEARSAL_MARKER} from './learn-test-threads-release.mjs';
import {readThreadsCatalog,THREADS_FUNCTIONS} from './learn-slack-threads-catalog.mjs';
import {THREADS_RELEASE_NAME as NAME,checkedThreads} from './learn-slack-threads-bundle.mjs';
import {TEST_PROJECT,TEST_ORGANIZATION} from './learn-test-readiness.mjs';
const original=threadsBefore(),expected=expectedThreads(),token='sbp_'+'a'.repeat(40),now=Date.parse('2026-10-10T00:00:00Z');
function mock(options={}){
 const calls=[];let wrote=false,rehearsing=false;
 return {calls,fetcher:async(url,o)=>{
  const q=o?.body?JSON.parse(o.body).query:null;calls.push({url,q});const reply=x=>Response.json(x);
  if(url.endsWith('/database/query')){wrote=true;rehearsing=q.includes('\nrollback;\n');if(options.unknown)throw Error(token);return reply(rehearsing?[{rehearsal:REHEARSAL_MARKER,receipt_absent:true}]:[{release:MARKER,source_sha256:SOURCE_SHA256}]);}
  const c=structuredClone(original),active=options.installed||wrote&&!rehearsing&&(!options.unknown||options.unknownCommitted);
  if(active){
   c.threadFunctions=structuredClone(expected.functions);c.workerFunctions=c.threadFunctions.filter(f=>original.workerFunctions.some(o=>o.name===f.name));c.tables.push(...structuredClone(expected.tables));c.base.inventory.tables.push({...structuredClone(expected.tables[0]),schema:'public'});
   c.slackFunctions=c.slackFunctions.filter(f=>f.name!=='slack_history_commit_page').concat(c.threadFunctions.filter(f=>f.name==='slack_history_commit_page')).sort((a,b)=>a.name.localeCompare(b.name));
   c.base.inventory.functions=c.base.inventory.functions.filter(f=>!THREADS_FUNCTIONS.includes(f.name)).concat(c.threadFunctions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}))).sort((a,b)=>a.name.localeCompare(b.name));
   if(!options.missingReceipt)c.readiness.customMigrationEntries.push({migration_name:NAME,source_sha256:SOURCE_SHA256,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'});
  }
  if(options.runtimeRefresh)c.base.functions=c.base.functions.map(f=>({...f,version:f.version+1}));
  if(options.runtimeDrift)c.base.functions[0].ezbr_sha256='changed';
  if(options.priorDrift){c.workerFunctions.find(f=>f.name==='platform_jobs_complete_email_v1').definition+=' drift';}if(options.priorDrift)c.threadFunctions.find(f=>f.name==='platform_jobs_complete_email_v1').definition+=' drift';
  if(options.privilegeDrift)c.workerPrerequisites.queue.find(r=>r.role==='authenticated').select=true;
  if(wrote&&options.afterDrift)c.tables.find(t=>t.name==='email_messages').owner='unexpected';
  if(active&&options.functionDrift)c.threadFunctions.find(f=>f.name==='learn_slack_finish_thread_job').definition+=' drift';
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:options.wrongOrg?'other':TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(c.base.functions);
  if(q.includes('as inventory'))return reply([{inventory:c.base.inventory}]);
  if(q.includes('as catalog'))return reply([{catalog:{tables:c.tables,helpers:c.helpers,foundationGuard:c.foundationGuard,observedAt:'2026-10-09T23:59:00Z'}}]);
  if(q.includes('as worker_prerequisites'))return reply([{worker_prerequisites:c.workerPrerequisites}]);
  if(q.includes('as registries'))return reply([{registries:c.actionRegistries}]);
  if(q.includes('as classes'))return reply([{classes:c.actionClasses}]);
  if(q.includes('as sequences'))return reply([{sequences:c.workSequences}]);
  if(q.includes('as functions'))return reply([{functions:q.includes("'learn_slack_store_records'")?c.threadFunctions:q.includes("'platform_jobs_complete_email_v1'")?c.workerFunctions:q.includes("'slack_history_commit_page'")?c.slackFunctions:q.includes("'learn_work_authority'")?c.actionFunctions:q.includes("'learn_capture_work_change'")?c.workFunctions:q.includes("'learn_performance_append'")?c.measurementFunctions:c.rulesFunctions}]);
  return reply(c.readiness.customMigrationEntries);
 }};
}
const args={allowProjectRef:TEST_PROJECT,token};
const rehearsal={version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'rehearsed_and_rolled_back',acknowledged:true,catalogUnchanged:true,observedAfter:'2026-10-09T23:59:00Z',beforeCatalogSha256:threadsFingerprint(original),afterCatalogSha256:threadsFingerprint(original)};
const install={...args,rehearsal,clock:()=>now};
test('threads rollback rehearsal uses the exact bundle and preserves all earlier definitions',async()=>{
 const m=mock(),r=await rehearseThreads({...args,fetcher:m.fetcher});assert.equal(r.state,'rehearsed_and_rolled_back');assert.equal(r.beforeCatalogSha256,r.afterCatalogSha256);
 const writes=m.calls.filter(c=>c.url.endsWith('/database/query'));assert.equal(writes.length,1);assert.match(writes[0].q,/\nrollback;\n/);assert.doesNotMatch(writes[0].q,/\ncommit;\n/);
});
test('threads installation is once-only and recognizes exact installed schema',async()=>{
 const m=mock(),r=await applyThreads({...install,fetcher:m.fetcher});assert.equal(r.state,'installed_needs_user_verification');assert.equal(r.existingSourceCatalogPreserved,true);assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);
 const already=mock({installed:true});assert.equal((await applyThreads({...install,fetcher:already.fetcher})).writeAttempted,false);assert.equal(already.calls.some(c=>c.url.endsWith('/database/query')),false);
});
test('wrong target/organization, changed prior queue function or privileges refuse writes',async()=>{
 for(const options of [{wrongOrg:true},{priorDrift:true},{privilegeDrift:true},{target:'production'}]){
  const m=mock(options);await assert.rejects(()=>applyThreads({...install,fetcher:m.fetcher,...(options.target?{allowProjectRef:options.target}:{})}));assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);
 }
});
test('stale/mismatched rehearsal cannot install',async()=>{
 for(const change of [{observedAfter:'2026-10-09T20:00:00Z'},{afterCatalogSha256:'wrong'},{sourceSha256:'wrong'},{catalogUnchanged:false}]){
  const m=mock();await assert.rejects(()=>applyThreads({...install,fetcher:m.fetcher,rehearsal:{...rehearsal,...change}}));assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);
 }
});
test('uncertain committed or uncommitted writes and post-write drift require inspection without replay',async()=>{
 for(const options of [{unknown:true},{unknown:true,unknownCommitted:true},{afterDrift:true},{functionDrift:true},{missingReceipt:true}]){
  const m=mock(options),r=await applyThreads({...install,fetcher:m.fetcher});assert.equal(r.state,'release_requires_inspection');assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);assert.equal(JSON.stringify(r).includes(token),false);
 }
 for(const options of [{unknown:true},{afterDrift:true}])assert.equal((await rehearseThreads({...args,fetcher:mock(options).fetcher})).state,'requires_inspection');
});
test('threads expectation covers retained private writer, browser denial and unchanged email completion',()=>{
 const b=checkedThreads();assert.equal(b.manifest.sha256,SOURCE_SHA256);assert.deepEqual(b.manifest.tables,['slack_thread_imports']);
 assert.doesNotMatch(b.sql,/vault\.(?:create_secret|update_secret)|cron\.schedule|delete from|^\s*truncate (?:table )?public\./im);
 const privateWriter=expected.functions.find(f=>f.name==='learn_slack_commit_page_private');assert.equal(privateWriter.serviceExecute,false);
 assert.ok(expected.functions.every(f=>!f.anonExecute&&f.authenticatedExecute===(f.name==='learn_slack_start_thread_import')));
 assert.deepEqual(expected.functions.find(f=>f.name==='platform_jobs_complete_email_v1'),original.workerFunctions.find(f=>f.name==='platform_jobs_complete_email_v1'));
});

test('thread catalog allows a separately verified worker runtime replacement but refuses other endpoint drift',async()=>{
 const c=await readThreadsCatalog({...args,fetcher:mock({installed:true}).fetcher});assert.equal(installedThreads(c),true);
 c.base.functions.find(f=>f.slug==='learn-slack-worker').version++;assert.equal(installedThreads(c),true);
 c.base.functions.find(f=>f.slug==='work-transition').ezbr_sha256='changed';assert.equal(installedThreads(c),false);
});
