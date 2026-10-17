/** Verify current LIVE worker/scheduler source from the pinned v107 recovery base. */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { savedCliToken } from './learn-test-readiness.mjs';

if(process.argv.slice(2).join(' ')!=='--live-read-only')
  throw Error('Exact LIVE read-only mode required');
const project='tgbnakbxwcqjeimygroz';
const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const archive='.verification-results/build01-edge-staged-v107';
const token=savedCliToken();
const hash=data=>createHash('sha256').update(data).digest('hex');
const expected={"platform-worker":{version:110,count:119,patches:{
  '_shared/worker_handlers/identity_resolve.ts':[['Math.min(200,','Math.min(50,'],
    ['counts.continued = counts.failed === 0 && rows.length === batch && counts.resolved + counts.reviews_recorded === rows.length;',
      'counts.continued = (payload.limit === undefined || typeof payload.limit === "number" && Number.isInteger(payload.limit) && payload.limit >= 1 && payload.limit <= 50) && counts.failed === 0 && rows.length === batch && counts.resolved + counts.reviews_recorded === rows.length;']],
  '_shared/worker_handlers/business_graph_sync.ts':[
    ['const DEFAULT_LIMIT = 200;','const DEFAULT_LIMIT = 50;'],
    ['const MISSING_INTERACTION_PAGE = 200;','const MISSING_INTERACTION_PAGE = 100;']],
},patchFiles:{
  '_shared/worker_handlers/customer_card_sync.ts':
    'docs/operations/LEARN-BUILD01-CARD-FRESHNESS-V110.patch',
}},'identity-scheduled-sync':{version:51,count:5,patches:{
  'identity-scheduled-sync/index.ts':[['limit: 200','limit: 50'],
    ['moduleId: "core.identity",','moduleId: "core.identity",\n      priority: 50,']],
}}};
const inventoryResponse=await fetch(`https://api.supabase.com/v1/projects/${project}/functions`,{
  headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
if(!inventoryResponse.ok)throw Error('LIVE Edge inventory unavailable');
const inventory=await inventoryResponse.json();
const root=mkdtempSync(join(tmpdir(),'learn-processing-recovery-overlay-'));
function walk(dir){return readdirSync(dir).flatMap(name=>{const path=join(dir,name);
  return statSync(path).isDirectory()?walk(path):[path];});}
const results=[];
try{
  for(const [endpoint,config] of Object.entries(expected)){
    const active=inventory.find(r=>r.slug===endpoint);
    if(active?.version!==config.version||active.status!=='ACTIVE')
      throw Error(`LIVE ${endpoint} version changed`);
    const download=join(root,endpoint);
    mkdirSync(download);
    const run=spawnSync(cli,['functions','download',endpoint,'--project-ref',project,'--workdir',download],{
      env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});
    if(run.status!==0)throw Error(`LIVE ${endpoint} source download failed`);
    const currentRoot=join(download,'supabase/functions',endpoint);
    const priorRoot=join(archive,endpoint,'supabase/functions');
    const currentFiles=walk(currentRoot);
    if(currentFiles.length!==config.count)throw Error(`${endpoint} closure count changed`);
    let patched=0,unchanged=0;
    const manifest=[];
    for(const file of currentFiles){
      const rel=relative(currentRoot,file).replaceAll('\\','/');
      const mapped=rel.startsWith('functions/')?rel.slice('functions/'.length):`${endpoint}/${rel}`;
      let reconstructed=readFileSync(join(priorRoot,mapped),'utf8');
      const before=hash(reconstructed);
      for(const [needle,replacement] of config.patches[mapped]??[]){
        if(reconstructed.split(needle).length!==2)throw Error(`${mapped} archive anchor changed`);
        reconstructed=reconstructed.replace(needle,replacement);
      }
      const patchFile=config.patchFiles?.[mapped];
      if(patchFile){
        const target=join(root,'reconstructed-card-handler.ts');
        writeFileSync(target,reconstructed,{mode:0o600});
        const applied=spawnSync('patch',[target],{
          input:readFileSync(patchFile),encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
        if(applied.status!==0)throw Error(`${mapped} exact source patch failed`);
        reconstructed=readFileSync(target,'utf8');
      }
      if(hash(reconstructed)!==hash(readFileSync(file)))
        throw Error(`${mapped} source differs from pinned recovery overlay`);
      if(before!==hash(reconstructed))patched++;else unchanged++;
      manifest.push([mapped,hash(reconstructed)]);
    }
    if(patched!==Object.keys(config.patches).length+Object.keys(config.patchFiles??{}).length)
      throw Error(`${endpoint} changed-file count differs`);
    results.push({endpoint,version:config.version,sourceFiles:config.count,
      reconstructedChangedFiles:patched,unchangedFiles:unchanged,
      closureSha256:hash(JSON.stringify(manifest.sort((a,b)=>a[0].localeCompare(b[0])))),
      servingWireSha256:active.ezbr_sha256});
  }
}finally{rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify({contract:'learn-build01-processing-source-overlay/1',
  observedAt:new Date().toISOString(),project,base:'v107 off-site Edge source package',
  results,sourceReconstructedAndMatchedServing:true,credentialRecoveryProven:false,
  providerRestartProven:false,productionDataWrites:false,privateDataReturned:false}));
