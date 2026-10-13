/** Exact v1 -> v2 TEST runtime update. No secrets, grants, data or schedules changed.
 * Stops on uncertain outcomes; a retained journal must be inspected, not retried.
 */
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
import {edgeRuntimeBundle} from './learn-email-runtime-edge-bundle.mjs';
const project='saatxzwxvdvqevbnskxy';
if(process.argv.length!==3||!['prepare','deploy'].includes(process.argv[2]))throw Error('Specify prepare or deploy');
const pins={
 'quickbooks-oauth-start':'6f397322f0156fb18ec59928e092199d5b3f2171b3c3b64f645a60340bc450a1',
 'quickbooks-oauth-callback':'b01105fb32cc351e6657a897150b623ed7f11d2211b01a7b0d870e27caa8e764',
 'learn-quickbooks-worker':'891baf1805b9dcd4d43ad13fbdc7637b26582a49d3e05d420f266896d5a425d2',
 'quickbooks-disconnect':'a2d49119783e3b6b35fee7ac6e55f10b4ab28543b986747bbaca04de41574990',
};
const names=Object.keys(pins),token=savedCliToken();
const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const root='.verification-results/quickbooks-test-tracing-v2';mkdirSync(root,{recursive:true,mode:0o700});
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function api(path,query){const r=await fetch(`https://api.supabase.com/v1/projects/${project}${path}`,{method:query?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(query?{body:JSON.stringify({query})}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('TEST read failed '+r.status);return r.json();}
const countsSql=`select (select count(*) from learn_quickbooks_apps) apps,(select count(*) from learn_quickbooks_connections) connections,(select count(*) from learn_quickbooks_imports) imports,(select count(*) from learn_quickbooks_pages) pages,(select count(*) from learn_quickbooks_disconnections) disconnects`;
const metadata=f=>({name:f.slug,version:f.version,status:f.status,verifyJwt:f.verify_jwt,hash:f.ezbr_sha256});
const inventory=rows=>rows.map(metadata).sort((a,b)=>a.name.localeCompare(b.name));
// Managed SUPABASE_* update timestamps are refreshed on deploy. Compare the
// names and value fingerprints, not that generated timestamp metadata.
const secretInventory=rows=>rows.map(({name,value})=>({name,value})).sort((a,b)=>a.name.localeCompare(b.name));
const before=await api('/functions'),secrets=await api('/secrets'),counts=await api('/database/query/read-only',countsSql);
for(const name of names){const f=before.find(f=>f.slug===name);if(f?.version!==1||f.status!=='ACTIVE'||f.verify_jwt!==false||f.ezbr_sha256!==pins[name])throw Error('TEST prior runtime differs: '+name);}
if(counts.length!==1||Object.values(counts[0]).some(n=>n!==0)||secrets.some(s=>s.name==='LEARN_QUICKBOOKS_WORKER_KEY'))throw Error('TEST no longer idle/unprovisioned');
const bundle=edgeRuntimeBundle(names.map(name=>({name,verifyJwt:false})));
const plan={project,sourceClosureSha256:bundle.sha256,before:names.map(n=>metadata(before.find(f=>f.slug===n))),counts:counts[0],otherEndpointsSha256:digest(inventory(before.filter(f=>!names.includes(f.slug)))),secretValueInventorySha256:digest(secretInventory(secrets))};
if(process.argv[2]==='prepare'){
 writeFileSync(root+'/plan.json',JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({state:'prepared',project,sourceClosureSha256:bundle.sha256,endpoints:plan.before,providerRequests:0}));
}else{
 const prepared=JSON.parse(readFileSync(root+'/plan.json','utf8'));if(JSON.stringify(prepared)!==JSON.stringify(plan))throw Error('TEST plan/source changed');
 const journal={state:'started',project,startedAt:new Date().toISOString(),sourceClosureSha256:bundle.sha256,endpoints:[]};
 const journalPath=root+'/journal.json';writeFileSync(journalPath,JSON.stringify(journal,null,2),{mode:0o600,flag:'wx'});
 let stage;
 try{
  const backup=root+'/before';mkdirSync(backup,{mode:0o700});
  for(const name of names){const r=spawnSync(cli,['functions','download',name,'--project-ref',project,'--workdir',backup],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:60000,maxBuffer:2097152});if(r.status!==0)throw Error('TEST backup unconfirmed');}
  if(digest(inventory(await api('/functions')))!==digest(inventory(before)))throw Error('TEST runtime drift during backup');
  stage=mkdtempSync(join(tmpdir(),'serviceos-quickbooks-trace-'));
  for(const f of bundle.files){const path=join(stage,'supabase/functions',f.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,f.source);}
  writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${project}"\n`+names.map(n=>`[functions.${n}]\nverify_jwt = false\n`).join(''));
  for(const name of names){
   journal.endpoints.push({name,state:'deploy_requested'});writeFileSync(journalPath,JSON.stringify(journal,null,2));
   const result=spawnSync(cli,['functions','deploy',name,'--project-ref',project,'--use-api','--workdir',stage],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});
   if(result.status!==0)throw Error('TEST deployment uncertain; inspect journal and inventory');
   const f=(await api('/functions')).find(f=>f.slug===name);
   if(f?.version!==2||f.status!=='ACTIVE'||f.verify_jwt!==false)throw Error('TEST deployed metadata differs');
   journal.endpoints[journal.endpoints.length-1]={...metadata(f),state:'metadata_verified'};writeFileSync(journalPath,JSON.stringify(journal,null,2));
  }
  const after=await api('/functions'),afterSecrets=await api('/secrets'),afterCounts=await api('/database/query/read-only',countsSql);
  if(digest(inventory(after.filter(f=>!names.includes(f.slug))))!==plan.otherEndpointsSha256||digest(secretInventory(afterSecrets))!==plan.secretValueInventorySha256||JSON.stringify(afterCounts[0])!==JSON.stringify(plan.counts))throw Error('TEST preservation differs');
  journal.state='deployed_metadata_and_preservation_verified';journal.otherEndpointsUnchanged=true;journal.secretValueInventoryUnchanged=true;journal.counts=afterCounts[0];
 }catch(e){journal.state='requires_inspection';journal.failure=e instanceof Error&&e.message.startsWith('TEST')?e.message:'TEST outcome unconfirmed';process.exitCode=1;}
 finally{if(stage)rmSync(stage,{recursive:true,force:true});journal.finishedAt=new Date().toISOString();writeFileSync(journalPath,JSON.stringify(journal,null,2)+'\n');}
 console.log(JSON.stringify(journal));
}
