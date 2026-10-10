import test from 'node:test';import assert from 'node:assert/strict';
import {installedPhone,expectedPhoneEndpoints} from './learn-test-phone-catalog.mjs';
import {recoveryBefore,expectedRecovery,installedRecovery,SOURCE_SHA256} from './learn-test-recovery-release.mjs';
import {RECOVERY_RELEASE_NAME} from './learn-slack-recovery-bundle.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
function baseline(){
 const c=recoveryBefore();c.recoveryFunctions=expectedRecovery().functions;
 c.base.inventory.functions.push(...c.recoveryFunctions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
 c.base.inventory.functions.sort((a,b)=>a.name.localeCompare(b.name));
 const receipt={migration_name:RECOVERY_RELEASE_NAME,source_sha256:SOURCE_SHA256,project_ref:TEST_PROJECT};
 c.readiness.customMigrationEntries.push(receipt);
 if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(receipt);
 c.readinessCatalogSha256=catalogFingerprint(c.base);assert.equal(installedRecovery(c),true);
 c.base.functions.push(...expectedPhoneEndpoints().endpoints);c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
test('exact phone additions accepted while historical release contract remains strict',()=>{
 const c=baseline(),copy=structuredClone(c);assert.equal(installedPhone(c),true);assert.equal(installedRecovery(c),false);assert.deepEqual(c,copy);
});
test('phone metadata drift, duplicates, missing endpoints and prior schema/runtime drift refused',()=>{
 const changes=[
  c=>c.base.functions.find(f=>f.slug==='simwood-sync-calls').verify_jwt=false,
  c=>c.base.functions.find(f=>f.slug==='simwood-sync-calls').version++,
  c=>c.base.functions.find(f=>f.slug==='simwood-sync-calls').ezbr_sha256='changed',
  c=>c.base.functions.pop(),c=>c.base.functions.push(c.base.functions.at(-1)),
  c=>c.base.functions.find(f=>f.slug==='learn-slack-worker').version++,
  c=>c.tables.find(t=>t.name==='email_messages').owner='changed',
  c=>c.recoveryFunctions[0].definition+=' changed',
  c=>c.base.functions.push({slug:'unreviewed-endpoint'}),
 ];
 for(const mutate of changes){const c=baseline();mutate(c);assert.equal(installedPhone(c),false);}
});
