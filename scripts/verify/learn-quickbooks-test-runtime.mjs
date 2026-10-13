/** Deploy only three new QuickBooks endpoints into TEST; no worker key or capture. */
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
const project='saatxzwxvdvqevbnskxy';
const disconnectOnly=process.argv[3]==='disconnect';
const names=disconnectOnly?['quickbooks-disconnect']:['quickbooks-oauth-start','quickbooks-oauth-callback','learn-quickbooks-worker'];
const mode=process.argv[2];if(!['deploy','verify'].includes(mode)||(![3,4].includes(process.argv.length)||(process.argv.length===4&&!disconnectOnly)))throw Error('Specify deploy or verify');
const token=savedCliToken(),sha=s=>createHash('sha256').update(s).digest('hex');
async function api(path,options={}){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}${path}`,{...options,headers:{Authorization:'Bearer '+token,...options.headers},redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error('TEST runtime request returned HTTP '+r.status+'; inspect before retry');
 const text=await r.text();return text?JSON.parse(text):null;
}
async function query(query){return api('/database/query/read-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});}
let stage;
const report={project,observedAt:new Date().toISOString(),endpoints:[],probes:[],productionChanges:0,providerRequests:0};
try{
 const foundation=await query("select release_id from learn_quickbooks_release_receipts where release_id='quickbooks_foundation_v1'");if(foundation.length!==1)throw Error('TEST foundation required');
 if(disconnectOnly){const r=await query("select source_hashes from learn_quickbooks_release_receipts where release_id='quickbooks_disconnect_v1'");if(r.length!==1||r[0].source_hashes?.[0]?.sha256!==sha(readFileSync('supabase/migrations/20261102030000_learn_quickbooks_disconnect.sql','utf8')))throw Error('TEST disconnect schema required');}
 const before=await api('/functions');
 if(mode==='deploy'){
  if(before.some(f=>names.includes(f.slug)))throw Error('TEST QuickBooks endpoint already exists; inspect before replacement');
  const settings=[{name:'QUICKBOOKS_SITE_ORIGIN',value:'https://test.openfolk.ai'},{name:'QUICKBOOKS_MINOR_VERSION',value:'75'}];
  const existing=await api('/secrets');
  for(const s of settings){const old=existing.find(x=>x.name===s.name);if(old&&old.value!==sha(s.value))throw Error('TEST QuickBooks configuration already differs');}
  const missing=settings.filter(s=>!existing.some(x=>x.name===s.name));
  if(missing.length)await api('/secrets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(missing)});
  const paths=[...names.map(n=>n+'/index.ts'),'_shared/slack/slack_worker_http.ts',...readdirSync('supabase/functions/_shared/quickbooks').filter(f=>f.endsWith('.ts')&&!f.endsWith('.test.ts')).map(f=>'_shared/quickbooks/'+f)];
  const files=paths.sort().map(path=>({path,source:readFileSync('supabase/functions/'+path,'utf8')}));
  report.sourceBundleSha256=sha(JSON.stringify(files));
  stage=mkdtempSync(join(tmpdir(),'serviceos-quickbooks-test-runtime-'));
  for(const f of files){const target=join(stage,'supabase/functions',f.path);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,f.source);}
  writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${project}"\n`+names.map(n=>`[functions.${n}]\nverify_jwt = false\n`).join(''));
  const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
  for(const name of names){
   const result=spawnSync(cli,['functions','deploy',name,'--project-ref',project,'--use-api','--workdir',stage],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});
   report.endpoints.push({name,cliStatus:result.status});if(result.status!==0)throw Error('TEST runtime deploy unconfirmed; inspect endpoint metadata');
  }
 }
 const after=await api('/functions');
 for(const name of names){const f=after.find(x=>x.slug===name);if(!f||f.status!=='ACTIVE'||f.verify_jwt!==false)throw Error('TEST endpoint metadata does not match');report.endpoints=report.endpoints.filter(x=>x.name!==name);report.endpoints.push({name,status:f.status,version:f.version,verifyJwt:f.verify_jwt,artifactHash:f.ezbr_sha256});}
 const rest=rows=>JSON.stringify(rows.filter(f=>!names.includes(f.slug)).map(f=>({slug:f.slug,version:f.version,hash:f.ezbr_sha256,status:f.status,verifyJwt:f.verify_jwt})).sort((a,b)=>a.slug.localeCompare(b.slug)));
 report.otherEndpointsUnchanged=rest(before)===rest(after);if(!report.otherEndpointsUnchanged)throw Error('TEST unrelated runtime changed; inspect concurrent release');
 const base=`https://${project}.supabase.co/functions/v1/`;
 const probes=disconnectOnly?[{name:'quickbooks-disconnect',method:'OPTIONS',origin:'https://test.openfolk.ai',expected:204},{name:'quickbooks-disconnect',method:'POST',origin:'https://test.openfolk.ai',expected:401},{name:'quickbooks-disconnect',method:'POST',origin:'https://example.invalid',expected:403}]:[{name:'quickbooks-oauth-start',method:'OPTIONS',origin:'https://test.openfolk.ai',expected:204},{name:'quickbooks-oauth-start',method:'POST',origin:'https://test.openfolk.ai',expected:401},{name:'quickbooks-oauth-start',method:'POST',origin:'https://example.invalid',expected:403},{name:'quickbooks-oauth-callback',method:'GET',expected:400},{name:'learn-quickbooks-worker',method:'POST',expected:503}];
 for(const p of probes){
  const r=await fetch(base+p.name,{method:p.method,headers:p.origin?{Origin:p.origin}:{},redirect:'error',signal:AbortSignal.timeout(20000)});
  const body=await r.text();
  if(r.status!==p.expected||!r.headers.get('cache-control')?.includes('no-store'))throw Error('TEST public guard probe failed: '+p.name);
  if(p.method==='OPTIONS'&&r.headers.get('access-control-allow-origin')!=='https://test.openfolk.ai')throw Error('TEST CORS mismatch');
  if(p.name==='quickbooks-oauth-callback'&&(!body.includes('https://test.openfolk.ai/openfolk')||r.headers.get('referrer-policy')!=='no-referrer'))throw Error('TEST callback guard mismatch');
  report.probes.push({name:p.name,method:p.method,status:r.status,origin:p.origin??null});
 }
 const counts=await query("select (select count(*) from learn_quickbooks_apps) apps,(select count(*) from learn_quickbooks_connections) connections,(select count(*) from learn_quickbooks_imports) imports,(select count(*) from learn_quickbooks_pages) pages");
 report.counts=counts[0];if(Object.values(report.counts).some(x=>x!==0))throw Error('TEST unexpected QuickBooks data; inspect');
 report.state='deployed_public_guards_verified';
}catch(e){report.state='requires_inspection';report.failure=e instanceof Error&&e.message.startsWith('TEST')?e.message:'TEST runtime unconfirmed; details withheld';process.exitCode=1;}
finally{if(stage)rmSync(stage,{recursive:true,force:true});}
report.completedAt=new Date().toISOString();mkdirSync('.verification-results',{recursive:true,mode:0o700});
writeFileSync(`.verification-results/quickbooks-test-runtime-${Date.now()}.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(report));
