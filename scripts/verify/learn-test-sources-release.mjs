/** Pinned read-only source-reader release; exact preceding TEST catalog and rollback first. */
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {readSourceCatalog,SOURCE_FUNCTION,SOURCE_TABLES} from './learn-card-sources-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {installedCorrections,correctionFingerprint} from './learn-test-corrections-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';import {digest} from './learn-test-foundation-release.mjs';import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const SOURCE_RELEASE='learn_card_sources_v1',SOURCE_SHA='cca8c835fdf7b3e088796ecd34dae4e09b6ed615f93386ff2f03cfdea9d86e86';
const EXPECTED_SHA='3cd16b5ad40f948fa3f680db8b7c3e196e49857967c8f30b04879e9f6abfac04',ACCESS_SHA='db9d91a41df090a3839c6fc7131aae8d242ecb3d5afd9f00e4519be014d2ff20',MARKER='learn-test-card-sources/1';
function checked(file,sha){const raw=readFileSync(new URL('../../supabase/release/learn-test/'+file,import.meta.url));if(createHash('sha256').update(raw).digest('hex')!==sha)throw Error('Reviewed source release metadata differs');return JSON.parse(raw);}
export const expectedSources=()=>checked('019_card_sources.expected.json',EXPECTED_SHA);
export const expectedSourceAccess=()=>checked('019_card_sources.access.json',ACCESS_SHA);
export const sourceFingerprint=c=>digest({prior:correctionFingerprint(c),reader:c.sourceReader});
export function sourcePrerequisites(c){return installedCorrections(c)&&['functions','policies','grants'].every(k=>Array.isArray(c.sourceReader?.[k])&&!c.sourceReader[k].length)&&digest(c.sourceReader.access)===digest(expectedSourceAccess());}
export function withoutSources(c){
 const prior=structuredClone(c),e=expectedSources();
 for(const [inventory,full] of [[prior.tables,true],[prior.base.inventory.tables,false],[prior.base.inventory.launchMetadata.relations,false]])for(const t of inventory){
  const additions=e.policies.filter(p=>p.table===t.name);if(!additions.length)continue;
  const expected=additions.map(({table,permissive,...p})=>full?{...p,permissive}:p);
  if(digest(t.policies.filter(p=>additions.some(e=>e.name===p.name)))!==digest(expected))throw Error('Source policy definition differs');
  t.policies=t.policies.filter(p=>!additions.some(e=>e.name===p.name));
 }
 if(digest(prior.communications.readerGrants.filter(g=>SOURCE_TABLES.includes(g.table)))!==digest(e.grants))throw Error('Source reader grants differ');
 prior.communications.readerGrants=prior.communications.readerGrants.filter(g=>!SOURCE_TABLES.includes(g.table));
 prior.base.inventory.functions=prior.base.inventory.functions.filter(f=>f.name!==SOURCE_FUNCTION);
 for(const report of [prior.readiness,prior.base.report])report.customMigrationEntries=report.customMigrationEntries.filter(r=>r.migration_name!==SOURCE_RELEASE);
 prior.sourceReader={...prior.sourceReader,functions:[],policies:[],grants:[]};prior.readinessCatalogSha256=catalogFingerprint(prior.base);return prior;
}
export function installedSources(c){
 const e=expectedSources(),entries=c.readiness?.customMigrationEntries,{access,...actual}=c.sourceReader??{};
 if(!Array.isArray(entries)||entries.length!==20||entries.filter(r=>r.migration_name===SOURCE_RELEASE&&r.source_sha256===SOURCE_SHA&&r.project_ref===TEST_PROJECT).length!==1||digest(actual)!==digest(e)||digest(access)!==digest(expectedSourceAccess()))return false;
 const f=e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}));
 if(digest(c.base.inventory.functions.filter(f=>f.name===SOURCE_FUNCTION))!==digest(f))return false;
 try{return sourcePrerequisites(withoutSources(c));}catch{return false;}
}
export function sourceReleaseSql(rehearse){
 let s=readFileSync(new URL('../../supabase/release/learn-test/019_card_sources.sql',import.meta.url),'utf8');if(createHash('sha256').update(s).digest('hex')!==SOURCE_SHA)throw Error('Reviewed source SQL differs');
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Release transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${SOURCE_SHA}';\n`);if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${SOURCE_RELEASE}' and source_sha256='${SOURCE_SHA}') as receipt_expected;`;
}
export async function releaseSources({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readSourceCatalog(args);
 if(installedSources(before))return {state:'already_installed',writeAttempted:false};
 if(!sourcePrerequisites(before))throw Error('Exact TEST release 018 and absent source reader required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==SOURCE_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==sourceFingerprint(before)||!Number.isFinite(at)||at>now||now-at>3600000)throw Error('Fresh exact source rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,sourceReleaseSql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never replay an unknown write. */}
 let after=null;try{after=await readSourceCatalog(args);}catch{}
 const verified=after&&(rehearse?sourcePrerequisites(after)&&sourceFingerprint(before)===sourceFingerprint(after):installedSources(after)&&sourceFingerprint(withoutSources(after))===sourceFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:sourceFingerprint(before),afterFingerprint:after?sourceFingerprint(after):null,scope:'Bounded source RPC, three RLS policies and 19 reader column grants. No ordinary-client raw grants, source changes, provider traffic, endpoint changes or production writes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST source release required');const r=await releaseSources({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
