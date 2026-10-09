/** Exact TEST rehearsal/install. An uncertain write is inspected, never retried. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {checkedOperator,OPERATOR_RELEASE_NAME as NAME} from './learn-slack-operator-bundle.mjs';
import {readOperatorCatalog,OPERATOR_FUNCTIONS} from './learn-slack-operator-catalog.mjs';
import {installedThreads,threadsFingerprint} from './learn-test-threads-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='e37839d9be63ff9ee9db8b0ada2c25c676546cb108a3882c57d1ec58aa8300b1';
export const REHEARSAL_MARKER='learn-test-operator-rehearsal/1',MARKER='learn-test-operator-release/1';
export const operatorBefore=()=>{const c=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-operator-before-schema-2026-10-10.json',import.meta.url)));return c;};
export const operatorFingerprint=c=>digest({prior:threadsFingerprint(c),functions:c.operatorFunctions});
export function assertOperatorPrerequisites(c){
 if(!installedThreads(c)||operatorFingerprint(c)!==operatorFingerprint(operatorBefore()))throw Error('Exact reviewed TEST thread prerequisites required');
}
export function operatorReleaseSql(){const b=checkedOperator();if(b.manifest.sha256!==SOURCE_SHA256||b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Reviewed operator framing/checksum differs');return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`);}
export function operatorRehearsalSql(){return operatorReleaseSql().replace('\ncommit;\n',`\nrollback;\nselect '${REHEARSAL_MARKER}' as rehearsal,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`);}
export function expectedOperator(){const e=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/012_slack_operator.expected.json',import.meta.url)));if(e.sourceSha256!==SOURCE_SHA256||e.functions?.length!==2||e.tables?.length!==0)throw Error('Operator expected definitions differ');return e;}
function withoutOperator(after){
 const c=structuredClone(after),prior=operatorBefore();
 c.operatorFunctions=prior.operatorFunctions;
 c.base.inventory.functions=c.base.inventory.functions.filter(f=>!OPERATOR_FUNCTIONS.includes(f.name)).concat(prior.base.inventory.functions.filter(f=>OPERATOR_FUNCTIONS.includes(f.name))).sort((a,b)=>a.name.localeCompare(b.name));
 c.readiness.customMigrationEntries=c.readiness.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.base.report.customMigrationEntries=c.base.report.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 c.readinessCatalogSha256=catalogFingerprint(c.base);
 return c;
}
export function installedOperator(c){
 const e=expectedOperator(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==13||!entries.some(r=>r.migration_name===NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT)
  ||digest(c.operatorFunctions)!==digest(e.functions))return false;
 const prior=withoutOperator(c);
 return installedThreads(prior)&&operatorFingerprint(prior)===operatorFingerprint(operatorBefore());
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
export async function rehearseOperator({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher},before=await readOperatorCatalog(args);assertOperatorPrerequisites(before);
 const r=await writeOnce(operatorRehearsalSql(),token,fetcher),acknowledged=r.data?.length===1&&r.data[0].rehearsal===REHEARSAL_MARKER&&r.data[0].receipt_absent===true;
 let after=null;try{after=await readOperatorCatalog(args);}catch{}
 const beforeHash=operatorFingerprint(before),afterHash=after?operatorFingerprint(after):null,catalogUnchanged=beforeHash===afterHash;
 return {version:REHEARSAL_MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&catalogUnchanged?'rehearsed_and_rolled_back':'requires_inspection',observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,catalogUnchanged,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash};
}
export async function applyOperator({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readOperatorCatalog(args);
 if(installedOperator(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed_needs_user_verification',writeAttempted:false,observedAfter:before.observedAt};
 assertOperatorPrerequisites(before);
 const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
 if(rehearsal?.version!==REHEARSAL_MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==operatorFingerprint(before))throw Error('Fresh matching operator rehearsal required');
 const r=await writeOnce(operatorReleaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations where migration_name='${NAME}';`,token,fetcher);
 const acknowledged=r.data?.length===1&&r.data[0].release===MARKER&&r.data[0].source_sha256===SOURCE_SHA256;
 let after=null;try{after=await readOperatorCatalog(args);}catch{}
 const installed=after?installedOperator(after):false,preserved=after?operatorFingerprint(withoutOperator(after))===operatorFingerprint(before):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&installed&&preserved?'installed_needs_user_verification':'release_requires_inspection',writeAttempted:true,observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus:r.httpStatus,databaseCode:r.databaseCode,installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,beforeCatalogSha256:operatorFingerprint(before),afterCatalogSha256:after?operatorFingerprint(after):null,limitations:['TEST two read-only operator functions only. No credentials, source rows, schedules, provider requests or production changes.','Hosted authenticated reader/browser acceptance is still required. An uncertain write is never automatically retried.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2);if(process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT||a[1]!=='--existing-cli-login')throw Error('Explicit TEST target and saved login required');
 let result;
 if(a.length===2&&a[0]==='--rehearse')result=await rehearseOperator({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
 else if(a.length===4&&a[0]==='--apply'&&a[2]==='--rehearsal-report')result=await applyOperator({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:JSON.parse(readFileSync(a[3]))});
 else throw Error('Explicit rehearsal or install with rehearsal report required');
 console.log(JSON.stringify(result,null,2));if(!['rehearsed_and_rolled_back','installed_needs_user_verification','already_installed_needs_user_verification'].includes(result.state))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
