/** Exact TEST rehearsal/install. An uncertain write is inspected, never retried. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {checkedPacing,PACING_RELEASE_NAME as NAME} from './learn-slack-pacing-bundle.mjs';
import {readPacingCatalog,PACING_FUNCTIONS} from './learn-slack-pacing-catalog.mjs';
import {installedOperator,operatorFingerprint} from './learn-test-operator-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='7191b47ec926094b2118d957cddccf6ebec6c62e10e2d04670db327d23c223a5';
export const REHEARSAL_MARKER='learn-test-pacing-rehearsal/1',MARKER='learn-test-pacing-release/1';
export const pacingBefore=()=>{const c=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-operator-installed-schema-2026-10-10.json',import.meta.url)));return {...c,pacingFunctions:c.threadFunctions.filter(f=>PACING_FUNCTIONS.includes(f.name))};};
export const pacingFingerprint=c=>digest({prior:operatorFingerprint(c),functions:c.pacingFunctions});
export function assertPacingPrerequisites(c){
 if(!installedOperator(c)||pacingFingerprint(c)!==pacingFingerprint(pacingBefore()))throw Error('Exact reviewed TEST thread prerequisites required');
}
export function pacingReleaseSql(){const b=checkedPacing();if(b.manifest.sha256!==SOURCE_SHA256||b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Reviewed pacing framing/checksum differs');return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`);}
export function pacingRehearsalSql(){return pacingReleaseSql().replace('\ncommit;\n',`\nrollback;\nselect '${REHEARSAL_MARKER}' as rehearsal,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`);}
export function expectedPacing(){const e=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/013_slack_pacing.expected.json',import.meta.url)));if(e.sourceSha256!==SOURCE_SHA256||e.functions?.length!==3||e.tables?.length!==1)throw Error('Pacing expected definitions differ');return e;}
function withoutPacing(after){
 const c=structuredClone(after),prior=pacingBefore();
 c.pacingFunctions=prior.pacingFunctions;
 for(const key of ['threadFunctions','workerFunctions'])c[key]=c[key].filter(f=>!PACING_FUNCTIONS.includes(f.name)).concat(prior[key].filter(f=>PACING_FUNCTIONS.includes(f.name))).sort((a,b)=>a.name.localeCompare(b.name));
 c.tables=c.tables.filter(t=>t.name!=='slack_workspace_pacing');
 c.base.inventory.tables=c.base.inventory.tables.filter(t=>!(t.schema==='public'&&t.name==='slack_workspace_pacing'));
 c.base.inventory.functions=c.base.inventory.functions.filter(f=>!PACING_FUNCTIONS.includes(f.name)).concat(prior.base.inventory.functions.filter(f=>PACING_FUNCTIONS.includes(f.name))).sort((a,b)=>a.name.localeCompare(b.name));
 c.readiness.customMigrationEntries=c.readiness.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.base.report.customMigrationEntries=c.base.report.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.readinessCatalogSha256=catalogFingerprint(c.base);
 return c;
}
export function installedPacing(c){
 const e=expectedPacing(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==14||!entries.some(r=>r.migration_name===NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT)
  ||digest(c.pacingFunctions)!==digest(e.functions)||digest(c.tables.filter(t=>t.name==='slack_workspace_pacing'))!==digest(e.tables))return false;
 const prior=withoutPacing(c);
 return installedOperator(prior)&&pacingFingerprint(prior)===pacingFingerprint(pacingBefore());
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
export async function rehearsePacing({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher},before=await readPacingCatalog(args);assertPacingPrerequisites(before);
 const r=await writeOnce(pacingRehearsalSql(),token,fetcher),acknowledged=r.data?.length===1&&r.data[0].rehearsal===REHEARSAL_MARKER&&r.data[0].receipt_absent===true;
 let after=null;try{after=await readPacingCatalog(args);}catch{}
 const beforeHash=pacingFingerprint(before),afterHash=after?pacingFingerprint(after):null,catalogUnchanged=beforeHash===afterHash;
 return {version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&catalogUnchanged?'rehearsed_and_rolled_back':'requires_inspection',observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,catalogUnchanged,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash};
}
export async function applyPacing({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readPacingCatalog(args);
 if(installedPacing(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed_needs_user_verification',writeAttempted:false,observedAfter:before.observedAt};
 assertPacingPrerequisites(before);
 const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
 if(rehearsal?.version!==REHEARSAL_MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==pacingFingerprint(before))throw Error('Fresh matching pacing rehearsal required');
 const r=await writeOnce(pacingReleaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations where migration_name='${NAME}';`,token,fetcher);
 const acknowledged=r.data?.length===1&&r.data[0].release===MARKER&&r.data[0].source_sha256===SOURCE_SHA256;
 let after=null;try{after=await readPacingCatalog(args);}catch{}
 const installed=after?installedPacing(after):false,preserved=after?pacingFingerprint(withoutPacing(after))===pacingFingerprint(before):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&installed&&preserved?'installed_needs_user_verification':'release_requires_inspection',writeAttempted:true,observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,beforeCatalogSha256:pacingFingerprint(before),afterCatalogSha256:after?pacingFingerprint(after):null,limitations:['TEST shared workspace gate and three queue functions only. No credentials, source rows, schedules, provider requests or production changes.','Hosted concurrency/worker acceptance is still required. An uncertain write is never automatically retried.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2);if(process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT||a[1]!=='--existing-cli-login')throw Error('Explicit TEST target and saved login required');
 let result;
 if(a.length===2&&a[0]==='--rehearse')result=await rehearsePacing({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
 else if(a.length===4&&a[0]==='--apply'&&a[2]==='--rehearsal-report')result=await applyPacing({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:JSON.parse(readFileSync(a[3]))});
 else throw Error('Explicit rehearsal or install with rehearsal report required');
 console.log(JSON.stringify(result,null,2));if(!['rehearsed_and_rolled_back','installed_needs_user_verification','already_installed_needs_user_verification'].includes(result.state))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
