import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { helperSql,helperChangePreserved,helperAccess } from './learn-test-foundation-helper-access.mjs';
import { catalogFingerprint } from './learn-test-launch-rehearsal.mjs';
import { HELPER_RELEASE_NAME,HELPER_SOURCE_SHA256 } from './learn-foundation-helper-contract.mjs';
const read=n=>JSON.parse(readFileSync(new URL('../../docs/operations/evidence/'+n,import.meta.url)));
test('repair grants only the two reviewed helpers and rehearsal has no commit',()=>{
 const sql=helperSql(false),rollback=helperSql(true);
 assert.deepEqual(sql.match(/^grant .*;$/gm),['grant execute on function public.current_tenant_id() to authenticated;','grant execute on function public.is_openfolk() to authenticated;']);
 assert.match(sql,/Reviewed helper definition differs/);assert.match(sql,/proowner='postgres'::regrole/);
 assert.equal((rollback.match(/^rollback;$/gm)??[]).length,1);assert.equal((rollback.match(/^commit;$/gm)??[]).length,0);
});
test('preservation comparison permits exactly two execute grants and one receipt, rejecting source or helper body drift',()=>{
 const before=read('learn-test-foundation-schema-2026-10-09.json');before.base=read('learn-test-launch-installed-catalog-2026-10-09.json');before.readinessCatalogSha256=catalogFingerprint(before.base);
 const after=structuredClone(before);
 for(const f of after.base.inventory.functions)if(['current_tenant_id','is_openfolk'].includes(f.name))f.authenticatedExecute=true;
 after.base.report.customMigrationEntries.push({migration_name:HELPER_RELEASE_NAME,source_sha256:HELPER_SOURCE_SHA256});after.readinessCatalogSha256=catalogFingerprint(after.base);
 assert.equal(helperChangePreserved(before,after,false),true);assert.equal(helperChangePreserved(before,after,true),false);
 const changed=structuredClone(after);changed.tables[0].columns[0].default='changed';assert.equal(helperChangePreserved(before,changed,false),false);
 changed.tables=after.tables;changed.base.inventory.tables[0].authenticatedSelect=true;changed.readinessCatalogSha256=catalogFingerprint(changed.base);assert.equal(helperChangePreserved(before,changed,false),false);
 const body=structuredClone(after);body.helpers[0].definition+=' changed';assert.equal(helperChangePreserved(before,body,false),false);
});
test('foreign target is rejected before any request',async()=>{
 let calls=0;await assert.rejects(()=>helperAccess({allowProjectRef:'production',token:'sbp_'+'a'.repeat(40),rehearse:true,fetcher:async()=>{calls++;throw Error();}}));assert.equal(calls,0);
});
