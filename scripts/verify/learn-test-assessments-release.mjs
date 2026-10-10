/** Fixed additive TEST assessment release. Pin all prerequisites; never replay uncertain writes. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readAssessmentCatalog,ASSESSMENT_TABLE,ASSESSMENT_FUNCTIONS} from './learn-assessments-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {installedSources,sourceFingerprint} from './learn-test-sources-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const ASSESSMENT_RELEASE='learn_saved_assessments_v1',ASSESSMENT_SHA='728d46dcf93127cfcb917b355d86a006e46d72bb5249b784a485ba079bcd798a';
const EXPECTED_SHA='98d5c37c7872a795df89fad7e3a524d9aea3c3938f330a52cee2146fb4938d9b';
const MARKER='learn-test-saved-assessments/1';
export function expectedAssessments(){
 const raw=readFileSync(new URL('../../supabase/release/learn-test/020_saved_assessments.expected.json',import.meta.url));
 if(createHash('sha256').update(raw).digest('hex')!==EXPECTED_SHA)throw Error('Reviewed assessment metadata differs');
 return JSON.parse(raw);
}
export const assessmentFingerprint=c=>digest({prior:sourceFingerprint(c),functions:c.assessmentFunctions,access:c.assessmentAccess});
export function assessmentPrerequisites(c){return installedSources(c)&&c.assessmentFunctions?.length===0&&c.assessmentAccess?.length===0&&!c.tables.some(t=>t.name===ASSESSMENT_TABLE);}
export function withoutAssessments(c){
 const prior=structuredClone(c);
 prior.tables=prior.tables.filter(t=>t.name!==ASSESSMENT_TABLE);
 prior.base.inventory.tables=prior.base.inventory.tables.filter(t=>t.schema!=='public'||t.name!==ASSESSMENT_TABLE);
 prior.base.inventory.functions=prior.base.inventory.functions.filter(f=>!ASSESSMENT_FUNCTIONS.includes(f.name));
 for(const report of [prior.readiness,prior.base.report])report.customMigrationEntries=report.customMigrationEntries.filter(e=>e.migration_name!==ASSESSMENT_RELEASE);
 prior.assessmentFunctions=[];prior.assessmentAccess=[];prior.readinessCatalogSha256=catalogFingerprint(prior.base);
 return prior;
}
export function installedAssessments(c){
 const e=expectedAssessments(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==21||entries.filter(r=>r.migration_name===ASSESSMENT_RELEASE&&r.source_sha256===ASSESSMENT_SHA&&r.project_ref===TEST_PROJECT).length!==1||digest(c.tables.filter(t=>t.name===ASSESSMENT_TABLE))!==digest([e.table])||digest(c.assessmentFunctions)!==digest(e.functions)||digest(c.assessmentAccess)!==digest(e.access))return false;
 const compact={schema:'public',name:e.table.name,rls:e.table.rls,forceRls:e.table.forceRls,anonSelect:false,authenticatedSelect:true,columns:e.table.columns.map(({name,type,notNull})=>({name,type,notNull,authenticatedSelect:true})),policies:e.table.policies.map(({permissive,...p})=>p)};
 if(digest(c.base.inventory.tables.filter(t=>t.schema==='public'&&t.name===ASSESSMENT_TABLE))!==digest([compact]))return false;
 const f=e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}));
 if(digest(c.base.inventory.functions.filter(f=>ASSESSMENT_FUNCTIONS.includes(f.name)))!==digest(f))return false;
 return assessmentPrerequisites(withoutAssessments(c));
}
export function assessmentReleaseSql(rehearse){
 let s=readFileSync(new URL('../../supabase/release/learn-test/020_saved_assessments.sql',import.meta.url),'utf8');
 if(createHash('sha256').update(s).digest('hex')!==ASSESSMENT_SHA)throw Error('Reviewed assessment SQL differs');
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Release transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${ASSESSMENT_SHA}';\n`);
 if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${ASSESSMENT_RELEASE}' and source_sha256='${ASSESSMENT_SHA}') as receipt_expected;`;
}
export async function releaseAssessments({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readAssessmentCatalog(args);
 if(installedAssessments(before))return {state:'already_installed',writeAttempted:false};
 if(!assessmentPrerequisites(before))throw Error('Exact TEST release 019 and absent assessment objects required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==ASSESSMENT_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==assessmentFingerprint(before)||!Number.isFinite(at)||at>now||now-at>3600000)throw Error('Fresh matching assessment rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,assessmentReleaseSql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never retry an uncertain write. */}
 let after=null;try{after=await readAssessmentCatalog(args);}catch{}
 const verified=after&&(rehearse?assessmentPrerequisites(after)&&assessmentFingerprint(before)===assessmentFingerprint(after):installedAssessments(after)&&assessmentFingerprint(withoutAssessments(after))===assessmentFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:ASSESSMENT_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:assessmentFingerprint(before),afterFingerprint:after?assessmentFingerprint(after):null,scope:'One immutable assessment ledger and owner/admin save RPC. No source-row edits, provider traffic, Edge changes, schedules or production changes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
 if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST assessment release required');
 const r=await releaseAssessments({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
