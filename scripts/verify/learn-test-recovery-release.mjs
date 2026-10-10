/** Exact TEST rehearsal/install. An uncertain write is inspected, never retried. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {checkedRecovery,RECOVERY_RELEASE_NAME as NAME} from './learn-slack-recovery-bundle.mjs';
import {readRecoveryCatalog,RECOVERY_FUNCTIONS} from './learn-slack-recovery-catalog.mjs';
import {installedPacing,pacingFingerprint} from './learn-test-pacing-release.mjs';
import {pacingInstalledBaseline} from './learn-slack-pacing-baseline.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='0e33e36138c1e8988d13b90b32295ace2d2f3480d6fec83b2deaae919f421efc';
export const REHEARSAL_MARKER='learn-test-recovery-rehearsal/1',MARKER='learn-test-recovery-release/1';
export const recoveryBefore=()=>({...pacingInstalledBaseline(),recoveryFunctions:[]});
export const recoveryFingerprint=c=>digest({prior:pacingFingerprint(c),functions:c.recoveryFunctions});
export function assertRecoveryPrerequisites(c){
 if(!installedPacing(c)||recoveryFingerprint(c)!==recoveryFingerprint(recoveryBefore()))throw Error('Exact reviewed TEST pacing prerequisites required');
}
export function recoveryReleaseSql(){const b=checkedRecovery();if(b.manifest.sha256!==SOURCE_SHA256||b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Reviewed recovery framing/checksum differs');return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`);}
export function recoveryRehearsalSql(){return recoveryReleaseSql().replace('\ncommit;\n',`\nrollback;\nselect '${REHEARSAL_MARKER}' as rehearsal,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`);}
export function expectedRecovery(){const e=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/014_slack_recovery.expected.json',import.meta.url)));if(e.sourceSha256!==SOURCE_SHA256||e.functions?.length!==3||e.tables?.length!==0)throw Error('Recovery expected definitions differ');return e;}
function withoutRecovery(after){
 const c=structuredClone(after),prior=recoveryBefore();
 c.recoveryFunctions=prior.recoveryFunctions;
 c.base.inventory.functions=c.base.inventory.functions.filter(f=>!RECOVERY_FUNCTIONS.includes(f.name)).concat(prior.base.inventory.functions.filter(f=>RECOVERY_FUNCTIONS.includes(f.name))).sort((a,b)=>a.name.localeCompare(b.name));
 c.readiness.customMigrationEntries=c.readiness.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.base.report.customMigrationEntries=c.base.report.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.readinessCatalogSha256=catalogFingerprint(c.base);
 return c;
}
export function installedRecovery(c){
 const e=expectedRecovery(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==15||!entries.some(r=>r.migration_name===NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT)
  ||digest(c.recoveryFunctions)!==digest(e.functions))return false;
 const prior=withoutRecovery(c);
 return installedPacing(prior)&&recoveryFingerprint(prior)===recoveryFingerprint(recoveryBefore());
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
export async function rehearseRecovery({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher},before=await readRecoveryCatalog(args);assertRecoveryPrerequisites(before);
 const r=await writeOnce(recoveryRehearsalSql(),token,fetcher),acknowledged=r.data?.length===1&&r.data[0].rehearsal===REHEARSAL_MARKER&&r.data[0].receipt_absent===true;
 let after=null;try{after=await readRecoveryCatalog(args);}catch{}
 const beforeHash=recoveryFingerprint(before),afterHash=after?recoveryFingerprint(after):null,catalogUnchanged=beforeHash===afterHash;
 return {version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&catalogUnchanged?'rehearsed_and_rolled_back':'requires_inspection',observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,catalogUnchanged,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash};
}
export async function applyRecovery({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readRecoveryCatalog(args);
 if(installedRecovery(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed_needs_user_verification',writeAttempted:false,observedAfter:before.observedAt};
 assertRecoveryPrerequisites(before);
 const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
 if(rehearsal?.version!==REHEARSAL_MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==recoveryFingerprint(before))throw Error('Fresh matching recovery rehearsal required');
 const r=await writeOnce(recoveryReleaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations where migration_name='${NAME}';`,token,fetcher);
 const acknowledged=r.data?.length===1&&r.data[0].release===MARKER&&r.data[0].source_sha256===SOURCE_SHA256;
 let after=null;try{after=await readRecoveryCatalog(args);}catch{}
 const installed=after?installedRecovery(after):false,preserved=after?recoveryFingerprint(withoutRecovery(after))===recoveryFingerprint(before):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&installed&&preserved?'installed_needs_user_verification':'release_requires_inspection',writeAttempted:true,observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,beforeCatalogSha256:recoveryFingerprint(before),afterCatalogSha256:after?recoveryFingerprint(after):null,limitations:['TEST three new recovery functions only. No credentials, source rows, schedules, provider requests or production changes.','Hosted authenticated recovery/browser acceptance is still required. An uncertain write is never automatically retried.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2);if(process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT||a[1]!=='--existing-cli-login')throw Error('Explicit TEST target and saved login required');
 let result;
 if(a.length===2&&a[0]==='--rehearse')result=await rehearseRecovery({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
 else if(a.length===4&&a[0]==='--apply'&&a[2]==='--rehearsal-report')result=await applyRecovery({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:JSON.parse(readFileSync(a[3]))});
 else throw Error('Explicit rehearsal or install with rehearsal report required');
 console.log(JSON.stringify(result,null,2));if(!['rehearsed_and_rolled_back','installed_needs_user_verification','already_installed_needs_user_verification'].includes(result.state))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
