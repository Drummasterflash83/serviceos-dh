/** Exact TEST rehearsal/install. An uncertain write is inspected, never retried. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {checkedWorker,WORKER_RELEASE_NAME as NAME} from './learn-slack-worker-bundle.mjs';
import {readWorkerCatalog,WORKER_FUNCTIONS} from './learn-slack-worker-catalog.mjs';
import {installedSlack} from './learn-test-slack-release.mjs';
import {slackFingerprint} from './learn-test-slack-rehearsal.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='74bfa2f96e5ad2b40fb40b1e6b03f1cdd6f605f3d8d57a598a541222f8a1955e';
export const REHEARSAL_MARKER='learn-test-worker-rehearsal/1',MARKER='learn-test-worker-release/1';
export const workerBefore=()=>JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-worker-before-schema-2026-10-09.json',import.meta.url)));
export const workerFingerprint=c=>digest({prior:slackFingerprint(c),functions:c.workerFunctions,prerequisites:c.workerPrerequisites});
export function assertWorkerPrerequisites(c){
 if(!installedSlack(c)||workerFingerprint(c)!==workerFingerprint(workerBefore()))throw Error('Exact reviewed TEST worker prerequisites required');
}
export function workerReleaseSql(){const b=checkedWorker();if(b.manifest.sha256!==SOURCE_SHA256||b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Reviewed worker framing/checksum differs');return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`);}
export function workerRehearsalSql(){return workerReleaseSql().replace('\ncommit;\n',`\nrollback;\nselect '${REHEARSAL_MARKER}' as rehearsal,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`);}
export function expectedWorker(){const e=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/010_slack_durable_worker.expected.json',import.meta.url)));if(e.sourceSha256!==SOURCE_SHA256||e.functions?.length!==7)throw Error('Worker expected definitions differ');return e;}
function normalizeVerifiedRuntimeRefresh(functions){
 // Setting the explicit TEST trigger key incremented all runtime versions by
 // one. Accept only that recorded refresh, with every other field (including
 // source hash, entrypoint and JWT verification) exactly unchanged.
 const before=workerBefore().base.functions;
 const refreshed=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-worker-post-key-schema-2026-10-09.json',import.meta.url))).base.functions;
 const omitVersion=({version,...rest})=>rest;
 for(const f of before){const r=refreshed.find(x=>x.id===f.id);if(!r||r.version!==f.version+1||digest(omitVersion(r))!==digest(omitVersion(f)))throw Error('Recorded runtime refresh differs from reviewed sources');}
 return functions.map(f=>{const r=refreshed.find(x=>x.id===f.id),b=before.find(x=>x.id===f.id);return b&&digest(f)===digest(r)?structuredClone(b):f;});
}
function withoutWorker(after){
 const c=structuredClone(after),prior=workerBefore();
 c.workerFunctions=prior.workerFunctions;
 c.slackFunctions=c.slackFunctions.filter(f=>f.name!=='slack_history_commit_page').concat(prior.slackFunctions.filter(f=>f.name==='slack_history_commit_page')).sort((a,b)=>a.name.localeCompare(b.name));
 c.base.inventory.functions=c.base.inventory.functions.filter(f=>!WORKER_FUNCTIONS.includes(f.name)).concat(prior.base.inventory.functions.filter(f=>WORKER_FUNCTIONS.includes(f.name))).sort((a,b)=>a.name.localeCompare(b.name));
 c.readiness.customMigrationEntries=c.readiness.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.base.report.customMigrationEntries=c.base.report.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.base.functions=normalizeVerifiedRuntimeRefresh(c.base.functions.filter(f=>f.slug!=='learn-slack-worker'));
 c.readinessCatalogSha256=catalogFingerprint(c.base);
 return c;
}
export function installedWorker(c){
 const e=expectedWorker(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==11||!entries.some(r=>r.migration_name===NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT)
  ||digest(c.workerFunctions)!==digest(e.functions)||digest(c.workerPrerequisites)!==digest(workerBefore().workerPrerequisites))return false;
 const prior=withoutWorker(c);
 return installedSlack(prior)&&workerFingerprint(prior)===workerFingerprint(workerBefore());
}
async function writeOnce(query,token,fetcher){
 let httpStatus=null,databaseCode=null,data=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString());
  if(r.ok)data=body;else databaseCode=/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof body?.message==='string'?body.message:'')?.[1]??null;
 }catch{/* Retain uncertainty. No write retry. */}
 return {httpStatus,databaseCode,data};
}
export async function rehearseWorker({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher},before=await readWorkerCatalog(args);assertWorkerPrerequisites(before);
 const r=await writeOnce(workerRehearsalSql(),token,fetcher),acknowledged=r.data?.length===1&&r.data[0].rehearsal===REHEARSAL_MARKER&&r.data[0].receipt_absent===true;
 let after=null;try{after=await readWorkerCatalog(args);}catch{}
 const beforeHash=workerFingerprint(before),afterHash=after?workerFingerprint(after):null,catalogUnchanged=beforeHash===afterHash;
 return {version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&catalogUnchanged?'rehearsed_and_rolled_back':'requires_inspection',observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,catalogUnchanged,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash};
}
export async function applyWorker({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readWorkerCatalog(args);
 if(installedWorker(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed_needs_user_verification',writeAttempted:false,observedAfter:before.observedAt};
 assertWorkerPrerequisites(before);
 const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
 if(rehearsal?.version!==REHEARSAL_MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==workerFingerprint(before))throw Error('Fresh matching worker rehearsal required');
 const r=await writeOnce(workerReleaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations where migration_name='${NAME}';`,token,fetcher);
 const acknowledged=r.data?.length===1&&r.data[0].release===MARKER&&r.data[0].source_sha256===SOURCE_SHA256;
 let after=null;try{after=await readWorkerCatalog(args);}catch{}
 const installed=after?installedWorker(after):false,preserved=after?workerFingerprint(withoutWorker(after))===workerFingerprint(before):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&installed&&preserved?'installed_needs_user_verification':'release_requires_inspection',writeAttempted:true,observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,beforeCatalogSha256:workerFingerprint(before),afterCatalogSha256:after?workerFingerprint(after):null,limitations:['TEST functions only. No credentials, source rows, schedules, provider requests or production changes.','Hosted API/Edge acceptance is still required. An uncertain write is never automatically retried.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2);if(process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT||a[1]!=='--existing-cli-login')throw Error('Explicit TEST target and saved login required');
 let result;
 if(a.length===2&&a[0]==='--rehearse')result=await rehearseWorker({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
 else if(a.length===4&&a[0]==='--apply'&&a[2]==='--rehearsal-report')result=await applyWorker({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:JSON.parse(readFileSync(a[3]))});
 else throw Error('Explicit rehearsal or install with rehearsal report required');
 console.log(JSON.stringify(result,null,2));if(!['rehearsed_and_rolled_back','installed_needs_user_verification','already_installed_needs_user_verification'].includes(result.state))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
