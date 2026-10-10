import {threadRecoveryCatalog} from './learn-thread-recovery-test-fixture.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {expectedImports,compactImportTable,IMPORT_RELEASE,IMPORT_SHA} from './learn-test-import-release.mjs';
export function importCatalog(installed=false){
 const c=threadRecoveryCatalog(true);c.importFunctions=[];c.importProfiles=[];
 if(installed){const e=expectedImports();c.importFunctions=e.functions;c.importProfiles=e.profiles;c.tables.push(...e.tables);c.tables.sort((a,b)=>a.name.localeCompare(b.name));
 for(const {table,...index} of e.indexes){c.tables.find(t=>t.name===table).indexes.push(index);c.tables.find(t=>t.name===table).indexes.sort((a,b)=>a.name.localeCompare(b.name));}
 c.base.inventory.tables.push(...e.tables.map(compactImportTable));c.base.inventory.tables.sort((a,b)=>(a.schema+'.'+a.name).localeCompare(b.schema+'.'+b.name));
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));c.base.inventory.functions.sort((a,b)=>a.name.localeCompare(b.name));
 const r={migration_name:IMPORT_RELEASE,source_sha256:IMPORT_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 // Match the real catalog's SQL ordering on both sides of the release.
 c.tables.sort((a,b)=>a.name.localeCompare(b.name));
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
