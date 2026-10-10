import {assessmentCatalog} from './learn-assessments-test-fixture.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {expectedThreadRecovery,THREAD_RECOVERY_RELEASE,THREAD_RECOVERY_SHA} from './learn-test-thread-recovery-release.mjs';
export function threadRecoveryCatalog(installed=false){
 const c=assessmentCatalog(true);c.threadRecoveryFunctions=[];
 if(installed){const e=expectedThreadRecovery();c.threadRecoveryFunctions=e.functions;c.tables.find(t=>t.name==='slack_thread_imports').indexes.push(...e.indexes);c.tables.find(t=>t.name==='slack_thread_imports').indexes.sort((a,b)=>a.name.localeCompare(b.name));
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));c.base.inventory.functions.sort((a,b)=>a.name.localeCompare(b.name));
 const r={migration_name:THREAD_RECOVERY_RELEASE,source_sha256:THREAD_RECOVERY_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
