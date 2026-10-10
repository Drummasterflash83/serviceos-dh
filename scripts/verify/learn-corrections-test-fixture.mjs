import {baseline} from './learn-communications-test-fixture.mjs';
import {expectedCommunicationContext,CONTEXT_RELEASE,CONTEXT_SHA} from './learn-test-communication-context.mjs';
import {expectedCorrections,CORRECTION_RELEASE,CORRECTION_SHA} from './learn-test-corrections-release.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
export function correctionCatalog(installed=false){
 const c=baseline(true);Object.assign(c.communications,expectedCommunicationContext());
 const receipts=[[CONTEXT_RELEASE,CONTEXT_SHA]];
 c.correctionFunctions=[];c.correctionAccess=[];
 if(installed){const e=expectedCorrections();c.tables.push(e.table);c.correctionFunctions=e.functions;c.correctionAccess=e.access;
 c.base.inventory.tables.push({schema:'public',name:e.table.name,rls:e.table.rls,forceRls:e.table.forceRls,anonSelect:false,authenticatedSelect:true,columns:e.table.columns.map(({name,type,notNull})=>({name,type,notNull,authenticatedSelect:true})),policies:e.table.policies.map(({permissive,...p})=>p)});
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
 receipts.push([CORRECTION_RELEASE,CORRECTION_SHA]);}
 for(const [migration_name,source_sha256]of receipts){const r={migration_name,source_sha256,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
