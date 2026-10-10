/** Pinned TEST-only replacement of one import row-authority helper. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readGovernedImportCatalog} from './learn-governed-import-catalog.mjs';
import {installedImports,expectedImports,importFingerprint} from './learn-test-import-release.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const IMPORT_AUTHORITY_RELEASE='learn_import_actor_authority_v1';
export const IMPORT_AUTHORITY_SHA='8e30b2e65b43de7b39b873b3ee515dd9a44da98a5964d5ae704a66ec8ef2de86';
const EXPECTED_SHA='522de8a1c2a5ee1f1b40401a2f781509f3db11bfb4aaac0c9951c748e9b9433d';
const MARKER='learn-test-import-authority/1';
function checked(name,hash){const raw=readFileSync(new URL('../../supabase/release/learn-test/'+name,import.meta.url));if(createHash('sha256').update(raw).digest('hex')!==hash)throw Error('Reviewed import authority file differs');return raw.toString();}
export const expectedImportAuthority=()=>JSON.parse(checked('023_import_authority.expected.json',EXPECTED_SHA));
export function withoutImportAuthority(c){
 const prior=structuredClone(c),original=expectedImports().functions.find(f=>f.name==='import_row_preamble');
 prior.importFunctions=prior.importFunctions.map(f=>f.name==='import_row_preamble'?original:f);
 for(const r of [prior.readiness,prior.base.report])r.customMigrationEntries=r.customMigrationEntries.filter(e=>e.migration_name!==IMPORT_AUTHORITY_RELEASE);
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);return prior;
}
export function installedImportAuthority(c){
 const entries=c.readiness?.customMigrationEntries;
 return Array.isArray(entries)&&entries.length===24&&entries.filter(r=>r.migration_name===IMPORT_AUTHORITY_RELEASE&&r.source_sha256===IMPORT_AUTHORITY_SHA&&r.project_ref===TEST_PROJECT).length===1&&digest(c.importFunctions?.filter(f=>f.name==='import_row_preamble'))===digest(expectedImportAuthority())&&installedImports(withoutImportAuthority(c));
}
export function importAuthoritySql(rehearse){
 let s=checked('023_import_authority.sql',IMPORT_AUTHORITY_SHA);
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Authority transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${IMPORT_AUTHORITY_SHA}';\n`);
 if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${IMPORT_AUTHORITY_RELEASE}' and source_sha256='${IMPORT_AUTHORITY_SHA}') as receipt_expected;`;
}
export async function releaseImportAuthority({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readGovernedImportCatalog(args);
 if(installedImportAuthority(before))return {state:'already_installed',writeAttempted:false};
 if(!installedImports(before))throw Error('Exact TEST release 022 required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==IMPORT_AUTHORITY_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==importFingerprint(before)||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000)throw Error('Fresh matching authority rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,importAuthoritySql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never retry uncertain writes. */}
 let after=null;try{after=await readGovernedImportCatalog(args);}catch{}
 const verified=after&&(rehearse?installedImports(after)&&importFingerprint(before)===importFingerprint(after):installedImportAuthority(after)&&importFingerprint(withoutImportAuthority(after))===importFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:IMPORT_AUTHORITY_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:importFingerprint(before),afterFingerprint:after?importFingerprint(after):null,scope:'One service-only import authority helper. No source edits, imports, Edge changes, providers, schedules or production changes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
 if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST authority release required');
 const r=await releaseImportAuthority({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
