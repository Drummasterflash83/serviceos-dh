import {sourceCatalog} from './learn-sources-test-fixture.mjs';
import {expectedAssessments,ASSESSMENT_RELEASE,ASSESSMENT_SHA} from './learn-test-assessments-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';import {TEST_PROJECT} from './learn-test-readiness.mjs';
export function assessmentCatalog(installed=false){const c=sourceCatalog(true);c.assessmentFunctions=[];c.assessmentAccess=[];
 if(installed){const e=expectedAssessments();c.tables.push(e.table);c.assessmentFunctions=e.functions;c.assessmentAccess=e.access;
 c.base.inventory.tables.push({schema:'public',name:e.table.name,rls:e.table.rls,forceRls:e.table.forceRls,anonSelect:false,authenticatedSelect:true,columns:e.table.columns.map(({name,type,notNull})=>({name,type,notNull,authenticatedSelect:true})),policies:e.table.policies.map(({permissive,...p})=>p)});
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));
 const r={migration_name:ASSESSMENT_RELEASE,source_sha256:ASSESSMENT_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;}
