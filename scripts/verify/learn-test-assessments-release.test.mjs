import test from 'node:test';import assert from 'node:assert/strict';
import {sourceCatalog} from './learn-sources-test-fixture.mjs';import {mock} from './learn-communications-test-fixture.mjs';
import {assessmentPrerequisites,installedAssessments,expectedAssessments,assessmentReleaseSql,releaseAssessments,ASSESSMENT_RELEASE,ASSESSMENT_SHA} from './learn-test-assessments-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';import {TEST_PROJECT} from './learn-test-readiness.mjs';
function catalog(installed=false){const c=sourceCatalog(true);c.assessmentFunctions=[];c.assessmentAccess=[];
 if(installed){const e=expectedAssessments();c.tables.push(e.table);c.assessmentFunctions=e.functions;c.assessmentAccess=e.access;
 c.base.inventory.tables.push({schema:'public',name:e.table.name,rls:e.table.rls,forceRls:e.table.forceRls,anonSelect:false,authenticatedSelect:true,columns:e.table.columns.map(({name,type,notNull})=>({name,type,notNull,authenticatedSelect:true})),policies:e.table.policies.map(({permissive,...p})=>p)});
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
 const r={migration_name:ASSESSMENT_RELEASE,source_sha256:ASSESSMENT_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;}
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)},options={beforeCatalog:()=>catalog(),installedCatalog:()=>catalog(true),marker:'learn-test-saved-assessments/1'};
test('assessment release accepts only its exact additions and complete preceding source release',()=>{
 assert.equal(assessmentPrerequisites(catalog()),true);assert.equal(installedAssessments(catalog()),false);assert.equal(installedAssessments(catalog(true)),true);
 for(const mutate of [c=>c.assessmentFunctions[0].definition+=' drift',c=>c.assessmentFunctions[1].serviceExecute=true,c=>c.assessmentAccess[0].allowed=!c.assessmentAccess[0].allowed,c=>c.tables.find(t=>t.name==='learn_assessments').triggers.pop(),c=>c.tables.find(t=>t.name==='learn_assessments').policies[0].using='true',c=>c.base.inventory.tables.find(t=>t.name==='learn_assessments').columns[0].authenticatedSelect=false,c=>c.sourceReader.functions[0].definition+=' drift',c=>c.communications.role.bypassRls=true,c=>c.base.functions[0].version++,c=>c.readiness.customMigrationEntries.pop()]){const c=catalog(true);mutate(c);assert.equal(installedAssessments(c),false);}
 assert.match(assessmentReleaseSql(true),/\nrollback;\n/);assert.doesNotMatch(assessmentReleaseSql(true),/\ncommit;\n/);
});
test('rollback/install and unknown responses preserve once-only writes; wrong/stale preconditions write nothing',async()=>{
 const m=mock({...options,rehearse:true}),rehearsal=await releaseAssessments({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');assert.equal(m.writes,1);
 for(const mode of [{},{unknown:true},{unknown:true,commitUnknown:true}]){const n=mock({...options,...mode}),r=await releaseAssessments({...args,rehearse:false,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,mode.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{afterFingerprint:'different'},{observedAt:'2020-01-01'},{acknowledged:false}]){const n=mock(options);await assert.rejects(()=>releaseAssessments({...args,rehearse:false,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const n=mock(options);await assert.rejects(()=>releaseAssessments({...args,allowProjectRef:'production',rehearse:true,fetcher:n.fetcher}));assert.equal(n.writes,0);
 const already=mock({...options,beforeCatalog:()=>catalog(true)});assert.equal((await releaseAssessments({...args,rehearse:false,fetcher:already.fetcher})).state,'already_installed');assert.equal(already.writes,0);
});
