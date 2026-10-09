/** Install the exact rehearsed TEST actions once; inspect uncertain outcomes. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkedActions,ACTIONS_RELEASE_NAME as RELEASE_NAME } from './learn-actions-bundle.mjs';
import { readActionsCatalog } from './learn-actions-catalog.mjs';
import { digest } from './learn-test-foundation-release.mjs';
import { catalogFingerprint } from './learn-test-launch-rehearsal.mjs';
import { assertActionsPrerequisites,actionsFingerprint,actionsReleaseSql,SOURCE_SHA256,MARKER as REHEARSAL_MARKER } from './learn-test-actions-rehearsal.mjs';
import { installedWork } from './learn-test-work-release.mjs';
import { TEST_PROJECT,savedCliToken } from './learn-test-readiness.mjs';
export const MARKER='learn-test-actions-release/1';
const priorLedger=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-work-installed-schema-2026-10-09.json',import.meta.url))).readiness.customMigrationEntries;
export function expectedActions(){
 const e=JSON.parse(readFileSync(new URL('../../supabase/release/learn-test/008_governed_work_actions.expected.json',import.meta.url)));
 const b=checkedActions();
 if(e.sourceSha256!==SOURCE_SHA256||b.manifest.sha256!==SOURCE_SHA256||e.tables?.length!==13||e.functions?.length!==5||e.classes?.length!==6)throw Error('Expected actions schema differs from reviewed release');
 return e;
}
export function installedActions(c){
 const e=expectedActions(),names=new Set(e.tables.map(t=>t.name)),entries=c.readiness?.customMigrationEntries;
 return Array.isArray(entries)&&entries.length===9&&installedWork(withoutActionsRelease(c))
  &&priorLedger.every(p=>entries.some(r=>r.migration_name===p.migration_name&&r.source_sha256===p.source_sha256&&r.project_ref===TEST_PROJECT))
  &&entries.some(r=>r.migration_name===RELEASE_NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT)
  &&c.readiness.launchMetadata?.state==='needs_semantic_and_user_verification'
  &&c.base.inventory.functions.some(f=>f.name==='current_user_role'&&f.authenticatedExecute===true&&f.anonExecute===false)
  &&digest({tables:c.tables.filter(t=>names.has(t.name)),functions:c.actionFunctions,registries:c.actionRegistries,classes:c.actionClasses})===digest({tables:e.tables,functions:e.functions,registries:e.registries,classes:e.classes});
}
const priorCatalog=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-work-installed-schema-2026-10-09.json',import.meta.url)));
function withoutActionsRelease(after){
 const b=checkedActions(),copy=structuredClone(after),base=copy.base;
 copy.tables=copy.tables.filter(t=>!b.manifest.tables.includes(t.name));
 for(const name of b.manifest.affectedTables.filter(n=>!b.manifest.tables.includes(n))){
  copy.tables=copy.tables.map(t=>t.name===name?structuredClone(priorCatalog.tables.find(v=>v.name===name)):t);
  base.inventory.tables=base.inventory.tables.map(t=>t.schema==='public'&&t.name===name?structuredClone(priorCatalog.base.inventory.tables.find(v=>v.schema==='public'&&v.name===name)):t);
 }
 base.inventory.tables=base.inventory.tables.filter(t=>t.schema!=='public'||!b.manifest.tables.includes(t.name));
 base.inventory.functions=base.inventory.functions.filter(f=>!b.manifest.functions.includes(f.name));
 base.report.customMigrationEntries=base.report.customMigrationEntries.filter(e=>e.migration_name!==RELEASE_NAME);
 copy.readiness.customMigrationEntries=copy.readiness.customMigrationEntries.filter(e=>e.migration_name!==RELEASE_NAME);
 copy.actionFunctions=[];copy.actionClasses=[];copy.actionRegistries=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-action-registries-before-2026-10-09.json',import.meta.url))).registries;
 copy.readinessCatalogSha256=catalogFingerprint(base);
 return copy;
}
export function preservedActionsSources(before,after){
 const e=expectedActions(),names=new Set(e.tables.map(t=>t.name));
 if(!after.base||digest(before.foundationGuard)!==digest(after.foundationGuard)
 ||digest({tables:after.tables.filter(t=>names.has(t.name)),functions:after.actionFunctions,registries:after.actionRegistries,classes:after.actionClasses})!==digest({tables:e.tables,functions:e.functions,registries:e.registries,classes:e.classes}))return false;
 return actionsFingerprint(withoutActionsRelease(after))===actionsFingerprint(before);
}
export async function applyActions({allowProjectRef,token,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher,includeBase:true};
 const before=await readActionsCatalog(args);
 if(installedActions(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed_needs_user_verification',writeAttempted:false,observedAfter:before.observedAt};
 assertActionsPrerequisites(before);
 const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
 if(rehearsal?.version!==REHEARSAL_MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256
  ||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged
  ||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000
  ||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==actionsFingerprint(before))throw Error('Fresh matching actions rehearsal required');
 const query=actionsReleaseSql()+`select '${MARKER}' as release,source_sha256 from of_test_deploy.migrations where migration_name='${RELEASE_NAME}' and project_ref='${TEST_PROJECT}';\n`;
 let acknowledged=false,httpStatus=null,databaseCode=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;
  for await(const chunk of r.body){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!r.ok)databaseCode=/^[0-9A-Z]{5}$/.test(b?.code??'')?b.code:/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof b?.message==='string'?b.message:'')?.[1]??null;
  else acknowledged=Array.isArray(b)&&b.length===1&&b[0].release===MARKER&&b[0].source_sha256===SOURCE_SHA256;
 }catch{/* Never retry a possibly committed transaction. */}
 let after=null;try{after=await readActionsCatalog(args);}catch{}
 const installed=after?installedActions(after):false,preserved=after?preservedActionsSources(before,after):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,writeAttempted:true,
  observedBefore:before.observedAt,observedAfter:after?.observedAt??null,
  state:acknowledged&&installed&&preserved?'installed_needs_user_verification':'release_requires_inspection',acknowledged,httpStatus,databaseCode,
  installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,
  beforeCatalogSha256:actionsFingerprint(before),afterCatalogSha256:after?actionsFingerprint(after):null,
  limitations:['TEST governed actions and authority input guards only; no production, providers, imports, historical baselines or source communication rows changed.',
   'Catalog compatibility does not prove real JWT access or full LEARN acceptance.',
   'Unknown outcomes require inspection; no automatic retry or rollback occurs.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const a=process.argv.slice(2);
  if(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST release, login and rehearsal report required');
  const r=await applyActions({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:JSON.parse(readFileSync(a[3],'utf8'))});
  console.log(JSON.stringify(r,null,2));if(!['installed_needs_user_verification','already_installed_needs_user_verification'].includes(r.state))process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
