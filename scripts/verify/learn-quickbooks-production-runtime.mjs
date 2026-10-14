/** Deploy only the first four inert QuickBooks production runtimes.
 * No Intuit app credentials, company connection, worker key or schedule is created.
 */
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
import {edgeRuntimeBundle} from './learn-email-runtime-edge-bundle.mjs';
const project='tgbnakbxwcqjeimygroz',phase=process.argv[2];
if(!['prepare','deploy'].includes(phase)||process.argv.length!==3)throw Error('Specify prepare or deploy');
const token=savedCliToken(),names=['quickbooks-oauth-start','quickbooks-oauth-callback','learn-quickbooks-worker','quickbooks-disconnect'];
const root='.verification-results/quickbooks-production-runtime-v1';mkdirSync(root,{recursive:true,mode:0o700});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=rows=>rows.map(x=>({name:x.slug,version:x.version,status:x.status,verifyJwt:x.verify_jwt,hash:x.ezbr_sha256})).sort((a,b)=>a.name.localeCompare(b.name));
const fingerprints=rows=>rows.map(({name,value})=>({name,value})).sort((a,b)=>a.name.localeCompare(b.name));
const settings=[{name:'QUICKBOOKS_SITE_ORIGIN',value:'https://www.openfolk.ai'},{name:'QUICKBOOKS_MINOR_VERSION',value:'75'}];
async function api(path,body){const r=await fetch('https://api.supabase.com/v1/projects/'+project+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Production runtime request unconfirmed '+r.status+'; inspect journal before retry');const text=await r.text();return text?JSON.parse(text):null;}
const countsQuery="select (select count(*) from learn_quickbooks_apps) apps,(select count(*) from learn_quickbooks_connections) connections,(select count(*) from learn_quickbooks_imports) imports,(select count(*) from learn_quickbooks_pages) pages,(select count(*) from learn_quickbooks_source_versions) versions";
const counts=async()=>(await api('/database/query/read-only',{query:countsQuery}))[0];
const before=await api('/functions'),secrets=await api('/secrets'),beforeCounts=await counts();
if(before.some(x=>names.includes(x.slug))||secrets.some(x=>settings.some(s=>s.name===x.name)||x.name==='LEARN_QUICKBOOKS_WORKER_KEY')||Object.values(beforeCounts).some(n=>n!==0))throw Error('Production no longer matches first inert deployment');
const bundle=edgeRuntimeBundle(names.map(name=>({name,verifyJwt:false})));
const plan={project,sourceClosureSha256:bundle.sha256,existingEndpointsSha256:hash(fields(before)),existingSecretFingerprintsSha256:hash(fingerprints(secrets)),counts:beforeCounts,settings};
if(phase==='prepare'){writeFileSync(root+'/baseline.json',JSON.stringify({endpoints:fields(before),secretFingerprints:fingerprints(secrets)},null,2),{mode:0o600,flag:'wx'});writeFileSync(root+'/plan.json',JSON.stringify(plan,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({state:'prepared_not_deployed',project,sourceClosureSha256:bundle.sha256,newEndpoints:names,nonSecretSettings:settings,providerRequests:0}));}
if(phase==='deploy'){
 if(JSON.stringify(JSON.parse(readFileSync(root+'/plan.json')))!==JSON.stringify(plan)||existsSync(root+'/journal.json'))throw Error('Plan drift or previous attempt; inspect');
 const journal={state:'requested',project,startedAt:new Date().toISOString(),sourceClosureSha256:bundle.sha256,endpoints:[]};
 const save=()=>writeFileSync(root+'/journal.json',JSON.stringify(journal,null,2),{mode:0o600});save();let stage;
 try{
  await api('/secrets',settings);
  stage=mkdtempSync(join(tmpdir(),'serviceos-qb-production-runtime-'));
  for(const f of bundle.files){const p=join(stage,'supabase/functions',f.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,f.source);}
  writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${project}"\n`+names.map(n=>`[functions.${n}]\nverify_jwt = false\n`).join(''));
  const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
  for(const name of names){journal.endpoints.push({name,state:'deploy_requested'});save();const p=spawnSync(cli,['functions','deploy',name,'--project-ref',project,'--use-api','--workdir',stage],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});if(p.status!==0)throw Error('Deployment outcome uncertain');const current=(await api('/functions')).find(f=>f.slug===name);if(current?.version!==1||current.status!=='ACTIVE'||current.verify_jwt!==false)throw Error('Runtime metadata differs');journal.endpoints[journal.endpoints.length-1]={...fields([current])[0],state:'metadata_verified'};save();}
  const after=await api('/functions'),afterSecrets=await api('/secrets');
  if(hash(fields(after.filter(f=>!names.includes(f.slug))))!==plan.existingEndpointsSha256||hash(fingerprints(afterSecrets.filter(x=>!settings.some(s=>s.name===x.name))))!==plan.existingSecretFingerprintsSha256||JSON.stringify(await counts())!==JSON.stringify(beforeCounts))throw Error('Preservation differs');
  for(const s of settings){const found=afterSecrets.find(x=>x.name===s.name);const expected=createHash('sha256').update(s.value).digest('hex');if(found?.value!==expected)throw Error('Configuration fingerprint differs');}
  journal.state='metadata_and_preservation_verified';journal.otherEndpointsUnchanged=true;journal.otherSecretFingerprintsUnchanged=true;journal.inertCounts=beforeCounts;journal.providerRequests=0;
 }catch(e){journal.state='requires_inspection';journal.failure=String(e.message).startsWith('Preservation')?'Existing inventory or counts changed; reconcile the saved baseline without repeating deployment':String(e.message).startsWith('Configuration')?'Non-secret setting fingerprint differs':'Production runtime outcome requires inspection; no automatic retry';process.exitCode=1;}
 finally{if(stage)rmSync(stage,{recursive:true,force:true});journal.finishedAt=new Date().toISOString();save();}
 console.log(JSON.stringify(journal));
}
