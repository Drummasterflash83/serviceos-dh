/** Fixed additive TEST correction release. Pin all prerequisites; never replay uncertain writes. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readCorrectionCatalog,CORRECTION_TABLE,CORRECTION_FUNCTION} from './learn-performance-corrections-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {installedCommunicationContext} from './learn-test-communication-context.mjs';
import {communicationFingerprint} from './learn-test-communications-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const CORRECTION_RELEASE='learn_performance_corrections_v1',CORRECTION_SHA='da742d0a4ea5b20aa98e03fcbee02b85e9f2a0d93f3aed7dcd64a9c7205fea8d';
const EXPECTED_SHA='1d68d099b41eb5ff0e9303bcd433bbb5d4cd9e41fef576de0920a2d6a493d478';
const MARKER='learn-test-performance-corrections/1';
export function expectedCorrections(){
 const raw=readFileSync(new URL('../../supabase/release/learn-test/018_performance_corrections.expected.json',import.meta.url));
 if(createHash('sha256').update(raw).digest('hex')!==EXPECTED_SHA)throw Error('Reviewed correction metadata differs');
 return JSON.parse(raw);
}
export const correctionFingerprint=c=>digest({prior:communicationFingerprint(c),functions:c.correctionFunctions,access:c.correctionAccess});
export function correctionPrerequisites(c){return installedCommunicationContext(c)&&c.correctionFunctions?.length===0&&c.correctionAccess?.length===0&&!c.tables.some(t=>t.name===CORRECTION_TABLE);}
export function withoutCorrections(c){
 const prior=structuredClone(c);
 prior.tables=prior.tables.filter(t=>t.name!==CORRECTION_TABLE);
 prior.base.inventory.tables=prior.base.inventory.tables.filter(t=>t.schema!=='public'||t.name!==CORRECTION_TABLE);
 prior.base.inventory.functions=prior.base.inventory.functions.filter(f=>f.name!==CORRECTION_FUNCTION);
 for(const report of [prior.readiness,prior.base.report])report.customMigrationEntries=report.customMigrationEntries.filter(e=>e.migration_name!==CORRECTION_RELEASE);
 prior.correctionFunctions=[];prior.correctionAccess=[];prior.readinessCatalogSha256=catalogFingerprint(prior.base);
 return prior;
}
export function installedCorrections(c){
 const e=expectedCorrections(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==19||entries.filter(r=>r.migration_name===CORRECTION_RELEASE&&r.source_sha256===CORRECTION_SHA&&r.project_ref===TEST_PROJECT).length!==1||digest(c.tables.filter(t=>t.name===CORRECTION_TABLE))!==digest([e.table])||digest(c.correctionFunctions)!==digest(e.functions)||digest(c.correctionAccess)!==digest(e.access))return false;
 const compact={schema:'public',name:e.table.name,rls:e.table.rls,forceRls:e.table.forceRls,anonSelect:false,authenticatedSelect:true,columns:e.table.columns.map(({name,type,notNull})=>({name,type,notNull,authenticatedSelect:true})),policies:e.table.policies.map(({permissive,...p})=>p)};
 if(digest(c.base.inventory.tables.filter(t=>t.schema==='public'&&t.name===CORRECTION_TABLE))!==digest([compact]))return false;
 const f=e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}));
 if(digest(c.base.inventory.functions.filter(f=>f.name===CORRECTION_FUNCTION))!==digest(f))return false;
 return correctionPrerequisites(withoutCorrections(c));
}
export function correctionReleaseSql(rehearse){
 let s=readFileSync(new URL('../../supabase/release/learn-test/018_performance_corrections.sql',import.meta.url),'utf8');
 if(createHash('sha256').update(s).digest('hex')!==CORRECTION_SHA)throw Error('Reviewed correction SQL differs');
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Release transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${CORRECTION_SHA}';\n`);
 if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${CORRECTION_RELEASE}' and source_sha256='${CORRECTION_SHA}') as receipt_expected;`;
}
export async function releaseCorrections({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readCorrectionCatalog(args);
 if(installedCorrections(before))return {state:'already_installed',writeAttempted:false};
 if(!correctionPrerequisites(before))throw Error('Exact TEST release 017 and absent correction objects required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==CORRECTION_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==correctionFingerprint(before)||!Number.isFinite(at)||at>now||now-at>3600000)throw Error('Fresh matching correction rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,correctionReleaseSql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never retry an uncertain write. */}
 let after=null;try{after=await readCorrectionCatalog(args);}catch{}
 const verified=after&&(rehearse?correctionPrerequisites(after)&&correctionFingerprint(before)===correctionFingerprint(after):installedCorrections(after)&&correctionFingerprint(withoutCorrections(after))===correctionFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:CORRECTION_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:correctionFingerprint(before),afterFingerprint:after?correctionFingerprint(after):null,scope:'One append-only correction ledger and owner/admin RPC. No source-row edits, provider traffic, Edge changes, schedules or production changes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
 if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST correction release required');
 const r=await releaseCorrections({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
