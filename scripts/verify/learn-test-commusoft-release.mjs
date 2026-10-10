/** Pinned, additive TEST-only Commusoft release. Never retry uncertain writes. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readCommusoftCatalog,COMMUSOFT_MANIFEST as manifest,COMMUSOFT_FUNCTIONS,COMMUSOFT_HELPERS} from './learn-commusoft-catalog.mjs';
import {installedImportPaginationEndpoint} from './learn-test-import-pagination-endpoint-catalog.mjs';
import {importBatchesFingerprint} from './learn-test-import-batches-release.mjs';
import {compactImportTable} from './learn-test-import-release.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const COMMUSOFT_RELEASE='learn_commusoft_inputs_v1';
export const COMMUSOFT_SHA='78e885c2bcb815fb7308dc1431155dab3542171abef7db9fe29c23fcd901eeee';
const EXPECTED_SHA='92ceb001fdf1a47b21fe043dc7ced4a4fe3ec2a4f100de30d5799ea7f5668e73',MANIFEST_SHA='3763d09a997452fc31a8dac3fc38012f204c69c5247335404b0e217c27f9c42d';
const PREREQUISITES_SHA='31d32216ecd5ab298fb9dd6e163f709132033c715970f7441c3b3dea974e15a8';
export const commusoftPriorContract=()=>JSON.parse(checked('026_commusoft_inputs.prerequisites.json',PREREQUISITES_SHA));
const MARKER='learn-test-commusoft-release/1';
function checked(name,hash){const raw=readFileSync(new URL('../../supabase/release/learn-test/'+name,import.meta.url));if(createHash('sha256').update(raw).digest('hex')!==hash)throw Error('Reviewed Commusoft package differs');return raw.toString();}
export function expectedCommusoft(){checked('026_commusoft_inputs.manifest.json',MANIFEST_SHA);return JSON.parse(checked('026_commusoft_inputs.expected.json',EXPECTED_SHA));}
export const commusoftFingerprint=c=>digest({prior:importBatchesFingerprint(c),functions:c.commusoftFunctions,grants:c.commusoftGrants});
export function commusoftPrerequisites(c){return installedImportPaginationEndpoint(c)&&digest(c.commusoftFunctions)===digest(commusoftPriorContract().functions)&&digest(c.commusoftGrants)===digest(commusoftPriorContract().grants)&&c.commusoftFunctions?.length===COMMUSOFT_HELPERS.length+1&&c.commusoftFunctions.every(f=>[...COMMUSOFT_HELPERS,'platform_jobs_claim'].includes(f.name))&&!c.tables.some(t=>manifest.tables.includes(t.name))&&c.commusoftGrants.every(g=>!manifest.tables.includes(g.table));}
export function withoutCommusoft(c){
 const prior=structuredClone(c);
 const undo=f=>f.name==='platform_jobs_claim'?{...f,definition:f.definition.replace("\n      and c.job_type <> 'commusoft.source_sync'",'')}:f;
 prior.commusoftFunctions=prior.commusoftFunctions.filter(f=>!manifest.functions.includes(f.name)).map(undo);
 prior.workerFunctions=prior.workerFunctions.map(undo);
 prior.threadFunctions=prior.threadFunctions.map(undo);
 prior.commusoftGrants=prior.commusoftGrants.filter(g=>!manifest.tables.includes(g.table));
 prior.tables=prior.tables.filter(t=>!manifest.tables.includes(t.name));
 prior.base.inventory.tables=prior.base.inventory.tables.filter(t=>t.schema!=='public'||!manifest.tables.includes(t.name));
 prior.base.inventory.functions=prior.base.inventory.functions.filter(f=>!manifest.functions.includes(f.name));
 for(const report of [prior.readiness,prior.base.report])report.customMigrationEntries=report.customMigrationEntries.filter(e=>e.migration_name!==COMMUSOFT_RELEASE);
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);return prior;
}
export function installedCommusoft(c){
 const e=expectedCommusoft(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==27||entries.filter(r=>r.migration_name===COMMUSOFT_RELEASE&&r.source_sha256===COMMUSOFT_SHA&&r.project_ref===TEST_PROJECT).length!==1||digest(c.commusoftFunctions?.filter(f=>COMMUSOFT_FUNCTIONS.includes(f.name)))!==digest(e.functions)||digest(c.tables.filter(t=>manifest.tables.includes(t.name)))!==digest(e.tables)||digest(c.commusoftGrants.filter(g=>manifest.tables.includes(g.table)))!==digest(e.grants))return false;
 const compact=e.functions.filter(f=>manifest.functions.includes(f.name)).map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}));
 if(digest(c.base.inventory.functions.filter(f=>manifest.functions.includes(f.name)))!==digest(compact)||digest(c.base.inventory.tables.filter(t=>t.schema==='public'&&manifest.tables.includes(t.name)))!==digest(e.tables.map(compactImportTable)))return false;
 const worker=c.workerFunctions.find(f=>f.name==='platform_jobs_claim');
 if(digest(worker)!==digest(e.functions.find(f=>f.name==='platform_jobs_claim')))return false;
 if(digest(c.threadFunctions.find(f=>f.name==='platform_jobs_claim'))!==digest(worker))return false;
 return commusoftPrerequisites(withoutCommusoft(c));
}
export function commusoftSql(rehearse){
 expectedCommusoft();let s=checked('026_commusoft_inputs.sql',COMMUSOFT_SHA);
 for(const source of manifest.sources){const raw=readFileSync(new URL('../../'+source.path,import.meta.url));if(createHash('sha256').update(raw).digest('hex')!==source.sha256)throw Error('Commusoft migration changed since packaging');}
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Commusoft transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${COMMUSOFT_SHA}';\n`);
 if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${COMMUSOFT_RELEASE}' and source_sha256='${COMMUSOFT_SHA}') as receipt_expected;`;
}
export async function releaseCommusoft({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readCommusoftCatalog(args);
 if(installedCommusoft(before))return {state:'already_installed',writeAttempted:false};
 if(!commusoftPrerequisites(before))throw Error('Exact TEST release 025 and importer v3 with absent Commusoft objects required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==COMMUSOFT_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==commusoftFingerprint(before)||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000)throw Error('Fresh matching Commusoft rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,commusoftSql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never retry uncertain writes. */}
 let after=null;try{after=await readCommusoftCatalog(args);}catch{}
 const verified=after&&(rehearse?commusoftPrerequisites(after)&&commusoftFingerprint(before)===commusoftFingerprint(after):installedCommusoft(after)&&commusoftFingerprint(withoutCommusoft(after))===commusoftFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:COMMUSOFT_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:commusoftFingerprint(before),afterFingerprint:after?commusoftFingerprint(after):null,scope:'Retained input/review schema and empty module-switch store. No credentials, enabled flags, connections, approvals, jobs, providers, schedules, Edge or production changes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
 if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST Commusoft release required');
 const r=await releaseCommusoft({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
