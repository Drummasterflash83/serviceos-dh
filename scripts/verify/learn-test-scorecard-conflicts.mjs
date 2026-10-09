/** Narrow, checksum-pinned TEST repair. No data statements, retries or provider operations. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {installedRules,expectedRules} from './learn-test-rules-release.mjs';
import {readRulesCatalog} from './learn-rules-catalog.mjs';
import {rulesFingerprint} from './learn-test-rules-rehearsal.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_SHA256='554a7020f1ae8370f730016d10cfdd9a40b5fe08250974165de67f25802d3479';
export const NAME='learn_scorecard_conflict_codes_v1',MARKER='learn-test-scorecard-conflicts/1';
const hash=s=>createHash('sha256').update(s).digest('hex');
const load=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function conflictSql({rehearse=false}={}){
 const sql=load('supabase/release/learn-test/005_scorecard_conflict_codes.sql');
 const m=JSON.parse(load('supabase/release/learn-test/005_scorecard_conflict_codes.manifest.json'));
 if(hash(sql)!==SOURCE_SHA256||m.sha256!==SOURCE_SHA256||hash(load(m.migration))!==m.migrationSha256)throw Error('Reviewed conflict repair differs');
 return sql.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA256}';\n`)
  .replace('\ncommit;\n',rehearse?`\nrollback;\nselect '${MARKER}' as marker,not exists(select 1 from of_test_deploy.migrations where migration_name='${NAME}') as receipt_absent;\n`:`\ncommit;\nselect '${MARKER}' as marker,source_sha256 from of_test_deploy.migrations where migration_name='${NAME}';\n`);
}
function unpatch(c){
 const copy=structuredClone(c),entries=copy.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==6||!entries.some(r=>r.migration_name===NAME&&r.source_sha256===SOURCE_SHA256&&r.project_ref===TEST_PROJECT))return null;
 copy.readiness.customMigrationEntries=entries.filter(r=>r.migration_name!==NAME);
 copy.base.report.customMigrationEntries=copy.base.report.customMigrationEntries.filter(r=>r.migration_name!==NAME);
 for(const name of ['learn_scorecard_save_draft','learn_scorecard_publish']){
  const old=expectedRules().functions.find(f=>f.name===name),current=copy.rulesFunctions.find(f=>f.name===name);
  if(!current||digest(current)!==digest({...old,definition:old.definition.replaceAll("errcode='40001'","errcode='PT409'")}))return null;
  current.definition=old.definition;
 }
 copy.readinessCatalogSha256=catalogFingerprint(copy.base);
 return copy;
}
export function installedConflictRepair(c){const original=unpatch(c);return !!original&&installedRules(original);}
export function conflictFingerprint(c){return digest({rules:rulesFingerprint(c),functions:c.rulesFunctions,guard:c.foundationGuard});}
export function preservedConflictSources(before,after){const original=unpatch(after);return !!original&&conflictFingerprint(original)===conflictFingerprint(before);}
export async function repairConflicts({allowProjectRef,token,rehearse=false,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher};const before=await readRulesCatalog(args);
 if(installedConflictRepair(before))return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,state:'already_installed',writeAttempted:false};
 if(!installedRules(before))throw Error('Exact prior TEST rules required');
 if(!rehearse){
  const at=Date.parse(rehearsal?.observedAfter??''),now=clock();
  if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA256||rehearsal.state!=='rehearsed_and_rolled_back'||!rehearsal.acknowledged||!rehearsal.catalogUnchanged||!Number.isFinite(at)||at>now||now-at>3600000||rehearsal.beforeCatalogSha256!==rehearsal.afterCatalogSha256||rehearsal.afterCatalogSha256!==conflictFingerprint(before))throw Error('Fresh matching conflict repair rehearsal required');
 }
 let acknowledged=false,httpStatus=null,databaseCode=null;
 try{
  const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:conflictSql({rehearse}),read_only:false}),redirect:'error',signal:AbortSignal.timeout(45000)});
  httpStatus=r.status;const chunks=[];let bytes=0;
  for await(const chunk of r.body){bytes+=chunk.byteLength;if(bytes>1048576)throw Error();chunks.push(chunk);}
  const data=JSON.parse(Buffer.concat(chunks).toString());
  if(!r.ok)databaseCode=/ERROR:\s*([0-9A-Z]{5}):/.exec(typeof data?.message==='string'?data.message:'')?.[1]??null;
  else acknowledged=Array.isArray(data)&&data.length===1&&data[0].marker===MARKER&&(rehearse?data[0].receipt_absent===true:data[0].source_sha256===SOURCE_SHA256);
 }catch{/* Inspect a possibly committed result; never replay it. */}
 let after=null;try{after=await readRulesCatalog(args);}catch{}
 const beforeHash=conflictFingerprint(before),afterHash=after?conflictFingerprint(after):null;
 const unchanged=beforeHash===afterHash,installed=after?installedConflictRepair(after):false,preserved=after?preservedConflictSources(before,after):false;
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,writeAttempted:true,observedBefore:before.observedAt,observedAfter:after?.observedAt??null,
  state:acknowledged&&(rehearse?unchanged:installed&&preserved)?(rehearse?'rehearsed_and_rolled_back':'installed_needs_user_verification'):'requires_inspection',acknowledged,httpStatus,databaseCode,catalogUnchanged:unchanged,installedSchemaMatches:installed,existingSourceCatalogPreserved:preserved,beforeCatalogSha256:beforeHash,afterCatalogSha256:afterHash};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
  if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST operation and existing login required');
  const r=await repairConflicts({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,...(!rehearse?{rehearsal:JSON.parse(readFileSync(a[3],'utf8'))}:{})});
  console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
