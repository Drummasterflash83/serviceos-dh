import {importAuthorityCatalog} from './learn-import-authority-test-fixture.mjs';
import {expectedImportEndpoint} from './learn-test-import-endpoint-catalog.mjs';
import {expectedImportCards,IMPORT_CARDS_RELEASE,IMPORT_CARDS_SHA} from './learn-test-import-cards-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
import {mock} from './learn-communications-test-fixture.mjs';
export function importCardsCatalog(installed=false){
 const c=importAuthorityCatalog(true);c.base.functions.push(expectedImportEndpoint().endpoint);c.importCardFunctions=[];c.importCardState={triggers:[],indexes:[]};
 if(installed){const e=expectedImportCards();c.importCardFunctions=e.functions;c.importCardState=e.state;
 for(const key of ['indexes','triggers'])for(const {table,...object}of e[key]){const a=c.tables.find(t=>t.name===table)[key];a.push(object);a.sort((a,b)=>a.name.localeCompare(b.name));}
 c.base.inventory.functions.push(...e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})));c.base.inventory.functions.sort((a,b)=>a.name.localeCompare(b.name));
 const r={migration_name:IMPORT_CARDS_RELEASE,source_sha256:IMPORT_CARDS_SHA,project_ref:TEST_PROJECT,applied_at:'2026-10-10T00:00:00Z'};c.readiness.customMigrationEntries.push(r);if(c.readiness.customMigrationEntries!==c.base.report.customMigrationEntries)c.base.report.customMigrationEntries.push(r);}
 c.readinessCatalogSha256=catalogFingerprint(c.base);return c;
}
export function importCardsTransport(opts={}){
 const beforeCatalog=opts.beforeCatalog??(()=>importCardsCatalog()),installedCatalog=()=>importCardsCatalog(true),m=mock({...opts,beforeCatalog,installedCatalog,marker:'learn-test-import-cards/1'});
 return {get writes(){return m.writes;},fetcher:async(url,o)=>{const q=o?.body?JSON.parse(o.body).query:null;
 for(const [alias,prop]of [['import_functions','importFunctions'],['import_profiles','importProfiles'],['import_card_functions','importCardFunctions'],['import_card_state','importCardState']])if(q?.includes('as '+alias)){const c=m.writes>0&&!opts.rehearse&&(!opts.unknown||opts.commitUnknown)?installedCatalog():beforeCatalog();return Response.json([{[alias]:c[prop]}]);}
 return m.fetcher(url,o);}};
}
