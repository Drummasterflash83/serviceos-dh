/** Install the exact rehearsed TEST work once; inspect uncertain outcomes. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkedWork,WORK_RELEASE_NAME as RELEASE_NAME } from './learn-work-bundle.mjs';
import { readWorkCatalog } from './learn-work-catalog.mjs';
import { digest } from './learn-test-foundation-release.mjs';
import { catalogFingerprint } from './learn-test-launch-rehearsal.mjs';
import { assertWorkPrerequisites,workFingerprint,workReleaseSql,SOURCE_SHA256,MARKER as REHEARSAL_MARKER } from './learn-test-work-rehearsal.mjs';
import { installedMeasurements } from './learn-test-measurements-release.mjs';
import { TEST_PROJECT,savedCliToken } from './learn-test-readiness.mjs';
export const MARKER='learn-test-work-release/1';
const priorLedger=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-measurements-installed-schema-2026-10-09.json',import.meta.url))).readiness.customMigrationEntries;
export function expectedWork(){
 const e=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/007_work_capture_collectors.expected.json',import.meta.url)));
 const b=checkedWork();
 if(e.sourceSha256!==SOURCE_SHA256||b.manifest.sha256!==SOURCE_SHA256||e.tables?.length!==3||e.functions?.length!==8||e.sequences?.length!==1)throw Error('Expected work schema differs from reviewed release');
 return e;
}
export function installedWork(c){
 const e=expectedWork(),names=new Set(e.tables.map(t=>t.name)),entries=c.readiness?.customMigrationEntries;
 return Array.isArray(entries)&&entries.length===8&&workWriterMatches(c)&&installedMeasurements(withoutWorkRelease(c))
  &&priorLedger.every(p=>entries.some(r=>r.migration_name===p.migration_name&&r.source_sha256===p.source_sha256&&r.project_ref===TEST_PROJECT))
  &&entries.some(r=>r.migration_name===RELEASE_NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT)
  &&c.readiness.launchMetadata?.state==='needs_semantic_and_user_verification'
  &&c.base.inventory.functions.some(f=>f.name==='current_user_role'&&f.authenticatedExecute===true&&f.anonExecute===false)
  &&digest({tables:c.tables.filter(t=>names.has(t.name)),functions:c.workFunctions,sequences:c.workSequences})===digest({tables:e.tables,functions:e.functions,sequences:e.sequences});
}
const priorCatalog=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-measurements-installed-schema-2026-10-09.json',import.meta.url)));
function workWriterMatches(c){
 const old=priorCatalog.measurementFunctions.find(f=>f.name==='learn_performance_append');
 const wanted={...old,definition:old.definition.replace("'jobs','team_members')","'jobs','team_members','learn_work_measurement_runs')")};
 return digest(c.measurementFunctions.find(f=>f.name===old.name))===digest(wanted);
}
function withoutWorkRelease(after){
 const b=checkedWork(),copy=structuredClone(after),base=copy.base;
 copy.tables=copy.tables.filter(t=>!b.manifest.tables.includes(t.name));
 for(const name of ['intelligence_objects','object_state_history']){
  copy.tables=copy.tables.map(t=>t.name===name?structuredClone(priorCatalog.tables.find(v=>v.name===name)):t);
  base.inventory.tables=base.inventory.tables.map(t=>t.schema==='public'&&t.name===name?structuredClone(priorCatalog.base.inventory.tables.find(v=>v.schema==='public'&&v.name===name)):t);
 }
 const writer=copy.measurementFunctions.find(f=>f.name==='learn_performance_append');
 if(writer)writer.definition=writer.definition.replace("'jobs','team_members','learn_work_measurement_runs')","'jobs','team_members')");
 base.inventory.tables=base.inventory.tables.filter(t=>t.schema!=='public'||!b.manifest.tables.includes(t.name));
 base.inventory.functions=base.inventory.functions.filter(f=>!b.manifest.functions.includes(f.name));
 base.report.customMigrationEntries=base.report.customMigrationEntries.filter(e=>e.migration_name!==RELEASE_NAME);
 copy.readiness.customMigrationEntries=copy.readiness.customMigrationEntries.filter(e=>e.migration_name!==RELEASE_NAME);
 copy.workFunctions=[];copy.workSequences=[];
 copy.readinessCatalogSha256=catalogFingerprint(base);
 return copy;
}
export function preservedWorkSources(before,after){
 const e=expectedWork(),names=new Set(e.tables.map(t=>t.name));
 if(!after.base||!workWriterMatches(after)||digest(before.foundationGuard)!==digest(after.foundationGuard)
 ||digest(after.tables.filter(t=>names.has(t.name)))!==digest(e.tables))return false;
 return workFingerprint(withoutWorkRelease(after))===workFingerprint(before);
}
export async function applyWork({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher,includeBase:true};
 const before=await readWorkCatalog(args);
 if(installedWork(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed_needs_user_verification',writeAttempted:false,observedAfter:before.observedAt};
 assertWorkPrerequisites(before);
 const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
 if(rehearsal?.version!==REHEARSAL_MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256
  ||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged
  ||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000
  ||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==workFingerprint(before))throw Error('Fresh matching work rehearsal required');
 const query=workReleaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations where migration_name='${RELEASE_NAME}' and project_ref='${TEST_PROJECT}';\n`;
 let acknowledged=false,httpStatus=null,databaseCode=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;
  for await(const chunk of r.body){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!r.ok)databaseCode=/^[0-9A-Z]{5}$/.test(b?.code??'')?b.code:/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof b?.message==='string'?b.message:'')?.[1]??null;
  else acknowledged=Array.isArray(b)&&b.length===1&&b[0].release===MARKER&&b[0].source_sha256===SOURCE_SHA256;
 }catch{/* Never retry a possibly committed transaction. */}
 let after=null;try{after=await readWorkCatalog(args);}catch{}
 const installed=after?installedWork(after):false,preserved=after?preservedWorkSources(before,after):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,writeAttempted:true,
  observedBefore:before.observedAt,observedAfter:after?.observedAt??null,
  state:acknowledged&&installed&&preserved?'installed_needs_user_verification':'release_requires_inspection',acknowledged,httpStatus,databaseCode,
  installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,
  beforeCatalogSha256:workFingerprint(before),afterCatalogSha256:after?workFingerprint(after):null,
  limitations:['TEST work capture/collection schema only; no production, providers, imports, historical baselines or source communication rows changed.',
   'Catalog compatibility does not prove real JWT access or full LEARN acceptance.',
   'Unknown outcomes require inspection; no automatic retry or rollback occurs.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const a=process.argv.slice(2);
  if(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST release, login and rehearsal report required');
  const r=await applyWork({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:JSON.parse(readFileSync(a[3],'utf8'))});
  console.log(JSON.stringify(r,null,2));if(!['installed_needs_user_verification','already_installed_needs_user_verification'].includes(r.state))process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
