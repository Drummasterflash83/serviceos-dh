import {importCardsCatalog} from './learn-import-cards-test-fixture.mjs';
import {expectedImportBatches,IMPORT_BATCHES_RELEASE,IMPORT_BATCHES_SHA} from './learn-test-import-batches-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {mock} from './learn-communications-test-fixture.mjs';
export function importBatchesCatalog(installed=false){
 const c=importCardsCatalog(true);c.importBatchFunctions=[];
 if(installed){const e=expectedImportBatches();c.importBatchFunctions=e;
 c.base.inventory.functions.push(...e.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));c.base.inventory.functions.sort((a,b)=>a.name.localeCompare(b.name));
 const r={migration_name:IMPORT_BATCHES_RELEASE,source_sha256:IMPORT_BATCHES_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
export function importBatchesTransport(opts={}){
 const beforeCatalog=opts.beforeCatalog??(()=>importBatchesCatalog()),installedCatalog=()=>importBatchesCatalog(true),m=mock({...opts,beforeCatalog,installedCatalog,marker:'learn-test-import-batches/1'});
 return {get writes(){return m.writes;},fetcher:async(url,o)=>{const q=o?.body?JSON.parse(o.body).query:null;
 for(const [alias,prop]of [['import_functions','importFunctions'],['import_profiles','importProfiles'],['import_card_functions','importCardFunctions'],['import_card_state','importCardState'],['import_batch_functions','importBatchFunctions']])if(q?.includes('as '+alias)){const c=m.writes>0&&!opts.rehearse&&(!opts.unknown||opts.commitUnknown)?installedCatalog():beforeCatalog();return Response.json([{[alias]:c[prop]}]);}
 return m.fetcher(url,o);}};
}
