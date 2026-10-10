import {correctionCatalog} from './learn-corrections-test-fixture.mjs';
import {expectedSources,expectedSourceAccess,SOURCE_RELEASE,SOURCE_SHA} from './learn-test-sources-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';import {TEST_PROJECT} from './learn-test-readiness.mjs';
export function sourceCatalog(installed=false){
 const c=correctionCatalog(true);c.sourceReader={functions:[],policies:[],grants:[],access:expectedSourceAccess()};
 if(installed){const e=expectedSources();Object.assign(c.sourceReader,e);c.communications.readerGrants.push(...e.grants);
 for(const p of e.policies){const {table,...full}=p,{permissive,...compact}=full;c.tables.find(t=>t.name===table).policies.push(full);c.base.inventory.tables.find(t=>t.name===table).policies.push(compact);c.base.inventory.launchMetadata.relations.find(t=>t.name===table).policies.push(compact);}
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
 const r={migration_name:SOURCE_RELEASE,source_sha256:SOURCE_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
