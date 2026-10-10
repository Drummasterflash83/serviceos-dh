import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {importBatchesCatalog as catalog,importBatchesTransport as transport} from './learn-import-batches-test-fixture.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {installedImportBatches,importBatchesPrerequisites,withoutImportBatches,importBatchesSql,releaseImportBatches} from './learn-test-import-batches-release.mjs';
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)};
test('bounded functions extend exact prior chain; altered functions, indexes, trigger, grants and prior schema fail',()=>{
 const c=catalog(true),copy=structuredClone(c);assert.equal(installedImportBatches(c),true);assert.deepEqual(c,copy);assert.equal(installedImportBatches(catalog()),false);assert.equal(importBatchesPrerequisites(withoutImportBatches(c)),true);
 for(const change of [c=>c.importBatchFunctions[0].definition+=' drift',c=>c.importBatchFunctions[0].authenticatedExecute=true,c=>c.importBatchFunctions[0].securityDefiner=true,c=>c.tables.find(t=>t.name==='customer_cards').indexes.find(i=>i.name==='learn_customer_card_person_uk').definition+=' drift',c=>c.importCardState.triggers[0].enabled='D',c=>c.importCardState.indexes[0].valid=false,c=>c.importFunctions[0].owner='changed',c=>c.base.functions.at(-1).version++,c=>c.readiness.customMigrationEntries.pop()]){const x=catalog(true);change(x);assert.equal(installedImportBatches(x),false);}
 const migration=readFileSync(new URL('../../supabase/migrations/20261031080000_learn_import_batches.sql',import.meta.url),'utf8').split('\nbegin;\n')[1].split('\ncommit;\n')[0];assert.ok(importBatchesSql(false).includes(migration));assert.match(importBatchesSql(true),/\nrollback;\n/);assert.doesNotMatch(importBatchesSql(true),/\ncommit;\n/);
});
test('fresh matching rollback permits one write; uncertain outcomes require inspection and are never retried',async()=>{
 const m=transport({rehearse:true}),rehearsal=await releaseImportBatches({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');
 for(const o of [{},{unknown:true},{unknown:true,commitUnknown:true}]){const n=transport(o),r=await releaseImportBatches({...args,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,o.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{afterFingerprint:'different'},{observedAt:'2020-01-01'},{acknowledged:false},{sourceSha256:'changed'}]){const n=transport();await assert.rejects(()=>releaseImportBatches({...args,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const wrong=transport();await assert.rejects(()=>releaseImportBatches({...args,allowProjectRef:'production',rehearse:true,fetcher:wrong.fetcher}));assert.equal(wrong.writes,0);
 const already=transport({beforeCatalog:()=>catalog(true)});assert.equal((await releaseImportBatches({...args,fetcher:already.fetcher})).state,'already_installed');assert.equal(already.writes,0);
});
