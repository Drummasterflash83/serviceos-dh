/** Pinned TEST-only additive release. Inspect an uncertain write; never replay it. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readThreadRecoveryCatalog,THREAD_RECOVERY_FUNCTIONS,THREAD_RECOVERY_INDEXES} from './learn-slack-thread-recovery-catalog.mjs';
import {installedAssessments,assessmentFingerprint} from './learn-test-assessments-release.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const THREAD_RECOVERY_RELEASE='learn_slack_thread_recovery_v1';
export const THREAD_RECOVERY_SHA='16d639506c5a7626b6cc3563798b44303e8cf922c9d776e6752c1c80fcd03344';
const EXPECTED_SHA='9d7890ebd06d919e89f490580f1820aee6601a3f918dfe51fc5c8c8bb9ca386d';
const MARKER='learn-test-thread-recovery/1';
function checkedFile(name,hash){const raw=readFileSync(new URL(`../../supabase/release/learn-test/${name}`,import.meta.url));if(createHash('sha256').update(raw).digest('hex')!==hash)throw Error('Reviewed thread recovery file differs');return raw.toString();}
export const expectedThreadRecovery=()=>JSON.parse(checkedFile('021_slack_thread_recovery.expected.json',EXPECTED_SHA));
export const threadRecoveryFingerprint=c=>digest({prior:assessmentFingerprint(c),functions:c.threadRecoveryFunctions});
const indexes=c=>c.tables.flatMap(t=>t.indexes.filter(i=>THREAD_RECOVERY_INDEXES.includes(i.name)));
export function threadRecoveryPrerequisites(c){return installedAssessments(c)&&c.threadRecoveryFunctions?.length===0&&indexes(c).length===0;}
export function withoutThreadRecovery(c){
 const prior=structuredClone(c);prior.threadRecoveryFunctions=[];
 for(const t of prior.tables)t.indexes=t.indexes.filter(i=>!THREAD_RECOVERY_INDEXES.includes(i.name));
 prior.base.inventory.functions=prior.base.inventory.functions.filter(f=>!THREAD_RECOVERY_FUNCTIONS.includes(f.name));
 for(const report of [prior.readiness,prior.base.report])report.customMigrationEntries=report.customMigrationEntries.filter(e=>e.migration_name!==THREAD_RECOVERY_RELEASE);
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);return prior;
}
export function installedThreadRecovery(c){
 const e=expectedThreadRecovery(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==22||entries.filter(r=>r.migration_name===THREAD_RECOVERY_RELEASE&&r.source_sha256===THREAD_RECOVERY_SHA&&r.project_ref===TEST_PROJECT).length!==1||digest(c.threadRecoveryFunctions)!==digest(e.functions)||digest(indexes(c))!==digest(e.indexes))return false;
 const compact=e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}));
 if(digest(c.base.inventory.functions.filter(f=>THREAD_RECOVERY_FUNCTIONS.includes(f.name)))!==digest(compact))return false;
 return threadRecoveryPrerequisites(withoutThreadRecovery(c));
}
export function threadRecoveryReleaseSql(rehearse){
 let s=checkedFile('021_slack_thread_recovery.sql',THREAD_RECOVERY_SHA);
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Release transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${THREAD_RECOVERY_SHA}';\n`);
 if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${THREAD_RECOVERY_RELEASE}' and source_sha256='${THREAD_RECOVERY_SHA}') as receipt_expected;`;
}
export async function releaseThreadRecovery({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readThreadRecoveryCatalog(args);
 if(installedThreadRecovery(before))return {state:'already_installed',writeAttempted:false};
 if(!threadRecoveryPrerequisites(before))throw Error('Exact TEST release 020 and absent thread recovery objects required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==THREAD_RECOVERY_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==threadRecoveryFingerprint(before)||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000)throw Error('Fresh matching thread recovery rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,threadRecoveryReleaseSql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never retry an uncertain write. */}
 let after=null;try{after=await readThreadRecoveryCatalog(args);}catch{}
 const verified=after&&(rehearse?threadRecoveryPrerequisites(after)&&threadRecoveryFingerprint(before)===threadRecoveryFingerprint(after):installedThreadRecovery(after)&&threadRecoveryFingerprint(withoutThreadRecovery(after))===threadRecoveryFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:THREAD_RECOVERY_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:threadRecoveryFingerprint(before),afterFingerprint:after?threadRecoveryFingerprint(after):null,scope:'Three additive recovery functions and two indexes. No import started, source-row edits, provider traffic, Edge changes, schedules or production changes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
 if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST thread recovery release required');
 const r=await releaseThreadRecovery({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
