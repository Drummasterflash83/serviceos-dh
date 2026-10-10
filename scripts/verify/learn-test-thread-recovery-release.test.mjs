import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessmentCatalog} from './learn-assessments-test-fixture.mjs';
import {mock} from './learn-communications-test-fixture.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {threadRecoveryPrerequisites,installedThreadRecovery,expectedThreadRecovery,threadRecoveryReleaseSql,releaseThreadRecovery,THREAD_RECOVERY_RELEASE,THREAD_RECOVERY_SHA} from './learn-test-thread-recovery-release.mjs';
function catalog(installed=false){
 const c=assessmentCatalog(true);c.threadRecoveryFunctions=[];
 if(installed){const e=expectedThreadRecovery();c.threadRecoveryFunctions=e.functions;c.tables.find(t=>t.name==='slack_thread_imports').indexes.push(...e.indexes);c.tables.find(t=>t.name==='slack_thread_imports').indexes.sort((a,b)=>a.name.localeCompare(b.name));
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));c.base.inventory.functions.sort((a,b)=>a.name.localeCompare(b.name));
 const r={migration_name:THREAD_RECOVERY_RELEASE,source_sha256:THREAD_RECOVERY_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)},options={beforeCatalog:()=>catalog(),installedCatalog:()=>catalog(true),marker:'learn-test-thread-recovery/1'};
test('only the exact three functions and two indexes may augment release 020',()=>{
 assert.equal(threadRecoveryPrerequisites(catalog()),true);assert.equal(installedThreadRecovery(catalog()),false);assert.equal(installedThreadRecovery(catalog(true)),true);
 for(const mutate of [c=>c.threadRecoveryFunctions[0].definition+=' drift',c=>c.threadRecoveryFunctions[2].authenticatedExecute=true,c=>c.threadRecoveryFunctions[0].serviceExecute=true,c=>c.tables.find(t=>t.name==='slack_thread_imports').indexes.find(i=>i.name==='learn_slack_thread_one_recovery').definition+=' drift',c=>c.tables.find(t=>t.name==='slack_thread_imports').policies.pop(),c=>c.assessmentFunctions[0].definition+=' drift',c=>c.sourceReader.functions[0].definition+=' drift',c=>c.base.inventory.functions.find(f=>f.name==='learn_slack_resume_thread').anonExecute=true,c=>c.readiness.customMigrationEntries.pop()]){const c=catalog(true);mutate(c);assert.equal(installedThreadRecovery(c),false);}
 assert.match(threadRecoveryReleaseSql(true),/\nrollback;\n/);assert.doesNotMatch(threadRecoveryReleaseSql(true),/\ncommit;\n/);
 const migration=readFileSync(new URL('../../supabase/migrations/20261031050000_learn_slack_thread_resume.sql',import.meta.url),'utf8').split('\nbegin;\n')[1].split('\ncommit;\n')[0];
 assert.ok(threadRecoveryReleaseSql(false).includes(migration),'release must retain the tested migration body');
});
test('rehearsal, once-only install, uncertain outcomes and stale/wrong targets',async()=>{
 const m=mock({...options,rehearse:true}),rehearsal=await releaseThreadRecovery({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');assert.equal(m.writes,1);
 for(const mode of [{},{unknown:true},{unknown:true,commitUnknown:true}]){const n=mock({...options,...mode}),r=await releaseThreadRecovery({...args,rehearse:false,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,mode.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{afterFingerprint:'different'},{observedAt:'2020-01-01'},{acknowledged:false},{sourceSha256:'changed'},{projectRef:'production'}]){const n=mock(options);await assert.rejects(()=>releaseThreadRecovery({...args,rehearse:false,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const n=mock(options);await assert.rejects(()=>releaseThreadRecovery({...args,allowProjectRef:'production',rehearse:true,fetcher:n.fetcher}));assert.equal(n.writes,0);
 const already=mock({...options,beforeCatalog:()=>catalog(true)});assert.equal((await releaseThreadRecovery({...args,rehearse:false,fetcher:already.fetcher})).state,'already_installed');assert.equal(already.writes,0);
 const drift=mock({...options,beforeCatalog:()=>{const c=catalog();c.tables.find(t=>t.name==='slack_thread_imports').indexes.pop();return c;}});await assert.rejects(()=>releaseThreadRecovery({...args,rehearse:true,fetcher:drift.fetcher}));assert.equal(drift.writes,0);
});
