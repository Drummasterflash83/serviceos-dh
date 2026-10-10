import test from 'node:test';import assert from 'node:assert/strict';
import {baseline,mock} from './learn-communications-test-fixture.mjs';
import {expectedCommunicationContext,CONTEXT_RELEASE,CONTEXT_SHA} from './learn-test-communication-context.mjs';
import {installedCorrections,correctionPrerequisites,expectedCorrections,CORRECTION_RELEASE,CORRECTION_SHA,releaseCorrections,correctionReleaseSql} from './learn-test-corrections-release.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {correctionCatalog as catalog} from './learn-corrections-test-fixture.mjs';
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)},options={beforeCatalog:()=>catalog(),installedCatalog:()=>catalog(true),marker:'learn-test-performance-corrections/1'};
test('only the reviewed correction additions and exact preceding release are accepted',()=>{
 assert.equal(correctionPrerequisites(catalog()),true);assert.equal(installedCorrections(catalog()),false);assert.equal(installedCorrections(catalog(true)),true);
 for(const mutate of [c=>c.correctionFunctions[0].definition+=' changed',c=>c.correctionFunctions[0].serviceExecute=true,c=>c.correctionAccess[0].allowed=!c.correctionAccess[0].allowed,c=>c.tables.find(t=>t.name==='learn_performance_corrections').policies[0].using='true',c=>c.tables.find(t=>t.name==='measurements').triggers.pop(),c=>c.base.inventory.tables.find(t=>t.name==='learn_performance_corrections').columns[0].authenticatedSelect=false,c=>c.base.functions[0].version++,c=>c.readiness.customMigrationEntries.pop()]){
 const c=catalog(true);mutate(c);assert.equal(installedCorrections(c),false);
 }
 assert.match(correctionReleaseSql(true),/\nrollback;\n/);assert.doesNotMatch(correctionReleaseSql(true),/\ncommit;\n/);
});
test('rollback/install and lost responses submit once; stale or foreign prerequisites submit nothing',async()=>{
 const m=mock({...options,rehearse:true});const rehearsal=await releaseCorrections({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');assert.equal(m.writes,1);
 for(const change of [{},{unknown:true},{unknown:true,commitUnknown:true}]){const n=mock({...options,...change});const r=await releaseCorrections({...args,rehearse:false,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,change.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{afterFingerprint:'wrong'},{observedAt:'2020-01-01'},{acknowledged:false}]){const n=mock(options);await assert.rejects(()=>releaseCorrections({...args,rehearse:false,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const n=mock(options);await assert.rejects(()=>releaseCorrections({...args,allowProjectRef:'production',rehearse:true,fetcher:n.fetcher}));assert.equal(n.writes,0);
 const already=mock({...options,beforeCatalog:()=>catalog(true)});assert.equal((await releaseCorrections({...args,rehearse:false,fetcher:already.fetcher})).state,'already_installed');assert.equal(already.writes,0);
});
