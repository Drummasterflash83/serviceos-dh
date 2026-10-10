import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importBatchesCatalog,importBatchesTransport} from './learn-import-batches-test-fixture.mjs';
import {expectedImportPaginationEndpoint} from './learn-test-import-pagination-endpoint-catalog.mjs';
import {COMMUSOFT_MANIFEST as manifest,COMMUSOFT_FUNCTION_QUERY,COMMUSOFT_GRANTS_QUERY} from './learn-commusoft-catalog.mjs';
import {commusoftPriorContract,commusoftPrerequisites,installedCommusoft,withoutCommusoft,commusoftSql,expectedCommusoft,releaseCommusoft,COMMUSOFT_RELEASE,COMMUSOFT_SHA} from './learn-test-commusoft-release.mjs';
import {compactImportTable} from './learn-test-import-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
function catalog(installed=false){
 const c=importBatchesCatalog(true),prior=commusoftPriorContract();
 c.base.functions=c.base.functions.map(f=>f.slug==='learn-data-import'?expectedImportPaginationEndpoint().endpoint:f);
 c.commusoftFunctions=prior.functions;c.commusoftGrants=prior.grants;
 if(installed){const e=expectedCommusoft();
  c.commusoftFunctions=c.commusoftFunctions.filter(f=>f.name!=='platform_jobs_claim').concat(e.functions).sort((a,b)=>a.name.localeCompare(b.name));
  c.workerFunctions=c.workerFunctions.map(f=>f.name==='platform_jobs_claim'?e.functions.find(x=>x.name===f.name):f);
  c.threadFunctions=c.threadFunctions.map(f=>f.name==='platform_jobs_claim'?e.functions.find(x=>x.name===f.name):f);
  c.commusoftGrants.push(...e.grants);c.tables.push(...e.tables);
  c.base.inventory.tables.push(...e.tables.map(compactImportTable));
  c.base.inventory.functions.push(...e.functions.filter(f=>manifest.functions.includes(f.name)).map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
  const receipt={migration_name:COMMUSOFT_RELEASE,source_sha256:COMMUSOFT_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};
  c.readiness.customMigrationEntries.push(receipt);if(c.base.report.customMigrationEntries!==c.readiness.customMigrationEntries)c.base.report.customMigrationEntries.push(receipt);
 }
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
function transport({rehearse=false,unknown=false,committed=false,already=false}={}){
 let writes=0;const current=()=>catalog(already||(writes>0&&!rehearse&&(!unknown||committed)));
 const base=importBatchesTransport({beforeCatalog:current});
 return {get writes(){return writes;},fetcher:async(url,o)=>{
  const query=o?.body?JSON.parse(o.body).query:null;
  if(url.endsWith('/database/query')){writes++;if(unknown)throw Error('Uncertain acknowledgement');return Response.json([{marker:'learn-test-commusoft-release/1',receipt_expected:true}]);}
  if(query===COMMUSOFT_FUNCTION_QUERY)return Response.json([{functions:current().commusoftFunctions}]);
  if(query===COMMUSOFT_GRANTS_QUERY)return Response.json([{grants:current().commusoftGrants}]);
  return base.fetcher(url,o);
 }};
}
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)};
test('package contains exact source bodies and extends the prior release without hiding drift',()=>{
 const c=catalog(true),before=structuredClone(c);assert.equal(commusoftPrerequisites(catalog()),true);assert.equal(installedCommusoft(c),true);assert.deepEqual(c,before);assert.equal(commusoftPrerequisites(withoutCommusoft(c)),true);
 for(const change of [c=>c.commusoftFunctions.find(f=>f.name==='learn_commusoft_work_batch').authenticatedExecute=false,c=>c.commusoftFunctions.find(f=>f.name==='learn_commusoft_acquire_page').anonExecute=true,c=>c.workerFunctions.find(f=>f.name==='platform_jobs_claim').definition+=' drift',c=>c.commusoftGrants.pop(),c=>c.tables.find(t=>t.name==='feature_flags').rls=false,c=>c.importFunctions[0].definition+=' drift',c=>c.base.functions[0].version++,c=>c.commusoftFunctions.find(f=>f.name==='learn_import_batch_authority').definition+=' drift']){
  const v=catalog(true);change(v);assert.equal(installedCommusoft(v),false);
 }
 const sql=commusoftSql(false);
 for(const source of manifest.sources){const s=readFileSync(new URL('../../'+source.path,import.meta.url),'utf8');assert.ok(sql.includes(s.split('\nbegin;\n')[1].split('\ncommit;')[0]));}
 assert.match(commusoftSql(true),/\nrollback;\n/);assert.doesNotMatch(commusoftSql(true),/\ncommit;\n/);
});
test('fresh rehearsal permits one write; unknown replies require inspection without resubmission',async()=>{
 const m=transport({rehearse:true});const rehearsal=await releaseCommusoft({...args,rehearse:true,fetcher:m.fetcher});assert.equal(rehearsal.state,'rehearsed_and_rolled_back');
 for(const options of [{},{unknown:true},{unknown:true,committed:true}]){const n=transport(options);const r=await releaseCommusoft({...args,rehearsal,fetcher:n.fetcher});assert.equal(n.writes,1);assert.equal(r.state,options.unknown?'requires_inspection':'installed_needs_authenticated_acceptance');}
 for(const change of [{observedAt:'2020-01-01'},{afterFingerprint:'different'},{acknowledged:false},{sourceSha256:'changed'}]){const n=transport();await assert.rejects(releaseCommusoft({...args,rehearsal:{...rehearsal,...change},fetcher:n.fetcher}));assert.equal(n.writes,0);}
 const n=transport();await assert.rejects(releaseCommusoft({...args,allowProjectRef:'production',rehearse:true,fetcher:n.fetcher}));assert.equal(n.writes,0);
 const done=transport({already:true});assert.equal((await releaseCommusoft({...args,fetcher:done.fetcher})).state,'already_installed');assert.equal(done.writes,0);
});
