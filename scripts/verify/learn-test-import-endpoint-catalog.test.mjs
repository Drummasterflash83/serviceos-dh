import test from 'node:test';import assert from 'node:assert/strict';
import {importAuthorityCatalog} from './learn-import-authority-test-fixture.mjs';
import {expectedImportEndpoint,installedImportEndpoint} from './learn-test-import-endpoint-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
function catalog(){const c=importAuthorityCatalog(true);c.base.functions.push(expectedImportEndpoint().endpoint);c.readinessCatalogSha256=catalogFingerprint(c.base);return c;}
test('exact endpoint extends all authority/schema checks without mutating the catalog',()=>{
 const c=catalog(),before=structuredClone(c);assert.equal(installedImportEndpoint(c),true);assert.deepEqual(c,before);assert.equal(installedImportEndpoint(importAuthorityCatalog(true)),false);
});
test('changed runtime, JWT policy, old schema, extra endpoint or duplicate cannot pass',()=>{
 for(const change of [c=>c.base.functions.at(-1).version++,c=>c.base.functions.at(-1).verify_jwt=false,c=>c.base.functions.at(-1).ezbr_sha256='different',c=>c.base.functions.push({...c.base.functions.at(-1)}),c=>c.base.functions.push({slug:'unreviewed',version:1,status:'ACTIVE'}),c=>c.importFunctions[0].owner='changed',c=>c.readiness.customMigrationEntries.pop()]){const c=catalog();change(c);assert.equal(installedImportEndpoint(c),false);}
});
