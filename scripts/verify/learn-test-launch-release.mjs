/** Apply only the reviewed TEST metadata release, after a matching fresh hosted
 * rollback rehearsal. Never retries a write or deploys any other migration. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readTestCatalog, savedCliToken, TEST_PROJECT, READ_CONTRACT } from './learn-test-readiness.mjs';
import { releaseSql, SOURCE_SHA256, RELEASE_NAME, catalogFingerprint } from './learn-test-launch-rehearsal.mjs';
const MARKER='learn-test-launch-release/1';
const bootstrap=e=>e?.migration_name==='openfolk_test_learn_bootstrap_v5'
  &&e.project_ref===TEST_PROJECT&&e.source_sha256==='821515d9b8034b74826e1a81837c64d1b02804402da223715404d84b307a34d6';
function receiptMatches(result){
  const entries=result.report.customMigrationEntries;
  return Array.isArray(entries)&&entries.length===2&&entries.some(bootstrap)
    &&entries.some(e=>e.migration_name===RELEASE_NAME&&e.project_ref===TEST_PROJECT&&e.source_sha256===SOURCE_SHA256);
}
function installed(result){return receiptMatches(result)&&result.report.launchMetadata.state==='needs_semantic_and_user_verification';}
/** Ignore only the exact additive reader policies when comparing old tables. */
export function preservedSourceCatalog(before,after){
  const copy=structuredClone(after);
  const expected=new Set(['profiles',...Object.keys(READ_CONTRACT.launch)]);
  for(const t of copy.inventory.tables){
    if(t.schema!=='public'||!expected.has(t.name))continue;
    const name=t.name==='profiles'?'learn_launch_metadata_profile':'learn_launch_metadata_select';
    t.policies=t.policies.filter(p=>!(p.name===name&&p.command==='SELECT'
      &&p.roles?.length===1&&p.roles[0]==='learn_launch_metadata_reader'));
  }
  copy.inventory.launchMetadata=before.inventory.launchMetadata;
  copy.report.customMigrationEntries=copy.report.customMigrationEntries?.filter(e=>e.migration_name!==RELEASE_NAME);
  return catalogFingerprint(copy)===catalogFingerprint(before);
}
export async function applyLaunchRelease({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
  const before=await readTestCatalog({allowProjectRef,token,fetcher});
  if(installed(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,
    state:'already_installed_needs_user_verification',observedAfter:before.inventory.observedAt,writeAttempted:false};
  const m=before.report.launchMetadata,entries=before.report.customMigrationEntries;
  if(m.state!=='blocked'||!m.roleIssues.includes('missing_reader_role')||m.unexpectedRelations.length
    ||!m.views.every(v=>v.issues.includes('missing_view'))||!Array.isArray(entries)||entries.length!==1||!bootstrap(entries[0]))
    throw Error('TEST installation or ledger state differs; inspect before applying');
  const now=clock(),at=Date.parse(rehearsal?.observedAfter??'');
  if(rehearsal?.version!=='learn-test-launch-rehearsal/1'||rehearsal.projectRef!==TEST_PROJECT
    ||rehearsal.sourceSha256!==SOURCE_SHA256||rehearsal.state!=='rehearsed_and_rolled_back'
    ||rehearsal.acknowledged!==true||rehearsal.catalogUnchanged!==true
    ||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000
    ||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256
    ||rehearsal.afterCatalogSha256!==catalogFingerprint(before))
    throw Error('Fresh matching hosted rollback rehearsal required');
  const query=releaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations
 where migration_name='${RELEASE_NAME}' and project_ref='${TEST_PROJECT}';\n`;
  let acknowledged=false,httpStatus=null,databaseCode=null;
  try{
    const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query,read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000),
    });
    httpStatus=response.status;
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!response.ok)databaseCode=/^[0-9A-Z]{5}$/.test(body?.code??'')?body.code
      :/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof body?.message==='string'?body.message:'')?.[1]??null;
    else acknowledged=Array.isArray(body)&&body.length===1&&body[0].release===MARKER&&body[0].source_sha256===SOURCE_SHA256;
  }catch{/* Inspect unknown outcomes, never retry the write. */}
  let after=null;
  try{after=await readTestCatalog({allowProjectRef,token,fetcher});}catch{/* Keep post-state unverified. */}
  const observedInstalled=after?installed(after):false;
  const preserved=after?preservedSourceCatalog(before,after):false;
  return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,writeAttempted:true,
    observedBefore:before.inventory.observedAt,observedAfter:after?.inventory.observedAt??null,
    state:acknowledged&&observedInstalled&&preserved?'installed_needs_user_verification':'release_requires_inspection',
    acknowledged,httpStatus,databaseCode,receiptAndViewsMatch:observedInstalled,existingSourceCatalogPreserved:preserved,
    beforeCatalogSha256:catalogFingerprint(before),afterCatalogSha256:after?catalogFingerprint(after):null,
    limitations:['This installs only TEST metadata access and its receipt; no production, source records, functions or providers are changed.',
      'Catalog checks do not prove JWT/PostgREST access, redaction semantics or full LEARN acceptance.',
      'Unknown or mismatched outcomes require inspection; no write retry or automatic rollback is attempted.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const args=process.argv.slice(2);
    if(args.length!==4||args[0]!=='--apply'||args[1]!=='--existing-cli-login'||args[2]!=='--rehearsal-report'
      ||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST release, login and rehearsal report required');
    const report=await applyLaunchRelease({allowProjectRef:TEST_PROJECT,token:savedCliToken(),
      rehearsal:JSON.parse(readFileSync(args[3],'utf8'))});
    console.log(JSON.stringify(report,null,2));
    if(!['installed_needs_user_verification','already_installed_needs_user_verification'].includes(report.state))process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
