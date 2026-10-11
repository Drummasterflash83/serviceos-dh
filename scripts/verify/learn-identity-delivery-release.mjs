/** Pinned TEST-only atomic identity delivery release. Never resubmits uncertain writes. */
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {readHandoffCatalog,HANDOFF_CATALOG,handoffInstalledSnapshot} from './learn-phone-handoff-catalog.mjs';
import {IDENTITY_CATALOG,readIdentityCatalog,identityInstalledSnapshot} from './learn-identity-delivery-catalog.mjs';
const prefix='supabase/release/learn-test/062_identity_delivery';
const prior='9780c9f11e60e5219a52088e53a4e6ff';
const hash=s=>createHash('sha256').update(s).digest('hex');
const stable=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
const probePath='scripts/verify/learn-identity-delivery.assert.sql';
const absent=`select to_regclass('public.learn_identity_delivery_receipts') is null
 and to_regprocedure('public.learn_identity_pending(uuid,integer)') is null
 and to_regprocedure('public.learn_identity_revision(public.interactions)') is null
 and to_regprocedure('public.learn_identity_deliver(uuid,uuid,uuid,text,text)') is null
 and not exists(select 1 from public.tenants where id in('b671cd32-bbbb-4000-8000-000000000001','b671cd32-bbbb-4000-8000-000000000002')) as absent`;
const retainedNull=`select not exists(select 1 from public.learn_identity_delivery_receipts) as receipts_empty,
 not exists(select 1 from public.tenants where id in('b671cd32-bbbb-4000-8000-000000000001','b671cd32-bbbb-4000-8000-000000000002')) as fixtures_absent`;
