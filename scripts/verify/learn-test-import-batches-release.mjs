/** Pinned TEST-only bounded governed import helpers. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readImportBatchesCatalog,IMPORT_BATCH_FUNCTIONS} from './learn-import-batches-catalog.mjs';
import {installedImportCards,importCardsFingerprint} from './learn-test-import-cards-release.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const IMPORT_BATCHES_RELEASE='learn_import_batches_v1';
export const IMPORT_BATCHES_SHA='fc904ebd3a7fb4ec45e6c78994ed954289c317ab15aefbbae40f3dd687cad9cd';
const EXPECTED_SHA='52a144254023724d1a3a20e3bdf6549f3e64daac9c434636e56782e701cb8df8';
const MARKER='learn-test-import-batches/1';
function checked(name,hash){const raw=readFileSync(new URL('../../supabase/release/learn-test/'+name,import.meta.url));if(createHash('sha256').update(raw).digest('hex')!==hash)throw Error('Reviewed import batch file differs');return raw.toString();}
export const expectedImportBatches=()=>JSON.parse(checked('025_import_batches.expected.json',EXPECTED_SHA));
export const importBatchesFingerprint=c=>digest({prior:importCardsFingerprint(c),functions:c.importBatchFunctions});
export function importBatchesPrerequisites(c){return installedImportCards(c)&&c.importBatchFunctions?.length===0;}
export function withoutImportBatches(c){
 const prior=structuredClone(c);prior.importBatchFunctions=[];
 prior.base.inventory.functions=prior.base.inventory.functions.filter(f=>!IMPORT_BATCH_FUNCTIONS.includes(f.name));
 for(const r of [prior.readiness,prior.base.report])r.customMigrationEntries=r.customMigrationEntries.filter(e=>e.migration_name!==IMPORT_BATCHES_RELEASE);
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);return prior;
}
export function installedImportBatches(c){
 const entries=c.readiness?.customMigrationEntries,e=expectedImportBatches();
 if(!Array.isArray(entries)||entries.length!==26||entries.filter(r=>r.migration_name===IMPORT_BATCHES_RELEASE&&r.source_sha256===IMPORT_BATCHES_SHA&&r.project_ref===TEST_PROJECT).length!==1||digest(c.importBatchFunctions)!==digest(e))return false;
 const compact=e.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}));
 return digest(c.base.inventory.functions.filter(f=>IMPORT_BATCH_FUNCTIONS.includes(f.name)))===digest(compact)&&importBatchesPrerequisites(withoutImportBatches(c));
}
export function importBatchesSql(rehearse){
 let s=checked('025_import_batches.sql',IMPORT_BATCHES_SHA);
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Batch transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${IMPORT_BATCHES_SHA}';\n`);
 if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${IMPORT_BATCHES_RELEASE}' and source_sha256='${IMPORT_BATCHES_SHA}') as receipt_expected;`;
}
export async function releaseImportBatches({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readImportBatchesCatalog(args);
 if(installedImportBatches(before))return {state:'already_installed',writeAttempted:false};
 if(!importBatchesPrerequisites(before))throw Error('Exact TEST release 024 with endpoint v1 and absent batch helpers required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==IMPORT_BATCHES_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==importBatchesFingerprint(before)||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000)throw Error('Fresh matching batch rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,importBatchesSql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never retry uncertain writes. */}
 let after=null;try{after=await readImportBatchesCatalog(args);}catch{}
 const verified=after&&(rehearse?importBatchesPrerequisites(after)&&importBatchesFingerprint(before)===importBatchesFingerprint(after):installedImportBatches(after)&&importBatchesFingerprint(withoutImportBatches(after))===importBatchesFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:IMPORT_BATCHES_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:importBatchesFingerprint(before),afterFingerprint:after?importBatchesFingerprint(after):null,scope:'Three private bounded import functions. No backfill, existing-card edits, imports, Edge changes, providers, schedules or production changes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
 if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST batch release required');
 const r=await releaseImportBatches({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
