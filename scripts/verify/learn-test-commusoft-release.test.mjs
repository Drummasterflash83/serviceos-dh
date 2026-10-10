import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMMUSOFT_MANIFEST as manifest} from './learn-commusoft-catalog.mjs';
import {commusoftPrerequisites,installedCommusoft,withoutCommusoft,commusoftSql,releaseCommusoft} from './learn-test-commusoft-release.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {catalog,transport} from './learn-commusoft-test-fixture.mjs';
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
