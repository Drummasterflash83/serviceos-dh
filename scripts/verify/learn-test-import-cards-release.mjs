/** Pinned TEST-only projection into the existing customer-card store. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readImportCardsCatalog,IMPORT_CARD_FUNCTIONS,IMPORT_CARD_INDEXES,IMPORT_CARD_TRIGGER} from './learn-import-cards-catalog.mjs';
import {importFingerprint} from './learn-test-import-release.mjs';
import {installedImportEndpoint} from './learn-test-import-endpoint-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
export const IMPORT_CARDS_RELEASE='learn_import_customer_cards_v1';
export const IMPORT_CARDS_SHA='8c89ff5faca8443ad45b8d16a3aa32eeb69b4dbbe2184d668cec48df9fe0f4b5';
const EXPECTED_SHA='c140b2343a63f05b54007b0357bd10d42e4aecf04b7c2bd5f42f0f09628c7605';
const MARKER='learn-test-import-cards/1';
function checked(name,hash){const raw=readFileSync(new URL('../../supabase/release/learn-test/'+name,import.meta.url));if(createHash('sha256').update(raw).digest('hex')!==hash)throw Error('Reviewed import card file differs');return raw.toString();}
export const expectedImportCards=()=>JSON.parse(checked('024_import_customer_cards.expected.json',EXPECTED_SHA));
export const importCardsFingerprint=c=>digest({prior:importFingerprint(c),functions:c.importCardFunctions,state:c.importCardState});
const indexes=c=>c.tables.flatMap(t=>t.indexes.filter(i=>IMPORT_CARD_INDEXES.includes(i.name)).map(i=>({...i,table:t.name})));
const triggers=c=>c.tables.flatMap(t=>t.triggers.filter(i=>i.name===IMPORT_CARD_TRIGGER).map(i=>({...i,table:t.name})));
export function importCardsPrerequisites(c){return installedImportEndpoint(c)&&c.importCardFunctions?.length===0&&indexes(c).length===0&&triggers(c).length===0&&digest(c.importCardState)===digest({triggers:[],indexes:[]});}
export function withoutImportCards(c){
 const prior=structuredClone(c);prior.importCardFunctions=[];prior.importCardState={triggers:[],indexes:[]};
 for(const t of prior.tables){t.indexes=t.indexes.filter(i=>!IMPORT_CARD_INDEXES.includes(i.name));t.triggers=t.triggers.filter(i=>i.name!==IMPORT_CARD_TRIGGER);}
 prior.base.inventory.functions=prior.base.inventory.functions.filter(f=>!IMPORT_CARD_FUNCTIONS.includes(f.name));
 for(const r of [prior.readiness,prior.base.report])r.customMigrationEntries=r.customMigrationEntries.filter(e=>e.migration_name!==IMPORT_CARDS_RELEASE);
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);return prior;
}
export function installedImportCards(c){
 const entries=c.readiness?.customMigrationEntries,e=expectedImportCards();
 if(!Array.isArray(entries)||entries.length!==25||entries.filter(r=>r.migration_name===IMPORT_CARDS_RELEASE&&r.source_sha256===IMPORT_CARDS_SHA&&r.project_ref===TEST_PROJECT).length!==1||digest(c.importCardFunctions)!==digest(e.functions)||digest(c.importCardState)!==digest(e.state)||digest(indexes(c))!==digest(e.indexes)||digest(triggers(c))!==digest(e.triggers))return false;
 const compact=e.functions.map(({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute})=>({name,arguments:args,securityDefiner,authenticatedExecute,anonExecute}));
 return digest(c.base.inventory.functions.filter(f=>IMPORT_CARD_FUNCTIONS.includes(f.name)))===digest(compact)&&importCardsPrerequisites(withoutImportCards(c));
}
export function importCardsSql(rehearse){
 let s=checked('024_import_customer_cards.sql',IMPORT_CARDS_SHA);
 if(s.split('\nbegin;\n').length!==2||s.split('\ncommit;\n').length!==2)throw Error('Card transaction framing differs');
 s=s.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${IMPORT_CARDS_SHA}';\n`);
 if(rehearse)s=s.replace('\ncommit;\n','\nrollback;\n');
 return s+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${IMPORT_CARDS_RELEASE}' and source_sha256='${IMPORT_CARDS_SHA}') as receipt_expected;`;
}
export async function releaseImportCards({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readImportCardsCatalog(args);
 if(installedImportCards(before))return {state:'already_installed',writeAttempted:false};
 if(!importCardsPrerequisites(before))throw Error('Exact TEST release 023 with import endpoint and absent card projection required');
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==IMPORT_CARDS_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.acknowledged!==true||rehearsal.beforeFingerprint!==rehearsal.afterFingerprint||rehearsal.afterFingerprint!==importCardsFingerprint(before)||!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>3600000)throw Error('Fresh matching card rollback rehearsal required');}
 let acknowledged=false;try{const rows=await communicationQuery(token,importCardsSql(rehearse),{fetcher,readOnly:false});acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect, never retry uncertain writes. */}
 let after=null;try{after=await readImportCardsCatalog(args);}catch{}
 const verified=after&&(rehearse?importCardsPrerequisites(after)&&importCardsFingerprint(before)===importCardsFingerprint(after):installedImportCards(after)&&importCardsFingerprint(withoutImportCards(after))===importCardsFingerprint(before));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:IMPORT_CARDS_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:importCardsFingerprint(before),afterFingerprint:after?importCardsFingerprint(after):null,scope:'Two card identity indexes, three private functions and one import-link trigger. No backfill, existing-card edits, imports, Edge changes, providers, schedules or production changes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';
 if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST card release required');
 const r=await releaseImportCards({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
