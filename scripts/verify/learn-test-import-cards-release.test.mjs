import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {importCardsCatalog as catalog,importCardsTransport as transport} from './learn-import-cards-test-fixture.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {installedImportCards,importCardsPrerequisites,withoutImportCards,importCardsSql,releaseImportCards} from './learn-test-import-cards-release.mjs';
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)};
test('card projection extends exact prior chain; altered functions, indexes, trigger, grants and prior schema fail',()=>{
 const c=catalog(true),copy=structuredClone(c);assert.equal(installedImportCards(c),true);assert.deepEqual(c,copy);assert.equal(installedImportCards(catalog()),false);assert.equal(importCardsPrerequisites(withoutImportCards(c)),true);
 for(const change of [c=>c.importCardFunctions[0].definition+=' drift',c=>c.importCardFunctions[0].authenticatedExecute=true,c=>c.importCardFunctions[0].securityDefiner=true,c=>c.tables.find(t=>t.name==='customer_cards').indexes.find(i=>i.name==='learn_customer_card_person_uk').definition+=' drift',c=>c.importCardState.triggers[0].enabled='D',c=>c.importCardState.indexes[0].valid=false,c=>c.importFunctions[0].owner='changed',c=>c.base.functions.at(-1).version++,c=>c.readiness.customMigrationEntries.pop()]){const x=catalog(true);change(x);assert.equal(installedImportCards(x),false);}
 const migration=readFileSync(new URL('../../supabase/migrations/20261031070000_learn_import_customer_cards.sql',import.meta.url),'utf8').split('\nbegin;\n')[1].split('\ncommit;\n')[0];assert.ok(importCardsSql(false).includes(migration));assert.match(importCardsSql(true),/\nrollback;\n/);assert.doesNotMatch(importCardsSql(true),/\ncommit;\n/);
});
test('fresh matching rollback permits one write; uncertain outcomes require inspection and are never retried',async()=>{
 const m=transport({rehearse:true}),rehearsal=await releaseImportCards({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');
 for(const o of [{},{unknown:true},{unknown:true,commitUnknown:true}]){const n=transport(o),r=await releaseImportCards({...args,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,o.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{afterFingerprint:'different'},{observedAt:'2020-01-01'},{acknowledged:false},{sourceSha256:'changed'}]){const n=transport();await assert.rejects(()=>releaseImportCards({...args,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const wrong=transport();await assert.rejects(()=>releaseImportCards({...args,allowProjectRef:'production',rehearse:true,fetcher:wrong.fetcher}));assert.equal(wrong.writes,0);
 const already=transport({beforeCatalog:()=>catalog(true)});assert.equal((await releaseImportCards({...args,fetcher:already.fetcher})).state,'already_installed');assert.equal(already.writes,0);
});
