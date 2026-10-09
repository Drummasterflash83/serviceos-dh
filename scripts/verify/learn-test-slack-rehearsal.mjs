/** Exact TEST Slack storage/setup rollback rehearsal; no provider operations. */
import {pathToFileURL} from 'node:url';
import {checkedSlack,SLACK_RELEASE_NAME as NAME} from './learn-slack-bundle.mjs';
import {readSlackCatalog} from './learn-slack-catalog.mjs';
import {installedActions} from './learn-test-actions-release.mjs';
import {actionsFingerprint} from './learn-test-actions-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='d4b762ace7c9ccecba29890649e40d7e1501aa5f6e1c2b711970fb55368d305e';
export const MARKER='learn-test-slack-rehearsal/1';
export const slackFingerprint=c=>digest({prior:actionsFingerprint(c),functions:c.slackFunctions});
export function assertSlackPrerequisites(c){
 if(!installedActions(c))throw Error('Exact installed TEST actions prerequisite required');
 const b=checkedSlack();
 if(c.tables.some(t=>b.manifest.tables.includes(t.name))||c.slackFunctions.length)throw Error('Slack objects already exist');
}
export function slackReleaseSql(){const b=checkedSlack();if(b.manifest.sha256!==SOURCE_SHA256)throw Error('Reviewed Slack checksum differs');if(b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Unexpected Slack framing');return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`);}
export function slackRehearsalSql(){return slackReleaseSql().replace('\ncommit;\n',`\nrollback;\nselect '${MARKER}' as rehearsal,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`);}
export async function rehearseSlack({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher},before=await readSlackCatalog(args);assertSlackPrerequisites(before);
 let acknowledged=false,httpStatus=null,databaseCode=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:slackRehearsalSql(),read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const data=JSON.parse(Buffer.concat(chunks).toString());
  if(!r.ok)databaseCode=/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof data?.message==='string'?data.message:'')?.[1]??null;
  else acknowledged=Array.isArray(data)&&data.length===1&&data[0].rehearsal===MARKER&&data[0].receipt_absent===true;
 }catch{/* No replay of an uncertain operation. */}
 let after=null;try{after=await readSlackCatalog(args);}catch{}
 const beforeHash=slackFingerprint(before),afterHash=after?slackFingerprint(after):null,unchanged=beforeHash===afterHash;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&unchanged?'rehearsed_and_rolled_back':'requires_inspection',observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus,databaseCode,catalogUnchanged:unchanged,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash,
 limitations:['TEST rollback rehearsal only. No installation, source rows, approvals, credentials or provider operations.', 'Catalog and isolated SQL tests do not replace real signed-in user acceptance.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--rehearse --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST rehearsal and existing login required');const r=await rehearseSlack({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='rehearsed_and_rolled_back')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
