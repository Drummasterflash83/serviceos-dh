import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {importCatalog} from './learn-import-test-fixture.mjs';
import {mock} from './learn-communications-test-fixture.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {installedImportAuthority,expectedImportAuthority,importAuthoritySql,releaseImportAuthority,IMPORT_AUTHORITY_RELEASE,IMPORT_AUTHORITY_SHA} from './learn-test-import-authority-release.mjs';
function catalog(installed=false){const c=importCatalog(true);if(installed){c.importFunctions=c.importFunctions.map(f=>f.name==='import_row_preamble'?expectedImportAuthority()[0]:f);const r={migration_name:IMPORT_AUTHORITY_RELEASE,source_sha256:IMPORT_AUTHORITY_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}c.readinessCatalogSha256=catalogFingerprint(c.base);return c;}
function transport(opts={}){const beforeCatalog=opts.beforeCatalog??(()=>catalog()),installedCatalog=()=>catalog(true),m=mock({...opts,beforeCatalog,installedCatalog,marker:'learn-test-import-authority/1'});return {get writes(){return m.writes;},fetcher:async(url,o)=>{const q=o?.body?JSON.parse(o.body).query:null;if(q?.includes('as import_functions')||q?.includes('as import_profiles')){const c=m.writes>0&&!opts.rehearse&&(!opts.unknown||opts.commitUnknown)?installedCatalog():beforeCatalog();return Response.json([q.includes('as import_functions')?{import_functions:c.importFunctions}:{import_profiles:c.importProfiles}]);}return m.fetcher(url,o);}};}
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)};
test('only the exact private row authority definition may change',()=>{
 assert.equal(installedImportAuthority(catalog()),false);assert.equal(installedImportAuthority(catalog(true)),true);
 for(const change of [c=>c.importFunctions.find(f=>f.name==='import_row_preamble').definition+=' drift',c=>c.importFunctions[0].definition+=' drift',c=>c.importFunctions.find(f=>f.name==='import_row_preamble').authenticatedExecute=true,c=>c.importProfiles[0].active=false,c=>c.threadRecoveryFunctions[0].definition+=' drift',c=>c.readiness.customMigrationEntries.pop()]){const c=catalog(true);change(c);assert.equal(installedImportAuthority(c),false);}
 const migration=readFileSync(new URL('../../supabase/migrations/20261031060000_learn_import_actor_authority.sql',import.meta.url),'utf8').split('\nbegin;\n')[1].split('\ncommit;\n')[0];assert.ok(importAuthoritySql(false).includes(migration));assert.match(importAuthoritySql(true),/\nrollback;\n/);assert.doesNotMatch(importAuthoritySql(true),/\ncommit;\n/);
});
test('fresh rehearsal permits one write; uncertain writes and changed targets cannot be replayed',async()=>{
 const m=transport({rehearse:true}),rehearsal=await releaseImportAuthority({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');
 for(const o of [{},{unknown:true},{unknown:true,commitUnknown:true}]){const n=transport(o),r=await releaseImportAuthority({...args,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,o.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{afterFingerprint:'different'},{observedAt:'2020-01-01'},{acknowledged:false},{sourceSha256:'changed'}]){const n=transport();await assert.rejects(()=>releaseImportAuthority({...args,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const wrong=transport();await assert.rejects(()=>releaseImportAuthority({...args,allowProjectRef:'production',rehearse:true,fetcher:wrong.fetcher}));assert.equal(wrong.writes,0);
 const already=transport({beforeCatalog:()=>catalog(true)});assert.equal((await releaseImportAuthority({...args,fetcher:already.fetcher})).state,'already_installed');assert.equal(already.writes,0);
});
