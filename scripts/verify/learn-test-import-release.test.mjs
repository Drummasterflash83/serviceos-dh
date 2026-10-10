import {importCatalog as catalog} from './learn-import-test-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mock} from './learn-communications-test-fixture.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {buildImportBundle} from './learn-import-bundle.mjs';
import {importPrerequisites,installedImports,importReleaseSql,releaseImports,IMPORT_SHA} from './learn-test-import-release.mjs';
function transport(opts={}){
 const beforeCatalog=opts.beforeCatalog??(()=>catalog()),installedCatalog=()=>catalog(true);
 const m=mock({...opts,beforeCatalog,installedCatalog,marker:'learn-test-governed-imports/1'});
 return {get writes(){return m.writes;},fetcher:async(url,o)=>{const q=o?.body?JSON.parse(o.body).query:null;
 if(q?.includes('as import_functions')||q?.includes('as import_profiles')){const c=m.writes>0&&!opts.rehearse&&(!opts.unknown||opts.commitUnknown)?installedCatalog():beforeCatalog();return Response.json([q.includes('as import_functions')?{import_functions:c.importFunctions}:{import_profiles:c.importProfiles}]);}
 return m.fetcher(url,o);}};
}
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)};
test('candidate bytes retain the tested historical migrations and explicit prerequisites',()=>{
 const b=buildImportBundle();assert.equal(b.manifest.sha256,IMPORT_SHA);assert.equal(b.sql,readFileSync(new URL('../../supabase/release/learn-test/022_governed_imports.sql',import.meta.url),'utf8'));
 for(const file of Object.keys(b.manifest.sources).slice(2))assert.ok(b.sql.includes(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8')));
 assert.match(b.sql,/contact_points_person_tenant_fk/);assert.match(b.sql,/learn_slack_thread_recovery_v1/);
 assert.match(importReleaseSql(true),/\nrollback;\n/);assert.doesNotMatch(importReleaseSql(true),/\ncommit;\n/);
});
test('exact installation check refuses changed prior state, tenant guards, helper privileges and profiles',()=>{
 assert.equal(importPrerequisites(catalog()),true);assert.equal(installedImports(catalog()),false);assert.equal(installedImports(catalog(true)),true);
 for(const mutate of [c=>c.importFunctions[0].definition+=' drift',c=>c.importFunctions[0].anonExecute=true,c=>c.importProfiles[0].definition.governed=false,c=>c.importProfiles[0].tenant_id='foreign',c=>c.tables.find(t=>t.name==='contact_points').constraints.pop(),c=>c.tables.find(t=>t.name==='people').indexes.find(i=>i.name==='people_tenant_id_uk').definition+=' drift',c=>c.threadRecoveryFunctions[0].definition+=' drift',c=>c.base.inventory.tables.find(t=>t.name==='import_row_results').columns[0].authenticatedSelect=true,c=>c.readiness.customMigrationEntries.pop()]){const c=catalog(true);mutate(c);assert.equal(installedImports(c),false);}
});
test('rehearsal gates apply, unknown outcomes inspect once, wrong or changed prerequisites make no write',async()=>{
 const m=transport({rehearse:true}),rehearsal=await releaseImports({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');assert.equal(m.writes,1);
 for(const options of [{},{unknown:true},{unknown:true,commitUnknown:true}]){const n=transport(options),r=await releaseImports({...args,rehearse:false,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,options.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{afterFingerprint:'different'},{observedAt:'2020-01-01'},{acknowledged:false},{sourceSha256:'changed'},{projectRef:'production'}]){const n=transport();await assert.rejects(()=>releaseImports({...args,rehearse:false,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const wrong=transport();await assert.rejects(()=>releaseImports({...args,allowProjectRef:'production',rehearse:true,fetcher:wrong.fetcher}));assert.equal(wrong.writes,0);
 const already=transport({beforeCatalog:()=>catalog(true)});assert.equal((await releaseImports({...args,rehearse:false,fetcher:already.fetcher})).state,'already_installed');assert.equal(already.writes,0);
 const drift=transport({beforeCatalog:()=>{const c=catalog();c.importProfiles=[{name:'existing prepared profile'}];return c;}});await assert.rejects(()=>releaseImports({...args,rehearse:true,fetcher:drift.fetcher}));assert.equal(drift.writes,0);
});
