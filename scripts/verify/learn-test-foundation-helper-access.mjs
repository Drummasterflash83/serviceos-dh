/** Fixed two-function TEST permission repair, with a required rollback rehearsal. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { HELPER_RELEASE_NAME as NAME,HELPER_SOURCE_SHA256 as SHA } from './learn-foundation-helper-contract.mjs';
import { readFoundationCatalog } from './learn-foundation-catalog.mjs';
import { installedFoundation } from './learn-test-foundation-release.mjs';
import { foundationFingerprint } from './learn-test-foundation-rehearsal.mjs';
import { catalogFingerprint } from './learn-test-launch-rehearsal.mjs';
import { TEST_PROJECT,savedCliToken } from './learn-test-readiness.mjs';
const MARKER='learn-test-foundation-helper-access/1',names=['current_tenant_id','is_openfolk'];
export function helperSql(rehearse){
 const s=readFileSync(new URL('../../supabase/release/learn-test/003_foundation_helper_access.sql',import.meta.url),'utf8');
 if(createHash('sha256').update(s).digest('hex')!==SHA)throw Error('Reviewed helper release differs');
 let q=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SHA}';\n`);
 if(rehearse)q=q.replace('\ncommit;\n','\nrollback;\n');
 return q+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}' and source_sha256='${SHA}') as receipt_expected;`;
}
export function helperChangePreserved(before,after,rehearse){
 const copy=structuredClone(after);
 if(!rehearse){
  for(const f of copy.base.inventory.functions)if(names.includes(f.name))f.authenticatedExecute=before.base.inventory.functions.find(v=>v.name===f.name)?.authenticatedExecute;
  copy.base.report.customMigrationEntries=copy.base.report.customMigrationEntries.filter(e=>e.migration_name!==NAME);
  copy.readinessCatalogSha256=catalogFingerprint(copy.base);
 }
 return foundationFingerprint(before)===foundationFingerprint(copy);
}
export async function helperAccess({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher,includeBase:true},before=await readFoundationCatalog(args);
 if(!installedFoundation(before))throw Error('Verified installed foundation required');
 const installed=before.readiness.customMigrationEntries.some(e=>e.migration_name===NAME&&e.source_sha256===SHA);
 const helpers=before.base.inventory.functions.filter(f=>names.includes(f.name));
 if(installed&&helpers.length===2&&helpers.every(f=>f.authenticatedExecute&&!f.anonExecute))return {version:MARKER,state:'already_installed',writeAttempted:false,projectRef:TEST_PROJECT,sourceSha256:SHA};
 if(installed||helpers.length!==2||helpers.some(f=>f.authenticatedExecute||f.anonExecute))throw Error('Unexpected helper privilege state');
 if(!rehearse){
  const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
  if(rehearsal?.version!==MARKER||rehearsal.sourceSha256!==SHA||rehearsal.projectRef!==TEST_PROJECT||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.preserved||!Number.isFinite(at)||at>now||now-at>3600000||rehearsal.afterCatalogSha256!==foundationFingerprint(before))throw Error('Fresh matching helper rehearsal required');
 }
 let acknowledged=false,httpStatus=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:helperSql(rehearse),read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;for await(const c of r.body){bytes+=c.byteLength;if(bytes>1048576)throw Error();chunks.push(c);}
  const b=JSON.parse(Buffer.concat(chunks).toString());acknowledged=r.ok&&b?.length===1&&b[0].marker===MARKER&&b[0].receipt_expected===true;
 }catch{/* Unknown outcomes require inspection, never retries. */}
 let after=null;try{after=await readFoundationCatalog(args);}catch{}
 const preserved=after?helperChangePreserved(before,after,rehearse):false;
 const correct=after&&installedFoundation(after)&&names.every(n=>after.base.inventory.functions.some(f=>f.name===n&&f.authenticatedExecute===!rehearse&&!f.anonExecute))
  &&after.readiness.customMigrationEntries.some(e=>e.migration_name===NAME&&e.source_sha256===SHA)===!rehearse;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SHA,writeAttempted:true,observedAfter:after?.observedAt??null,
  state:acknowledged&&preserved&&correct?(rehearse?'rehearsed_and_rolled_back':'installed_needs_user_verification'):'requires_inspection',
  acknowledged,httpStatus,preserved,afterCatalogSha256:after?foundationFingerprint(after):null};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
  if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST helper operation required');
  const r=await helperAccess({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3],'utf8'))});
  console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
