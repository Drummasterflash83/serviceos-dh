/** Install the exact rehearsed TEST foundation once; inspect uncertain outcomes. */
import { HELPER_RELEASE_NAME,HELPER_SOURCE_SHA256 } from './learn-foundation-helper-contract.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkedFoundation,RELEASE_NAME } from './learn-foundation-bundle.mjs';
import { readFoundationCatalog } from './learn-foundation-catalog.mjs';
import { catalogFingerprint } from './learn-test-launch-rehearsal.mjs';
import { assertFoundationPrerequisites,foundationFingerprint,foundationReleaseSql,SOURCE_SHA256,MARKER as REHEARSAL_MARKER } from './learn-test-foundation-rehearsal.mjs';
import { TEST_PROJECT,savedCliToken } from './learn-test-readiness.mjs';
export const MARKER='learn-test-foundation-release/1';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function expectedFoundation(){
 const e=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/002_card_work_foundations.expected.json',import.meta.url)));
 const b=checkedFoundation();
 if(e.sourceSha256!==SOURCE_SHA256||b.manifest.sha256!==SOURCE_SHA256||e.tables?.length!==33
  ||e.tables.some(t=>!b.manifest.tables.includes(t.name)))throw Error('Expected foundation schema differs from reviewed source');
 return e;
}
export function installedFoundation(c){
 const e=expectedFoundation(),names=new Set(e.tables.map(t=>t.name));
 const entries=c.readiness?.customMigrationEntries;
 return Array.isArray(entries)&&[3,4].includes(entries.length)
  &&(entries.length===3||entries.some(r=>r.migration_name===HELPER_RELEASE_NAME&&r.source_sha256===HELPER_SOURCE_SHA256&&r.project_ref===TEST_PROJECT))
  &&entries.some(r=>r.migration_name==='openfolk_test_learn_bootstrap_v5'&&r.source_sha256==='821515d9b8034b74826e1a81837c64d1b02804402da223715404d84b307a34d6'&&r.project_ref===TEST_PROJECT)
  &&entries.some(r=>r.migration_name==='learn_launch_metadata_views_v1'&&r.source_sha256==='5bbff33c4ece496cd6220a9beb1fc0d70cb31e205f2deaa4a10026e4a3e219aa'&&r.project_ref===TEST_PROJECT)
  &&entries.some(r=>r.migration_name===RELEASE_NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT)
  &&c.readiness.launchMetadata?.state==='needs_semantic_and_user_verification'
  &&digest({tables:c.tables.filter(t=>names.has(t.name)),guard:c.foundationGuard})===digest({tables:e.tables,guard:e.guard});
}
export function preservedFoundationSources(before,after){
 if(!after.base)return false;
 const names=new Set(checkedFoundation().manifest.tables),copy=structuredClone(after),base=copy.base;
 copy.tables=copy.tables.filter(t=>!names.has(t.name));
 base.inventory.tables=base.inventory.tables.filter(t=>t.schema!=='public'||!names.has(t.name));
 base.inventory.functions=base.inventory.functions.filter(f=>f.name!=='learn_foundation_reference_guard');
 base.report.customMigrationEntries=base.report.customMigrationEntries.filter(e=>e.migration_name!==RELEASE_NAME);
 copy.readinessCatalogSha256=catalogFingerprint(base);
 return foundationFingerprint(copy)===foundationFingerprint(before);
}
export async function applyFoundation({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher,includeBase:true};
 const before=await readFoundationCatalog(args);
 if(installedFoundation(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed_needs_user_verification',writeAttempted:false,observedAfter:before.observedAt};
 assertFoundationPrerequisites(before);
 const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
 if(rehearsal?.version!==REHEARSAL_MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256
  ||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged
  ||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000
  ||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==foundationFingerprint(before))throw Error('Fresh matching foundation rehearsal required');
 const query=foundationReleaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations where migration_name='${RELEASE_NAME}' and project_ref='${TEST_PROJECT}';\n`;
 let acknowledged=false,httpStatus=null,databaseCode=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;
  for await(const chunk of r.body){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!r.ok)databaseCode=/^[0-9A-Z]{5}$/.test(b?.code??'')?b.code:/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof b?.message==='string'?b.message:'')?.[1]??null;
  else acknowledged=Array.isArray(b)&&b.length===1&&b[0].release===MARKER&&b[0].source_sha256===SOURCE_SHA256;
 }catch{/* Never retry a possibly committed transaction. */}
 let after=null;try{after=await readFoundationCatalog(args);}catch{}
 const installed=after?installedFoundation(after):false,preserved=after?preservedFoundationSources(before,after):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,writeAttempted:true,
  observedBefore:before.observedAt,observedAfter:after?.observedAt??null,
  state:acknowledged&&installed&&preserved?'installed_needs_user_verification':'release_requires_inspection',acknowledged,httpStatus,databaseCode,
  installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,
  beforeCatalogSha256:foundationFingerprint(before),afterCatalogSha256:after?foundationFingerprint(after):null,
  limitations:['TEST foundations only; no production, provider actions, imports, baselines or customer rows changed.',
   'Catalog compatibility does not prove real JWT access or full LEARN acceptance.',
   'Unknown outcomes require inspection; no automatic retry or rollback occurs.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const a=process.argv.slice(2);
  if(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST release, login and rehearsal report required');
  const r=await applyFoundation({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:JSON.parse(readFileSync(a[3],'utf8'))});
  console.log(JSON.stringify(r,null,2));if(!['installed_needs_user_verification','already_installed_needs_user_verification'].includes(r.state))process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
