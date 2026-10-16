/** Targeted, baseline-checked card revision-conflict overlay: TEST before LIVE. */
import { spawnSync } from 'node:child_process';
import { existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { savedCliToken,TEST_PROJECT } from './learn-test-readiness.mjs';
import { CARD_WORKER_BASELINE_SHA,patchDeployedCardHandler,sha256 } from './learn-build01-card-deployed-overlay.mjs';

const LIVE_PROJECT='tgbnakbxwcqjeimygroz';
const mode=process.argv.slice(2).join(' ');
const config=mode==='--test --existing-cli-login'
 ?{label:'test',project:TEST_PROJECT,expectedVersion:57}
 :mode==='--live --existing-cli-login'
 ?{label:'live',project:LIVE_PROJECT,expectedVersion:97}:null;
if(!config||(config.label==='test'?process.env.LEARN_TEST_ALLOW_PROJECT_REF:
  process.env.LEARN_LIVE_ALLOW_PROJECT_REF)!==config.project)
  throw Error('Exact TEST or LIVE worker deployment allowlist required');
const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const endpoint='platform-worker', expectedVersion=config.expectedVersion;
const expectedWire='b08c830f6e5d3861280f17ecae2f9868ebc593467c15f587f2744c18bc6958a3';
const prefix=`.verification-results/build01-card-revision-${config.label}`;
if(existsSync(prefix+'-journal.json')||existsSync(prefix+'-result.json'))
  throw Error('Prior card worker release requires inspection');
const token=savedCliToken();
async function inventory(){
 const res=await fetch(`https://api.supabase.com/v1/projects/${config.project}/functions`,{
  headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!res.ok)throw Error('Target runtime inventory unavailable');
 const rows=await res.json();if(!Array.isArray(rows))throw Error('Target runtime inventory invalid');
 return rows;
}
if(config.label==='live'){
 const test=JSON.parse(readFileSync('.verification-results/build01-card-revision-test-result.json','utf8'));
 const hosted=JSON.parse(readFileSync('.verification-results/build01-card-revision-hosted-result.json','utf8'));
 const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`,{
  headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('TEST acceptance inventory unavailable');
 const testWorker=(await response.json()).find(f=>f.slug===endpoint);
 if(test.state!=='deployed_needs_hosted_acceptance'||hosted.state!=='test_hosted_card_projection_verified'||
  hosted.fixtureArchived!==true||testWorker?.version!==test.afterVersion||
  testWorker?.ezbr_sha256!==test.afterWire)
  throw Error('Exact TEST card release or hosted acceptance changed');
}
const before=await inventory();
const prior=before.find(f=>f.slug===endpoint);
if(prior?.version!==expectedVersion||prior?.ezbr_sha256!==expectedWire||
  prior?.status!=='ACTIVE'||prior?.verify_jwt!==false)
  throw Error('Exact target worker baseline changed');
const other=rows=>rows.filter(f=>f.slug!==endpoint).map(f=>[f.slug,f.version,f.ezbr_sha256,f.verify_jwt])
  .sort((a,b)=>a[0].localeCompare(b[0]));
const body=await fetch(`https://api.supabase.com/v1/projects/${config.project}/functions/${endpoint}/body`,{
 headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
if(!body.ok)throw Error('Target rollback executable unavailable');
const rollback=Buffer.from(await body.arrayBuffer());
if(!rollback.subarray(0,5).equals(Buffer.from('ESZIP')))throw Error('Target rollback executable invalid');
writeFileSync(prefix+'-rollback.eszip',rollback,{flag:'wx',mode:0o600});
const work=mkdtempSync(join(tmpdir(),'build01-card-worker-stage-'));
let candidateSha=null,changed=0,files=0,cliStatus=null;
try{
 const download=join(work,'download');mkdirSync(download,{mode:0o700});
 const fetched=spawnSync(cli,['functions','download',endpoint,'--project-ref',config.project,'--workdir',download],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:1048576});
 if(fetched.status!==0)throw Error('Target worker source download unconfirmed');
 const sourceRoot=join(download,'supabase/functions',endpoint);
 const entries=readdirSync(sourceRoot,{recursive:true}).filter(p=>statSync(join(sourceRoot,p)).isFile());
 if(entries.length<50||entries.length>200)throw Error('Target worker source closure changed');
 const stage=join(work,'stage'),manifest=[];
 for(const entry of entries){
  if(!/\.(ts|js|json)$/.test(entry)||entry.includes('..'))throw Error('Unexpected source path');
  const rel=entry.startsWith('functions/')?entry.slice('functions/'.length):`${endpoint}/${entry}`;
  const target=join(stage,'supabase/functions',rel);
  mkdirSync(dirname(target),{recursive:true,mode:0o700});
  let source=readFileSync(join(sourceRoot,entry),'utf8');
  if(rel==='_shared/worker_handlers/customer_card_sync.ts'){
   if(sha256(source)!==CARD_WORKER_BASELINE_SHA)throw Error('Target card handler changed');
   source=patchDeployedCardHandler(source);changed++;
  }
  writeFileSync(target,source,{mode:0o600});
  manifest.push({path:rel,sha256:sha256(source)});
 }
 if(changed!==1||new Set(manifest.map(x=>x.path)).size!==manifest.length)
  throw Error('Targeted source mapping changed');
 files=manifest.length;
 candidateSha=sha256(JSON.stringify(manifest.sort((a,b)=>a.path.localeCompare(b.path))));
 if(config.label==='live'){
  const test=JSON.parse(readFileSync('.verification-results/build01-card-revision-test-result.json','utf8'));
  if(candidateSha!==test.candidateSha256)throw Error('LIVE closure differs from tested candidate');
 }
 writeFileSync(join(stage,'supabase/config.toml'),
  `project_id = "${config.project}"\n[functions.${endpoint}]\nverify_jwt = false\n`,{mode:0o600});
 writeFileSync(prefix+'-journal.json',JSON.stringify({state:'prepared',project:config.project,
  beforeVersion:prior.version,beforeWire:prior.ezbr_sha256,rollbackSha256:sha256(rollback),
  candidateSha256:candidateSha,changedSourcePaths:['_shared/worker_handlers/customer_card_sync.ts'],
  files,otherEndpoints:other(before)},null,2)+'\n',{flag:'wx',mode:0o600});
 const deployed=spawnSync(cli,['functions','deploy',endpoint,'--project-ref',config.project,'--use-api','--workdir',stage],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2097152});
 cliStatus=deployed.status;
}finally{rmSync(work,{recursive:true,force:true});}
const after=await inventory(),now=after.find(f=>f.slug===endpoint);
const passed=cliStatus===0&&now?.version===expectedVersion+1&&now.status==='ACTIVE'&&
 now.verify_jwt===false&&now.ezbr_sha256!==expectedWire&&
 JSON.stringify(other(before))===JSON.stringify(other(after));
const result={state:passed?(config.label==='test'?'deployed_needs_hosted_acceptance':'deployed_needs_live_readback'):'requires_inspection',
 project:config.project,beforeVersion:expectedVersion,afterVersion:now?.version??null,
 beforeWire:expectedWire,afterWire:now?.ezbr_sha256??null,candidateSha256:candidateSha,
 files,changedSourcePaths:['_shared/worker_handlers/customer_card_sync.ts'],
 otherEndpointsUnchanged:JSON.stringify(other(before))===JSON.stringify(other(after)),cliStatus,
 productionChanged:config.label==='live',providerRequests:0};
writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));
if(!passed)process.exitCode=1;
