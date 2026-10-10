/** Exact TEST-only governed import release. Never retry an uncertain write. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readGovernedImportCatalog,IMPORT_FUNCTIONS} from './learn-governed-import-catalog.mjs';
import {installedThreadRecovery,threadRecoveryFingerprint} from './learn-test-thread-recovery-release.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const IMPORT_RELEASE='learn_governed_imports_v1';
export const IMPORT_SHA='0294ba3ef802b53ad158ee98570a79dc713840496bb45d53a4263d3f26ecea9d';
const EXPECTED_SHA='a4fceaf193cf5609884a0aa8971f243dd635d74f76e5731eb2aa0b63c4e6243f';
const MARKER='learn-test-governed-imports/1';
export const IMPORT_TABLES=['contact_points','import_conflicts','import_entity_links','import_row_results'];
export const IMPORT_INDEXES=['data_imports_tenant_id_uk','people_tenant_id_uk'];
function checkedFile(name,hash){const raw=readFileSync(new URL(`../../supabase/release/learn-test/${name}`,import.meta.url));if(createHash('sha256').update(raw).digest('hex')!==hash)throw Error('Reviewed import release file differs');return raw.toString();}
export const expectedImports=()=>JSON.parse(checkedFile('022_governed_imports.expected.json',EXPECTED_SHA));
export const importFingerprint=c=>digest({prior:threadRecoveryFingerprint(c),functions:c.importFunctions,profiles:c.importProfiles});
const indexes=c=>c.tables.flatMap(t=>t.indexes.filter(i=>IMPORT_INDEXES.includes(i.name)).map(i=>({...i,table:t.name})));
export const compactImportTable=t=>({schema:'public',name:t.name,rls:t.rls,forceRls:t.forceRls,anonSelect:t.anonAccess,authenticatedSelect:t.authenticatedSelect,columns:t.columns.map(({name,type,notNull})=>({name,type,notNull,authenticatedSelect:t.authenticatedSelect})),policies:t.policies.map(({permissive,...p})=>p)});
export function importPrerequisites(c){return installedThreadRecovery(c)&&c.importFunctions?.length===0&&c.importProfiles?.length===0&&!c.tables.some(t=>IMPORT_TABLES.includes(t.name))&&indexes(c).length===0;}
export function withoutImports(c){
 const prior=structuredClone(c);prior.importFunctions=[];prior.importProfiles=[];
 prior.tables=prior.tables.filter(t=>!IMPORT_TABLES.includes(t.name));
 for(const t of prior.tables)t.indexes=t.indexes.filter(i=>!IMPORT_INDEXES.includes(i.name));
 prior.base.inventory.tables=prior.base.inventory.tables.filter(t=>t.schema!=='public'||!IMPORT_TABLES.includes(t.name));
 prior.base.inventory.functions=prior.base.inventory.functions.filter(f=>!IMPORT_FUNCTIONS.includes(f.name));
 for(const report of [prior.readiness,prior.base.report])report.customMigrationEntries=report.customMigrationEntries.filter(e=>e.migration_name!==IMPORT_RELEASE);
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);return prior;
}
export function installedImports(c){
 const e=expectedImports(),entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==23||entries.filter(r=>r.migration_name===IMPORT_RELEASE&&r.source_sha256===IMPORT_SHA&&r.project_ref===TEST_PROJECT).length!==1||digest(c.importFunctions)!==digest(e.functions)||digest(c.importProfiles)!==digest(e.profiles)||digest(indexes(c))!==digest(e.indexes)||digest(c.tables.filter(t=>IMPORT_TABLES.includes(t.name)))!==digest(e.tables))return false;
 const compact=e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}));
 if(digest(c.base.inventory.functions.filter(f=>IMPORT_FUNCTIONS.includes(f.name)))!==digest(compact)||digest(c.base.inventory.tables.filter(t=>t.schema==='public'&&IMPORT_TABLES.includes(t.name)))!==digest(e.tables.map(compactImportTable)))return false;
 return importPrerequisites(withoutImports(c));
}
export function importReleaseSql(rehearse){
 let s=checkedFile('022_governed_imports.sql',IMPORT_SHA);
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Import release transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${IMPORT_SHA}';\n`);
 if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${IMPORT_RELEASE}' and source_sha256='${IMPORT_SHA}') as receipt_expected;`;
}
export async function releaseImports({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readGovernedImportCatalog(args);
 if(installedImports(before))return {state:'already_installed',writeAttempted:false};
 if(!importPrerequisites(before))throw Error('Exact TEST release 021 and absent governed import objects/profiles required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==IMPORT_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==importFingerprint(before)||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000)throw Error('Fresh matching import rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,importReleaseSql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never retry an uncertain write. */}
 let after=null;try{after=await readGovernedImportCatalog(args);}catch{}
 const verified=after&&(rehearse?importPrerequisites(after)&&importFingerprint(before)===importFingerprint(after):installedImports(after)&&importFingerprint(withoutImports(after))===importFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:IMPORT_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:importFingerprint(before),afterFingerprint:after?importFingerprint(after):null,scope:'Four additive tables, two parent indexes, 25 functions and three platform import profiles. No import started, source rows edited, provider traffic, Edge changes, schedules or production changes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
 if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST import release required');
 const r=await releaseImports({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
