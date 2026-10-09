/** Exact TEST rehearsal/install. An uncertain write is inspected, never retried. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {checkedThreads,THREADS_RELEASE_NAME as NAME} from './learn-slack-threads-bundle.mjs';
import {readThreadsCatalog,THREADS_FUNCTIONS} from './learn-slack-threads-catalog.mjs';
import {installedWorker,workerFingerprint} from './learn-test-worker-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='c476f687762c1bb648c7ecdd7bd9bdb054b1d7f5ccc9cb43af17468991edf5ce';
export const REHEARSAL_MARKER='learn-test-threads-rehearsal/1',MARKER='learn-test-threads-release/1';
export const threadsBefore=()=>{const c=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-threads-before-schema-2026-10-10.json',import.meta.url)));return {...c,threadFunctions:c.workerFunctions};};
export const threadsFingerprint=c=>digest({prior:workerFingerprint(c),functions:c.threadFunctions});
export function assertThreadsPrerequisites(c){
 if(!installedWorker(c)||threadsFingerprint(c)!==threadsFingerprint(threadsBefore()))throw Error('Exact reviewed TEST thread prerequisites required');
}
export function threadsReleaseSql(){const b=checkedThreads();if(b.manifest.sha256!==SOURCE_SHA256||b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Reviewed threads framing/checksum differs');return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`);}
export function threadsRehearsalSql(){return threadsReleaseSql().replace('\ncommit;\n',`\nrollback;\nselect '${REHEARSAL_MARKER}' as rehearsal,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`);}
export function expectedThreads(){const e=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/011_slack_threads.expected.json',import.meta.url)));if(e.sourceSha256!==SOURCE_SHA256||e.functions?.length!==13||e.tables?.length!==1)throw Error('Thread expected definitions differ');return e;}
function withoutThreads(after){
 const c=structuredClone(after),prior=threadsBefore();
 c.threadFunctions=prior.threadFunctions;c.workerFunctions=prior.workerFunctions;
 c.tables=c.tables.filter(t=>t.name!=='slack_thread_imports');
 c.base.inventory.tables=c.base.inventory.tables.filter(t=>!(t.schema==='public'&&t.name==='slack_thread_imports'));
 c.base.inventory.functions=c.base.inventory.functions.filter(f=>!THREADS_FUNCTIONS.includes(f.name)).concat(prior.base.inventory.functions.filter(f=>THREADS_FUNCTIONS.includes(f.name))).sort((a,b)=>a.name.localeCompare(b.name));
 c.readiness.customMigrationEntries=c.readiness.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.base.report.customMigrationEntries=c.base.report.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.readinessCatalogSha256=catalogFingerprint(c.base);
 return c;
}
export function installedThreads(c){
 const e=expectedThreads(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==12||!entries.some(r=>r.migration_name===NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT)
  ||digest(c.threadFunctions)!==digest(e.functions)||digest(c.tables.filter(t=>t.name==='slack_thread_imports'))!==digest(e.tables))return false;
 const prior=withoutThreads(c);
 // Schema recognition allows a separately verified Slack endpoint replacement.
 // Other endpoint metadata must still exactly match the prerequisite snapshot.
 prior.base.functions=prior.base.functions.filter(f=>f.slug!=='learn-slack-worker').concat(threadsBefore().base.functions.filter(f=>f.slug==='learn-slack-worker'));
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);
 return installedWorker(prior)&&threadsFingerprint(prior)===threadsFingerprint(threadsBefore());
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
export async function rehearseThreads({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher},before=await readThreadsCatalog(args);assertThreadsPrerequisites(before);
 const r=await writeOnce(threadsRehearsalSql(),token,fetcher),acknowledged=r.data?.length===1&&r.data[0].rehearsal===REHEARSAL_MARKER&&r.data[0].receipt_absent===true;
 let after=null;try{after=await readThreadsCatalog(args);}catch{}
 const beforeHash=threadsFingerprint(before),afterHash=after?threadsFingerprint(after):null,catalogUnchanged=beforeHash===afterHash;
 return {version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&catalogUnchanged?'rehearsed_and_rolled_back':'requires_inspection',observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,catalogUnchanged,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash};
}
export async function applyThreads({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readThreadsCatalog(args);
 if(installedThreads(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed_needs_user_verification',writeAttempted:false,observedAfter:before.observedAt};
 assertThreadsPrerequisites(before);
 const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
 if(rehearsal?.version!==REHEARSAL_MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==threadsFingerprint(before))throw Error('Fresh matching threads rehearsal required');
 const r=await writeOnce(threadsReleaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations where migration_name='${NAME}';`,token,fetcher);
 const acknowledged=r.data?.length===1&&r.data[0].release===MARKER&&r.data[0].source_sha256===SOURCE_SHA256;
 let after=null;try{after=await readThreadsCatalog(args);}catch{}
 const installed=after?installedThreads(after):false,preserved=after?threadsFingerprint(withoutThreads(after))===threadsFingerprint(before):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&installed&&preserved?'installed_needs_user_verification':'release_requires_inspection',writeAttempted:true,observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,beforeCatalogSha256:threadsFingerprint(before),afterCatalogSha256:after?threadsFingerprint(after):null,limitations:['TEST thread approval table and functions only. No credentials, source rows, schedules, provider requests or production changes.','Hosted API/Edge acceptance is still required. An uncertain write is never automatically retried.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2);if(process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT||a[1]!=='--existing-cli-login')throw Error('Explicit TEST target and saved login required');
 let result;
 if(a.length===2&&a[0]==='--rehearse')result=await rehearseThreads({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
 else if(a.length===4&&a[0]==='--apply'&&a[2]==='--rehearsal-report')result=await applyThreads({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:JSON.parse(readFileSync(a[3]))});
 else throw Error('Explicit rehearsal or install with rehearsal report required');
 console.log(JSON.stringify(result,null,2));if(!['rehearsed_and_rolled_back','installed_needs_user_verification','already_installed_needs_user_verification'].includes(result.state))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
