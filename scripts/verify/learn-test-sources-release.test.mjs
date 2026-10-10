import test from 'node:test';import assert from 'node:assert/strict';
import {correctionCatalog} from './learn-corrections-test-fixture.mjs';import {mock} from './learn-communications-test-fixture.mjs';
import {sourcePrerequisites,installedSources,expectedSources,expectedSourceAccess,sourceReleaseSql,releaseSources,SOURCE_RELEASE,SOURCE_SHA} from './learn-test-sources-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';import {TEST_PROJECT} from './learn-test-readiness.mjs';
function catalog(installed=false){
 const c=correctionCatalog(true);c.sourceReader={functions:[],policies:[],grants:[],access:expectedSourceAccess()};
 if(installed){const e=expectedSources();Object.assign(c.sourceReader,e);c.communications.readerGrants.push(...e.grants);
 for(const p of e.policies){const {table,...full}=p,{permissive,...compact}=full;c.tables.find(t=>t.name===table).policies.push(full);c.base.inventory.tables.find(t=>t.name===table).policies.push(compact);c.base.inventory.launchMetadata.relations.find(t=>t.name===table).policies.push(compact);}
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
 const r={migration_name:SOURCE_RELEASE,source_sha256:SOURCE_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)},options={beforeCatalog:()=>catalog(),installedCatalog:()=>catalog(true),marker:'learn-test-card-sources/1'};
test('source reader recognizes exact additions and preserves the complete prior TEST release',()=>{
 assert.equal(sourcePrerequisites(catalog()),true);assert.equal(installedSources(catalog()),false);assert.equal(installedSources(catalog(true)),true);
 for(const change of [c=>c.sourceReader.functions[0].definition+=' drift',c=>c.sourceReader.functions[0].anonExecute=true,c=>c.sourceReader.grants[0].privilege='UPDATE',c=>c.sourceReader.access[0].select=!c.sourceReader.access[0].select,c=>c.tables.find(t=>t.name==='phone_calls').policies.find(p=>p.name==='learn_card_call_source_read').using='true',c=>c.communications.readerGrants.pop(),c=>c.communications.role.bypassRls=true,c=>c.correctionFunctions[0].definition+=' drift',c=>c.base.functions[0].version++,c=>c.readiness.customMigrationEntries.pop()]){const c=catalog(true);change(c);assert.equal(installedSources(c),false);}
 assert.match(sourceReleaseSql(true),/\nrollback;\n/);assert.doesNotMatch(sourceReleaseSql(true),/\ncommit;\n/);
});
test('rehearsal, install, uncertain replies and stale or foreign prerequisites never retry writes blindly',async()=>{
 const m=mock({...options,rehearse:true}),rehearsal=await releaseSources({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');
 for(const change of [{},{unknown:true},{unknown:true,commitUnknown:true}]){const n=mock({...options,...change}),r=await releaseSources({...args,rehearse:false,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,change.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{afterFingerprint:'different'},{observedAt:'2020-01-01'},{acknowledged:false}]){const n=mock(options);await assert.rejects(()=>releaseSources({...args,rehearse:false,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const n=mock(options);await assert.rejects(()=>releaseSources({...args,allowProjectRef:'production',rehearse:true,fetcher:n.fetcher}));assert.equal(n.writes,0);
 const already=mock({...options,beforeCatalog:()=>catalog(true)});assert.equal((await releaseSources({...args,rehearse:false,fetcher:already.fetcher})).state,'already_installed');assert.equal(already.writes,0);
});
