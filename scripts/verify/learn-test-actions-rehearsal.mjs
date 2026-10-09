/** Exact TEST action rollback rehearsal; refuses changed registries and prior schema. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {checkedActions,ACTIONS_RELEASE_NAME as NAME} from './learn-actions-bundle.mjs';
import {readActionsCatalog} from './learn-actions-catalog.mjs';
import {installedWork} from './learn-test-work-release.mjs';
import {workFingerprint} from './learn-test-work-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='0ec08e5aa0f17132c03a95bcbbcb3225cc7b03dd181362a8dd7b1c2688aed68e';
export const MARKER='learn-test-actions-rehearsal/1';
export const actionsFingerprint=c=>digest({prior:workFingerprint(c),functions:c.actionFunctions,registries:c.actionRegistries,classes:c.actionClasses});
export function assertActionsPrerequisites(c){
 if(!installedWork(c))throw Error('Exact installed TEST work capture release required');
 const previous=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-work-installed-schema-2026-10-09.json',import.meta.url)));
 const relevant=t=>['intelligence_objects','domain_object_types'].includes(t.name);
 if(digest(c.tables.filter(relevant))!==digest(previous.tables.filter(relevant)))throw Error('Pre-action source definitions differ');
 const baseline=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-action-registries-before-2026-10-09.json',import.meta.url))).registries;
 if(digest(c.actionRegistries)!==digest(baseline))throw Error('Action registries changed since review');
 const b=checkedActions();
 if(c.tables.some(t=>b.manifest.tables.includes(t.name))||c.actionFunctions.length||c.actionClasses.length||c.base.inventory.functions.some(f=>b.manifest.functions.includes(f.name)))throw Error('Action objects already exist');
}
export function actionsReleaseSql(){const b=checkedActions();if(b.manifest.sha256!==SOURCE_SHA256)throw Error('Reviewed action checksum differs');if(b.sql.split('\nbegin;\n').length!==2||b.sql.split('\ncommit;\n').length!==2)throw Error('Unexpected action framing');return b.sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`);}
export function actionsRehearsalSql(){return actionsReleaseSql().replace('\ncommit;\n',`\nrollback;\nselect '${MARKER}' as rehearsal,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`);}
export async function rehearseActions({allowProjectRef,token,fetcher=fetch}){
 const args={allowProjectRef,token,fetcher},before=await readActionsCatalog(args);assertActionsPrerequisites(before);
 let acknowledged=false,httpStatus=null,databaseCode=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:actionsRehearsalSql(),read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;for await(const chunk of r.body??[]){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const data=JSON.parse(Buffer.concat(chunks).toString());
  if(!r.ok)databaseCode=/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof data?.message==='string'?data.message:'')?.[1]??null;
  else acknowledged=Array.isArray(data)&&data.length===1&&data[0].rehearsal===MARKER&&data[0].receipt_absent===true;
 }catch{/* No replay of an uncertain operation. */}
 let after=null;try{after=await readActionsCatalog(args);}catch{}
 const beforeHash=actionsFingerprint(before),afterHash=after?actionsFingerprint(after):null,unchanged=beforeHash===afterHash;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:acknowledged&&unchanged?'rehearsed_and_rolled_back':'requires_inspection',observedBefore:before.observedAt,observedAfter:after?.observedAt??null,acknowledged,httpStatus,databaseCode,catalogUnchanged:unchanged,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash,
 limitations:['TEST rollback rehearsal only. No installation, source rows, membership baselines or provider operations.', 'Catalog and isolated SQL tests do not replace real signed-in user acceptance.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--rehearse --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST rehearsal and existing login required');const r=await rehearseActions({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='rehearsed_and_rolled_back')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
