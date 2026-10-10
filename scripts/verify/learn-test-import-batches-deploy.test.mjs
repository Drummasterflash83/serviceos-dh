import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';
import {importBatchesCatalog,importBatchesTransport} from './learn-import-batches-test-fixture.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {importEndpointBundle,assertImportEndpoint,deployImportEndpoint} from './learn-test-import-batches-deploy.mjs';
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40)};
test('pinned bundle contains the actual bounded facade, reused handler and every relative dependency',()=>{
 const b=importEndpointBundle();assertImportEndpoint(b);assert.equal(b.files.length,11);assert.throws(()=>assertImportEndpoint({...b,sha256:'different'}));assert.ok(b.files.some(f=>f.path==='data-import/handler.ts'));assert.ok(!b.files.some(f=>f.path==='data-import/index.ts'));
});
test('only the reviewed TEST endpoint replacement is staged; existing endpoints/wrong projects stop before deployment',async()=>{
 let submitted=false,stage=null,calls=0;
 const c=()=>{const c=importBatchesCatalog(true);if(submitted)c.base.functions=c.base.functions.map(f=>f.slug==='learn-data-import'?{...f,version:f.version+1,ezbr_sha256:'synthetic-v2'}:f);return c;};
 const m=importBatchesTransport({beforeCatalog:c});
 const runCli=(bin,a,o)=>{calls++;assert.equal(a.join(' ').includes('--project-ref '+TEST_PROJECT),true);assert.deepEqual(a.slice(0,3),['functions','deploy','learn-data-import']);assert.ok(a.includes('--use-api'));assert.ok(!a.includes('--prune'));stage=a[a.indexOf('--workdir')+1];assert.match(readFileSync(join(stage,'supabase/config.toml'),'utf8'),/verify_jwt = true/);for(const f of importEndpointBundle().files)assert.equal(readFileSync(join(stage,'supabase/functions',f.path),'utf8'),f.source);assert.equal(o.env.SUPABASE_ACCESS_TOKEN,args.token);submitted=true;return {status:0};};
 const r=await deployImportEndpoint({...args,fetcher:m.fetcher,runCli});assert.equal(r.state,'deployed_needs_authenticated_acceptance',JSON.stringify(r));assert.equal(calls,1);assert.equal(existsSync(stage),false);
 await assert.rejects(()=>deployImportEndpoint({...args,fetcher:m.fetcher,runCli}),/Exact TEST release 025/);assert.equal(calls,1);
 await assert.rejects(()=>deployImportEndpoint({...args,allowProjectRef:'production',fetcher:m.fetcher,runCli}));assert.equal(calls,1);
});
test('uncertain CLI result is inspected without a second submission',async()=>{
 let calls=0;const m=importBatchesTransport({beforeCatalog:()=>importBatchesCatalog(true)});
 const r=await deployImportEndpoint({...args,fetcher:m.fetcher,runCli:()=>{calls++;return {status:null};}});assert.equal(calls,1);assert.equal(r.state,'requires_inspection');
});
