/** Additive, rollback-first TEST release of the existing delivery progress and audit model. */
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {DELIVERY_CATALOG,DELIVERY_SNAPSHOT,DELIVERY_PRESERVED,readDeliveryCatalog} from './learn-delivery-catalog.mjs';
export const DELIVERY_RELEASE_SHA='0eb27023d25178b07500b9cc9af344069bbc07e65703d10bfb241acd3e484955';
const prefix='supabase/release/learn-test/036_delivery_progress';
const hash=s=>createHash('sha256').update(s).digest('hex');
import {deliverySource,DELIVERY_SOURCES} from './learn-delivery-source.mjs';
const paths=DELIVERY_SOURCES;
const sorted=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name));
function sources(rows){
 if(!Array.isArray(rows)||rows.length!==DELIVERY_PRESERVED.length||new Set(rows.map(r=>r.name)).size!==rows.length||rows.some(r=>!DELIVERY_PRESERVED.includes(r.name)||!Number.isSafeInteger(r.count)||r.count<0||!/^[a-f0-9]{32}$/.test(r.fingerprint)))throw Error('Complete preservation evidence required');
 return sorted(rows);
}
export function prepareDeliveryPackage(){
 const prior=JSON.parse(readFileSync('.verification-results/delivery-prior.json'));
 if(prior.catalog.delivery.tables.length!==1||prior.catalog.delivery.tables[0].name!=='view_as_context'||prior.catalog.delivery.functions.length!==0||prior.catalog.health.runtime.ledger.length!==36||prior.catalog.health.runtime.ledger.some(r=>r.project_ref!==TEST_PROJECT)||!/^[a-f0-9]{32}$/.test(prior.fingerprint))throw Error('Exact empty TEST delivery prerequisites required');
 sources(prior.preserved);
 const selected=deliverySource();
 const sql=`-- TEST-only shared delivery progress foundation; no activation, access grants or source imports.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((${DELIVERY_CATALOG})::text) <> '${prior.fingerprint}' then raise exception 'Exact delivery progress prerequisites required';end if;
end $$;
create temporary table serviceos_delivery_progress_preserved on commit drop as ${DELIVERY_SNAPSHOT};
${selected.sql}
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_delivery_progress_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${DELIVERY_SNAPSHOT})x) then raise exception 'Retained sources changed during delivery progress release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_delivery_progress_base_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-delivery-progress/1' as marker,${DELIVERY_CATALOG} as catalog,md5((${DELIVERY_CATALOG})::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_delivery_progress_preserved x) as preserved;
commit;
`;
 const manifest={version:'learn-delivery-progress-package/1',projectRef:TEST_PROJECT,sha256:hash(sql),priorFingerprint:prior.fingerprint,sources:selected.sources,preservedDataSets:prior.preserved.length};
 writeFileSync(prefix+'.sql',sql);writeFileSync(prefix+'.manifest.json',JSON.stringify(manifest,null,2)+'\n');writeFileSync(prefix+'.prerequisites.json',JSON.stringify(prior,null,2)+'\n');
 return {sha256:manifest.sha256,priorFingerprint:prior.fingerprint,preservedDataSets:prior.preserved.length};
}
export function deliveryPackage(){
 const sql=readFileSync(prefix+'.sql','utf8'),manifest=JSON.parse(readFileSync(prefix+'.manifest.json'));
 if(hash(sql)!==DELIVERY_RELEASE_SHA||manifest.sha256!==DELIVERY_RELEASE_SHA||manifest.projectRef!==TEST_PROJECT||manifest.sources.length!==paths.length||manifest.sources.some((s,i)=>s.path!==paths[i]||hash(readFileSync(s.path))!==s.sha256))throw Error('Pinned delivery package changed');
 return {sql,manifest};
}
export async function releaseDelivery({mode,allowProjectRef,token,persistJournal,query=communicationQuery,catalog=readDeliveryCatalog,rehearsal}){
 if(!['rehearse','apply'].includes(mode)||allowProjectRef!==TEST_PROJECT||typeof persistJournal!=='function'||!/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token??''))throw Error('Explicit TEST operation and durable journal required');
 const {sql,manifest}=deliveryPackage();
 if(mode==='apply'&&(rehearsal?.state!=='rehearsed_rolled_back'||rehearsal.sourceSha256!==DELIVERY_RELEASE_SHA||rehearsal.projectRef!==TEST_PROJECT||!/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint??'')))throw Error('Exact successful rehearsal required');
 const [before,rows]=await Promise.all([catalog(token),query(token,DELIVERY_SNAPSHOT)]),preserved=sources(rows);
 if(before.fingerprint!==manifest.priorFingerprint)throw Error('TEST prerequisites changed');
 const journal={version:'learn-delivery-progress/1',projectRef:TEST_PROJECT,mode,sourceSha256:DELIVERY_RELEASE_SHA,priorFingerprint:before.fingerprint,expectedFingerprint:rehearsal?.expectedFingerprint??null,preserved,observedAt:new Date().toISOString()};
 await persistJournal(journal);
 let receipt=null;
 try{const result=await query(token,`set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${DELIVERY_RELEASE_SHA}';\n`+(mode==='rehearse'?sql.replace(/\ncommit;\n$/,'\nrollback;\n'):sql),{readOnly:false});if(result.length===1&&result[0].marker==='learn-delivery-progress/1')receipt=result[0];}catch{/* Never resubmit an uncertain transaction. */}
 const [after,afterRows]=await Promise.all([catalog(token),query(token,DELIVERY_SNAPSHOT)]);
 const unchanged=JSON.stringify(preserved)===JSON.stringify(sources(afterRows));
 const expected=mode==='rehearse'?receipt?.fingerprint:rehearsal.expectedFingerprint;
 const validReceipt=receipt?.catalog?.delivery?.tables?.length===3&&receipt?.catalog?.delivery?.functions?.length===2&&receipt?.catalog?.health?.runtime?.ledger?.length===37&&JSON.stringify(preserved)===JSON.stringify(sources(receipt?.preserved??[]));
 const state=unchanged&&(mode==='rehearse'?validReceipt&&after.fingerprint===before.fingerprint:after.fingerprint===expected)?(mode==='rehearse'?'rehearsed_rolled_back':'installed_needs_signed_in_acceptance'):'requires_inspection';
 return {version:journal.version,projectRef:TEST_PROJECT,sourceSha256:DELIVERY_RELEASE_SHA,mode,state,observedAt:new Date().toISOString(),priorFingerprint:before.fingerprint,expectedFingerprint:expected,afterFingerprint:after.fingerprint,preservedDataSets:unchanged?preserved.length:null,receipt:receipt?{fingerprint:receipt.fingerprint,tables:receipt.catalog?.delivery?.tables?.length,functions:receipt.catalog?.delivery?.functions?.length}:null};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.slice(2).join(' ')==='--prepare')console.log(JSON.stringify(prepareDeliveryPackage(),null,2));
  else{
   const mode=process.argv[2]?.slice(2);
   if(process.argv.length!==4||process.argv[3]!=='--existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST operation required');
   const stem='.verification-results/delivery-progress-'+mode;
   const result=await releaseDelivery({mode,allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearsal:mode==='apply'?JSON.parse(readFileSync('.verification-results/delivery-progress-rehearse-result.json')):undefined,persistJournal:async journal=>{const fd=openSync(stem+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}}});
   writeFileSync(stem+'-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));if(result.state==='requires_inspection')process.exitCode=1;
  }
 }catch{console.error('Delivery progress release unconfirmed; inspect retained journal and schema before any further attempt.');process.exitCode=1;}
}
