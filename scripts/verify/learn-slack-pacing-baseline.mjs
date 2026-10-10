/** Reconstruct the verified release-013 catalog without duplicating its full predecessor. */
import {readFileSync} from 'node:fs';
import {pacingBefore,expectedPacing,installedPacing,pacingFingerprint} from './learn-test-pacing-release.mjs';
import {PACING_FUNCTIONS} from './learn-slack-pacing-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
export function pacingInstalledBaseline(){
 const c=pacingBefore(),e=expectedPacing(),receipt=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-pacing-installed-2026-10-10.json',import.meta.url)));
 c.pacingFunctions=e.functions;
 c.tables.push(...e.tables);c.tables.sort((a,b)=>a.name.localeCompare(b.name));
 for(const t of e.tables)c.base.inventory.tables.push({schema:'public',name:t.name,rls:t.rls,forceRls:t.forceRls,columns:t.columns.map(({name,type,notNull})=>({name,type,notNull,authenticatedSelect:false})),policies:t.policies,authenticatedSelect:t.authenticatedSelect,anonSelect:t.anonAccess});
 for(const key of ['threadFunctions','workerFunctions'])c[key]=c[key].map(f=>e.functions.find(n=>n.name===f.name)??f);
 c.base.inventory.functions=c.base.inventory.functions.filter(f=>!PACING_FUNCTIONS.includes(f.name)).concat(e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}))).sort((a,b)=>a.name.localeCompare(b.name));
 c.readiness.customMigrationEntries.push(receipt.receipt);c.base.report.customMigrationEntries.push(receipt.receipt);
 c.readinessCatalogSha256=catalogFingerprint(c.base);
 if(!installedPacing(c)||pacingFingerprint(c)!==receipt.catalogSha256)throw Error('Reconstructed pacing baseline differs from verified receipt');
 return c;
}
