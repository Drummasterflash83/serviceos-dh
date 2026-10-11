/** Full hosted TEST rollback rehearsal; no persistent source/account changes. */
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {readHandoffCatalog,handoffInstalledSnapshot} from './learn-phone-handoff-catalog.mjs';
const prefix='.verification-results/identity-delivery-full-schema-v1';
const hash=s=>createHash('sha256').update(s).digest('hex');
const stable=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
const absent=`select to_regclass('public.learn_identity_delivery_receipts') is null
 and to_regprocedure('public.learn_identity_pending(uuid,integer)') is null
 and to_regprocedure('public.learn_identity_revision(public.interactions)') is null
 and to_regprocedure('public.learn_identity_deliver(uuid,uuid,uuid,text,text)') is null
 and not exists(select 1 from public.tenants where id in('b671cd32-bbbb-4000-8000-000000000001','b671cd32-bbbb-4000-8000-000000000002')) as absent`;
try{
 if(process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT||process.argv.slice(2).join(' ')!=='--rehearse --existing-cli-login')throw Error('Explicit TEST scope required');
 const token=savedCliToken(),catalog=await readHandoffCatalog(token);
 if(catalog.fingerprint!=='9780c9f11e60e5219a52088e53a4e6ff'||(await communicationQuery(token,absent))[0]?.absent!==true)throw Error('Exact TEST 061 and absent candidate required');
 const snapshot=handoffInstalledSnapshot(catalog.catalog.phone),before=await communicationQuery(token,snapshot);
 if(before.length!==115)throw Error('Full preservation baseline required');
 const source=readFileSync('supabase/migrations/20261101300000_learn_identity_delivery.sql','utf8'),probe=readFileSync('scripts/verify/learn-identity-delivery.assert.sql','utf8');
 const journal={projectRef:TEST_PROJECT,startedAt:new Date().toISOString(),sourceSha256:hash(source),probeSha256:hash(probe),schema:catalog.fingerprint,before};
 const fd=openSync(prefix+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
 let result=null;
 try{result=await communicationQuery(token,`begin;set local search_path=public,pg_catalog;${source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')}\n${probe}\nselect 'identity-delivery-rehearsed/1' as marker;rollback;`,{readOnly:false,fetcher:async(url,options)=>{const r=await fetch(url,options);if(!r.ok)writeFileSync(prefix+'-error.txt',(await r.clone().text()).slice(0,10000),{mode:0o600});return r;}});}catch{/* Inspect rollback, never replay an uncertain transaction. */}
 const after=await readHandoffCatalog(token),rows=await communicationQuery(token,snapshot),removed=(await communicationQuery(token,absent))[0]?.absent===true;
 const preserved=after.fingerprint===catalog.fingerprint&&stable(rows)===stable(before)&&removed;
 const passed=result?.some(r=>r.marker==='identity-delivery-rehearsed/1');
 const report={projectRef:TEST_PROJECT,state:preserved&&passed?'full_schema_rehearsed_and_rolled_back':preserved?'rehearsal_failed_rollback_verified':'requires_inspection',observedAt:new Date().toISOString(),sourceSha256:hash(source),probeSha256:hash(probe),preservedDatasets:preserved?115:null,originalSchemaRestored:after.fingerprint===catalog.fingerprint,candidateAndFixturesRemoved:removed,newUsers:0,newGrants:0,providerRequests:0,productionChanged:false};
 writeFileSync(prefix+'-result.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));if(!preserved||!passed)process.exitCode=1;
}catch(e){console.error('Identity delivery rehearsal unconfirmed: '+e.message);process.exitCode=1;}
