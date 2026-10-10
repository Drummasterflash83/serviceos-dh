import test from 'node:test';import assert from 'node:assert/strict';
import {importBatchesCatalog} from './learn-import-batches-test-fixture.mjs';
import {expectedImportPaginationEndpoint,installedImportPaginationEndpoint} from './learn-test-import-pagination-endpoint-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
function catalog(){const c=importBatchesCatalog(true);c.base.functions=c.base.functions.map(f=>f.slug==='learn-data-import'?expectedImportPaginationEndpoint().endpoint:f);c.readinessCatalogSha256=catalogFingerprint(c.base);return c;}
test('exact endpoint extends all authority/schema checks without mutating the catalog',()=>{
 const c=catalog(),before=structuredClone(c);assert.equal(installedImportPaginationEndpoint(c),true);assert.deepEqual(c,before);assert.equal(installedImportPaginationEndpoint(importBatchesCatalog(true)),false);
});
test('changed runtime, JWT policy, old schema, extra endpoint or duplicate cannot pass',()=>{
 for(const change of [c=>c.base.functions.find(f=>f.slug==='learn-data-import').version++,c=>c.base.functions.find(f=>f.slug==='learn-data-import').verify_jwt=false,c=>c.base.functions.find(f=>f.slug==='learn-data-import').ezbr_sha256='different',c=>c.base.functions.push({...c.base.functions.find(f=>f.slug==='learn-data-import')}),c=>c.base.functions.push({slug:'unreviewed',version:1,status:'ACTIVE'}),c=>c.importFunctions[0].owner='changed',c=>c.readiness.customMigrationEntries.pop()]){const c=catalog();change(c);assert.equal(installedImportPaginationEndpoint(c),false);}
});