async function main(){
 const mode=process.argv[2];
 if(!['--prepare','--rehearse','--apply'].includes(mode)||process.argv.slice(3).join(' ')!=='--existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST scope required');
 const token=savedCliToken(),before=await readHandoffCatalog(token);
 if(before.fingerprint!==prior)throw Error('Exact TEST 061 required; inspect existing state before any retry');
 if((await communicationQuery(token,absent))[0]?.absent!==true)throw Error('Unexpected existing identity objects');
 const snapshot=handoffInstalledSnapshot(before.catalog.phone),preserved=await communicationQuery(token,snapshot);
 if(preserved.length!==115)throw Error('All 115 retained datasets required');
 const files=['20261101300000_learn_identity_delivery.sql'].map(file=>({file,sql:readFileSync('supabase/migrations/'+file,'utf8')}));
 const migrations=files.map(f=>({file:f.file,sha256:hash(f.sql)}));
 const probe=readFileSync(probePath,'utf8');
 if(mode==='--prepare'){
  const rehearsed=JSON.parse(readFileSync('.verification-results/identity-delivery-full-schema-v1-result.json'));
  const journal=JSON.parse(readFileSync('.verification-results/identity-delivery-full-schema-v1-journal.json'));
  if(rehearsed.state!=='full_schema_rehearsed_and_rolled_back'||rehearsed.sourceSha256!==migrations[0].sha256||journal.probeSha256!==hash(probe))throw Error('Matching full-schema rehearsal required');
  const body=files.map(f=>f.sql.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')).join('\n');
  const sql=`-- TEST 062: atomic identity/card/event receipt. No capture activation.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$'
 or md5((${HANDOFF_CATALOG})::text)<>'${prior}' or not (${absent}) then raise exception 'Exact TEST identity prerequisites required';end if;
end$$;
create temporary table identity_preserved on commit drop as ${snapshot};
${body}
savepoint identity_assertions;
${probe}
rollback to savepoint identity_assertions;
release savepoint identity_assertions;
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from identity_preserved x) is distinct from
 (select jsonb_agg(to_jsonb(x) order by x.name) from (${snapshot})x) then raise exception 'Retained source preservation failed';end if;
 if exists(select 1 from public.learn_identity_delivery_receipts) or exists(select 1 from public.tenants where id in('b671cd32-bbbb-4000-8000-000000000001','b671cd32-bbbb-4000-8000-000000000002')) then raise exception 'Unexpected retained identity data';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref)
 values(current_setting('serviceos.release_source_sha256'),'learn_identity_delivery_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-identity-delivery-installed/1' as marker,md5((${IDENTITY_CATALOG})::text) as fingerprint;
commit;
`.replace(/[ \t]+$/gm,'');
  const manifest={projectRef:TEST_PROJECT,sha256:hash(sql),migrations,probeSha256:hash(probe),priorFingerprint:prior,preservedDatasets:115};
  writeFileSync(prefix+'.sql',sql,{flag:'wx'});writeFileSync(prefix+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({state:'prepared',...manifest}));return;
 }
 const sql=readFileSync(prefix+'.sql','utf8'),manifest=JSON.parse(readFileSync(prefix+'.manifest.json'));
 if(manifest.sha256!==hash(sql)||manifest.projectRef!==TEST_PROJECT||manifest.priorFingerprint!==prior||JSON.stringify(manifest.migrations)!==JSON.stringify(migrations)||manifest.probeSha256!==hash(probe))throw Error('Pinned package differs');
 const rehearsal=mode==='--apply'?JSON.parse(readFileSync('.verification-results/identity-delivery-package-rehearse-result.json')):null;
 if(rehearsal&&(rehearsal.state!=='rehearsed_rolled_back'||rehearsal.packageSha256!==manifest.sha256||!/^[a-f0-9]{32}$/.test(rehearsal.expectedFingerprint??'')||Date.now()-Date.parse(rehearsal.completedAt)>3600000))throw Error('Fresh exact package rehearsal required');
 const stem='.verification-results/identity-delivery-package-'+mode.slice(2);
 const journal={projectRef:TEST_PROJECT,packageSha256:manifest.sha256,mode,startedAt:new Date().toISOString(),before:prior,preserved};
 const fd=openSync(stem+'-journal.json','wx',0o600);
 try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
 let result=null;
 try{result=await communicationQuery(token,`set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${manifest.sha256}';\n`+(mode==='--rehearse'?sql.replace(/\ncommit;\n$/,'\nrollback;\n'):sql),{readOnly:false});}catch{/* Read authoritative state; never retry submission. */}
 const after=await readIdentityCatalog(token),afterRows=await communicationQuery(token,snapshot);
 const expected=mode==='--rehearse'?result?.find(r=>r.marker==='learn-identity-delivery-installed/1')?.fingerprint:rehearsal.expectedFingerprint;
 const preservedOk=stable(preserved)===stable(afterRows);
 let verified=false,installedRows=null;
 if(mode==='--rehearse')verified=preservedOk&&/^[a-f0-9]{32}$/.test(expected??'')&&(await readHandoffCatalog(token)).fingerprint===prior&&(await communicationQuery(token,absent))[0]?.absent===true;
 else if(after.fingerprint===expected){
  const flags=(await communicationQuery(token,retainedNull))[0];
  installedRows=await communicationQuery(token,identityInstalledSnapshot(after.catalog.phone));
  verified=preservedOk&&Object.values(flags).length===2&&Object.values(flags).every(v=>v===true)&&installedRows.length===116;
 }
 const report={projectRef:TEST_PROJECT,state:verified?(mode==='--rehearse'?'rehearsed_rolled_back':'installed_needs_runtime_and_acceptance'):'requires_inspection',completedAt:new Date().toISOString(),packageSha256:manifest.sha256,expectedFingerprint:expected??null,afterFingerprint:after.fingerprint,preservedDatasets:preservedOk?115:null,installedPreservationDatasets:installedRows?.length??null,persistentFixtureUsers:0,newSessions:0,newPlatformGrants:0,providerRequests:0,productionChanged:false};
 writeFileSync(stem+'-result.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 if(installedRows)writeFileSync(stem+'-installed-preservation.json',JSON.stringify(installedRows,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report,null,2));if(!verified)process.exitCode=1;
}
main().catch(e=>{console.error('Identity delivery release unconfirmed: '+e.message);process.exitCode=1;});
