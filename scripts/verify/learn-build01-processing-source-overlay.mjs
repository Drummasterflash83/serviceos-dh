/** Verify current LIVE worker/scheduler/recommendation source from the pinned v107 recovery base plus Git. */
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
const recommendationStage='.verification-results/build01-rec-sweep-live-OhSoce';
const stageManifest=JSON.parse(readFileSync(join(recommendationStage,'manifest.json'),'utf8'));
const compileManifest=JSON.parse(readFileSync(join(recommendationStage,'compile-manifest-network.json'),'utf8'));
if(stageManifest.project!=='tgbnakbxwcqjeimygroz'||stageManifest.label!=='live'||
  compileManifest.label!=='live'||stageManifest.results.length!==2||compileManifest.results.length!==2)
  throw Error('Pinned recommendation release manifest changed');
const token=savedCliToken();
const hash=data=>createHash('sha256').update(data).digest('hex');
const recommendationSource='supabase/functions/_shared/worker_handlers/recommendation_sync.ts';
const recommendationSha='715e062b3770954144d9a95ae1d20b9cadc8ae6cc019b0daa95d3c32eb769efc';
const expected={"platform-worker":{version:111,count:119,stageIndex:0,patches:{
  '_shared/worker_handlers/identity_resolve.ts':[['Math.min(200,','Math.min(50,'],
    ['counts.continued = counts.failed === 0 && rows.length === batch && counts.resolved + counts.reviews_recorded === rows.length;',
      'counts.continued = (payload.limit === undefined || typeof payload.limit === "number" && Number.isInteger(payload.limit) && payload.limit >= 1 && payload.limit <= 50) && counts.failed === 0 && rows.length === batch && counts.resolved + counts.reviews_recorded === rows.length;']],
  '_shared/worker_handlers/business_graph_sync.ts':[
    ['const DEFAULT_LIMIT = 200;','const DEFAULT_LIMIT = 50;'],
    ['const MISSING_INTERACTION_PAGE = 200;','const MISSING_INTERACTION_PAGE = 100;']],
},patchFiles:{
  '_shared/worker_handlers/customer_card_sync.ts':
    'docs/operations/LEARN-BUILD01-CARD-FRESHNESS-V110.patch',
},replacementFiles:{
  '_shared/worker_handlers/recommendation_sync.ts':
    {path:recommendationSource,sha256:recommendationSha},
}},'identity-scheduled-sync':{version:51,count:5,patches:{
  'identity-scheduled-sync/index.ts':[['limit: 200','limit: 50'],
    ['moduleId: "core.identity",','moduleId: "core.identity",\n      priority: 50,']],
}},'recommendation-sync':{version:47,count:6,stageIndex:1,patches:{},replacementFiles:{
  '_shared/worker_handlers/recommendation_sync.ts':
    {path:recommendationSource,sha256:recommendationSha},
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
    const staged=config.stageIndex!==undefined;
    let currentRoot;
    if(staged){
      const entry=stageManifest.results[config.stageIndex];
      const build=compileManifest.results[config.stageIndex];
      const artifact=readFileSync(join(recommendationStage,'artifacts',`${endpoint}.eszip`));
      const response=await fetch(`https://api.supabase.com/v1/projects/${project}/functions/${endpoint}/body`,{
        headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error(`LIVE ${endpoint} executable unavailable`);
      const serving=Buffer.from(await response.arrayBuffer());
      if(entry?.slug!==endpoint||build?.slug!==endpoint||entry.sourceFiles!==config.count||
        hash(artifact)!==build.sha256||hash(serving)!==build.sha256||
        active.ezbr_sha256!==JSON.parse(readFileSync(join(recommendationStage,'deploy-journal.json'),'utf8'))
          .completed[config.stageIndex]?.wireSha256)
        throw Error(`LIVE ${endpoint} executable differs from pinned staged source`);
      currentRoot=join(recommendationStage,endpoint,'stage/supabase/functions');
    }else{
      const download=join(root,endpoint);
      mkdirSync(download);
      const run=spawnSync(cli,['functions','download',endpoint,'--project-ref',project,'--workdir',download],{
        env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});
      if(run.status!==0)throw Error(`LIVE ${endpoint} source download failed`);
      currentRoot=join(download,'supabase/functions',endpoint);
    }
    const priorRoot=join(archive,endpoint,'supabase/functions');
    const currentFiles=walk(currentRoot);
    if(currentFiles.length!==config.count)throw Error(`${endpoint} closure count changed`);
    let patched=0,unchanged=0;
    const manifest=[];
    for(const file of currentFiles){
      const rel=relative(currentRoot,file).replaceAll('\\','/');
      const mapped=staged?rel:(rel.startsWith('functions/')?rel.slice('functions/'.length):`${endpoint}/${rel}`);
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
      const replacement=config.replacementFiles?.[mapped];
      if(replacement){
        const bytes=readFileSync(replacement.path);
        if(hash(bytes)!==replacement.sha256 ||
          hash(reconstructed)!=='254e6fdb5db6eac5bb86a226743c323184df42f86ba4f1fce4178da5eaa35cad')
          throw Error(`${mapped} pinned Git replacement or v107 baseline changed`);
        reconstructed=bytes.toString('utf8');
      }
      const currentHash=hash(readFileSync(file));
      if(hash(reconstructed)!==currentHash)
        throw Error(`${endpoint}:${mapped} retained source hash ${currentHash} differs from reconstructed source ${hash(reconstructed)}`);
      if(before!==hash(reconstructed))patched++;else unchanged++;
      manifest.push({path:mapped,sha256:hash(reconstructed)});
    }
    if(patched!==Object.keys(config.patches).length+Object.keys(config.patchFiles??{}).length+
      Object.keys(config.replacementFiles??{}).length)
      throw Error(`${endpoint} changed-file count differs`);
    const closureSha256=hash(JSON.stringify(manifest.sort((a,b)=>a.path.localeCompare(b.path))));
    if(staged&&closureSha256!==stageManifest.results[config.stageIndex].closureSha256)
      throw Error(`${endpoint} pinned source closure changed`);
    results.push({endpoint,version:config.version,sourceFiles:config.count,
      reconstructedChangedFiles:patched,unchangedFiles:unchanged,
      closureSha256,servingWireSha256:active.ezbr_sha256,
      servingExecutableMatchedPinnedBuild:staged});
  }
}finally{rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify({contract:'learn-build01-processing-source-overlay/1',
  observedAt:new Date().toISOString(),project,
  base:'v107 off-site Edge source package plus Git recommendation handler SHA-256',
  results,sourceReconstructedAndMatchedServing:true,credentialRecoveryProven:false,
  providerRestartProven:false,productionDataWrites:false,privateDataReturned:false}));
