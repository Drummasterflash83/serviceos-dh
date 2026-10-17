/** Let legacy 200-request identity jobs settle a bounded 50-row attempt. */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { savedCliToken, TEST_PROJECT } from '../verify/learn-test-readiness.mjs';

const mode=process.argv.slice(2).join(' ');
if(!['--plan-test','--deploy-test','--plan-live','--deploy-live'].includes(mode))
  throw Error('Exact worker release mode required');
const isTest=mode.endsWith('test'),deploy=mode.startsWith('--deploy-');
const project=isTest?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
const endpoint='platform-worker';
const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const hash=data=>createHash('sha256').update(data).digest('hex');
const target={
  '_shared/worker_handlers/identity_resolve.ts':{
    before:'549de3ebbb029f7653a57122f648f491b9c9f3697604a3a5e567752aba41312a',
    replacements:[[
      'counts.continued = counts.failed === 0 && rows.length === batch && counts.resolved + counts.reviews_recorded === rows.length;',
      'counts.continued = (payload.limit === undefined || (typeof payload.limit === "number" && Number.isInteger(payload.limit) && payload.limit >= 1 && payload.limit <= 50)) && counts.failed === 0 && rows.length === batch && counts.resolved + counts.reviews_recorded === rows.length;'
    ]],
  },
};
const token=savedCliToken(),base=`https://api.supabase.com/v1/projects/${project}/functions`;
async function inventory(){
  const response=await fetch(base,{headers:{Authorization:`Bearer ${token}`},
    redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Worker inventory unavailable');
  const rows=await response.json();
  if(!Array.isArray(rows)||new Set(rows.map(r=>r.slug)).size!==rows.length)
    throw Error('Worker inventory changed');
  return rows;
}
const before=await inventory(),prior=before.find(r=>r.slug===endpoint);
if(!prior||prior.status!=='ACTIVE'||prior.verify_jwt!==false)
  throw Error('Installed worker state changed');
const body=await fetch(`${base}/${endpoint}/body`,{headers:{Authorization:`Bearer ${token}`},
  redirect:'error',signal:AbortSignal.timeout(30000)});
if(!body.ok)throw Error('Installed worker executable unavailable');
const rollback=Buffer.from(await body.arrayBuffer());
if(!rollback.subarray(0,5).equals(Buffer.from('ESZIP')))
  throw Error('Installed worker executable invalid');
const root=mkdtempSync(join(tmpdir(),`learn-legacy-identity-${isTest?'test':'live'}-`));
const download=join(root,'download'),stage=join(root,'stage');mkdirSync(download);
const fetched=spawnSync(cli,['functions','download',endpoint,'--project-ref',project,'--workdir',download],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});
if(fetched.status!==0)throw Error('Exact installed worker source download failed');
const sourceRoot=join(download,'supabase/functions',endpoint);
function walk(dir){return readdirSync(dir).flatMap(name=>{const p=join(dir,name);
  return statSync(p).isDirectory()?walk(p):[p];});}
const files=walk(sourceRoot);
if(files.length!==119)throw Error('Installed worker closure changed');
const manifest=[],changed=[];
for(const path of files){
  const rel=relative(sourceRoot,path).replaceAll('\\','/');
  const mapped=rel.startsWith('functions/')?rel.slice('functions/'.length):`${endpoint}/${rel}`;
  if(!/\.(ts|js|json)$/.test(mapped)||mapped.includes('..'))
    throw Error('Unexpected worker source path');
  let source=readFileSync(path,'utf8');
  const original=hash(source),t=target[mapped];
  if(t){
    if(original!==t.before)throw Error(`Installed ${mapped} baseline changed`);
    for(const [needle,replacement] of t.replacements){
      if(source.split(needle).length!==2)throw Error(`Installed ${mapped} anchor changed`);
      source=source.replace(needle,replacement);
    }
    if(ts.createSourceFile(mapped,source,ts.ScriptTarget.Latest,true).parseDiagnostics.length)
      throw Error(`Candidate ${mapped} syntax invalid`);
  }
  if(hash(source)!==original)changed.push(mapped);
  const dest=join(stage,'supabase/functions',mapped);
  mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,source,{mode:0o600});
  manifest.push({path:mapped,sha256:hash(source)});
}
if(JSON.stringify(changed.sort())!==JSON.stringify(Object.keys(target).sort())||
  new Set(manifest.map(r=>r.path)).size!==119)
  throw Error('Worker candidate changes or closure differ');
writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${project}"\n[functions.${endpoint}]\nverify_jwt = false\n`,{mode:0o600});
const candidateSha256=hash(JSON.stringify(manifest.sort((a,b)=>a.path.localeCompare(b.path))));
const report={project,endpoint,beforeVersion:prior.version,beforeWireSha256:prior.ezbr_sha256,
  sourceFiles:manifest.length,candidateSha256,changedPaths:changed,
  rollbackSha256:hash(rollback),productionDataWrites:false};
const prefix=`.verification-results/build01-legacy-identity-${isTest?'test':'live'}`;
const planPath=`${prefix}-plan.json`;
if(!deploy){
  writeFileSync(planPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({state:'reviewed_no_deployment',...report}));process.exit(0);
}
const plan=JSON.parse(readFileSync(planPath,'utf8'));
if(plan.project!==project||plan.beforeVersion!==prior.version||
  plan.beforeWireSha256!==prior.ezbr_sha256||plan.candidateSha256!==candidateSha256)
  throw Error('Reviewed worker plan changed');
if(!isTest){
  const tested=JSON.parse(readFileSync('.verification-results/build01-legacy-identity-test-result.json','utf8'));
  if(tested.state!=='deployed_needs_hosted_acceptance'||
    tested.candidateSha256!==candidateSha256)
    throw Error('LIVE worker differs from reviewed TEST candidate');
  const currentTest=(await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`,{
    headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)}).then(r=>{
      if(!r.ok)throw Error('TEST release readback unavailable');return r.json();
    })).find(r=>r.slug===endpoint);
  if(currentTest?.version!==tested.afterVersion||
    currentTest?.ezbr_sha256!==tested.afterWireSha256||currentTest?.status!=='ACTIVE')
    throw Error('Verified TEST worker changed');
}
writeFileSync(`${prefix}-rollback.eszip`,rollback,{flag:'wx',mode:0o600});
const result=spawnSync(cli,['functions','deploy',endpoint,'--project-ref',project,'--use-api','--workdir',stage],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2097152});
const after=await inventory(),current=after.find(r=>r.slug===endpoint);
const others=rows=>JSON.stringify(rows.filter(r=>r.slug!==endpoint)
  .map(r=>[r.slug,r.version,r.ezbr_sha256]).sort((a,b)=>a[0].localeCompare(b[0])));
const okay=result.status===0&&current?.version===prior.version+1&&
  current?.status==='ACTIVE'&&current?.verify_jwt===false&&
  current?.ezbr_sha256!==prior.ezbr_sha256&&others(after)===others(before);
const receipt={state:okay?'deployed_needs_hosted_acceptance':'requires_inspection',...report,
  afterVersion:current?.version??null,afterWireSha256:current?.ezbr_sha256??null,
  otherEndpointsUnchanged:others(after)===others(before),cliStatus:result.status};
writeFileSync(`${prefix}-result.json`,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(receipt));if(!okay)process.exitCode=1;
