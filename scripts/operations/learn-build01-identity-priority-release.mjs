/** Pin and release only the installed identity scheduler's queue priority. */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { savedCliToken, TEST_PROJECT } from '../verify/learn-test-readiness.mjs';

const mode=process.argv.slice(2).join(' ');
if(!['--plan-test','--deploy-test','--plan-live','--deploy-live'].includes(mode))
  throw Error('Exact release mode required');
const isTest=mode.endsWith('test');
const deploy=mode.startsWith('--deploy-');
const project=isTest?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
const endpoint='identity-scheduled-sync';
const expectedIndex='96894e4a0d54bc52e85c3ae11207924ac1cb363dfbc958e772a3979f4162fbcd';
const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const hash=data=>createHash('sha256').update(data).digest('hex');
const token=savedCliToken();
const base=`https://api.supabase.com/v1/projects/${project}/functions`;
async function inventory(){
  const response=await fetch(base,{headers:{Authorization:`Bearer ${token}`},
    redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Edge inventory unavailable');
  const rows=await response.json();
  if(!Array.isArray(rows)||new Set(rows.map(r=>r.slug)).size!==rows.length)
    throw Error('Edge inventory changed');
  return rows;
}
const before=await inventory();
const prior=before.find(r=>r.slug===endpoint);
if(!prior||prior.status!=='ACTIVE'||prior.verify_jwt!==false)
  throw Error('Installed identity scheduler is not active with the expected auth mode');
const body=await fetch(`${base}/${endpoint}/body`,{headers:{Authorization:`Bearer ${token}`},
  redirect:'error',signal:AbortSignal.timeout(30000)});
if(!body.ok)throw Error('Installed Edge executable unavailable');
const rollback=Buffer.from(await body.arrayBuffer());
if(!rollback.subarray(0,5).equals(Buffer.from('ESZIP')))
  throw Error('Installed executable invalid');
const root=mkdtempSync(join(tmpdir(),`learn-identity-priority-${isTest?'test':'live'}-`));
const download=join(root,'download'),stage=join(root,'stage');
mkdirSync(download);
const fetched=spawnSync(cli,['functions','download',endpoint,'--project-ref',project,'--workdir',download],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});
if(fetched.status!==0)throw Error('Exact installed identity source download failed');
const sourceRoot=join(download,'supabase/functions',endpoint);
function walk(dir){return readdirSync(dir).flatMap(name=>{const p=join(dir,name);
  return statSync(p).isDirectory()?walk(p):[p];});}
const files=walk(sourceRoot);
if(files.length!==5)throw Error('Installed identity closure changed');
const changed=[],manifest=[];
for(const path of files){
  const rel=relative(sourceRoot,path).replaceAll('\\','/');
  const mapped=rel==='index.ts'?`${endpoint}/index.ts`:
    rel.startsWith('functions/_shared/')?rel.slice('functions/'.length):null;
  if(!mapped||!/\.ts$/.test(mapped)||mapped.includes('..'))
    throw Error('Unexpected installed identity source path');
  let source=readFileSync(path,'utf8');
  const original=hash(source);
  if(mapped===`${endpoint}/index.ts`){
    const anchor='moduleId: "core.identity",';
    if(original!==expectedIndex||source.split(anchor).length!==2)
      throw Error('Installed identity scheduler baseline changed');
    source=source.replace(anchor,anchor+'\n      priority: 50,');
  }
  if(hash(source)!==original)changed.push(mapped);
  const target=join(stage,'supabase/functions',mapped);
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source,{mode:0o600});
  manifest.push({path:mapped,originalSha256:original,candidateSha256:hash(source)});
}
if(JSON.stringify(changed)!==JSON.stringify([`${endpoint}/index.ts`]))
  throw Error('Targeted scheduler change set differs');
const parsed=ts.createSourceFile('index.ts',readFileSync(join(stage,'supabase/functions',endpoint,'index.ts'),'utf8'),ts.ScriptTarget.Latest,true);
if(parsed.parseDiagnostics.length)throw Error('Candidate scheduler syntax invalid');
writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${project}"\n[functions.${endpoint}]\nverify_jwt = false\n`,{mode:0o600});
const candidateSha256=hash(JSON.stringify(manifest.map(r=>[r.path,r.candidateSha256]).sort((a,b)=>a[0].localeCompare(b[0]))));
const report={project,endpoint,beforeVersion:prior.version,files:manifest.length,
  candidateSha256,changedPaths:changed,changedIndexSha256:manifest.find(r=>r.path===`${endpoint}/index.ts`)?.candidateSha256,
  rollbackSha256:hash(rollback),productionDataWrites:false};
if(!deploy){console.log(JSON.stringify({state:'reviewed_no_deployment',...report}));process.exit(0);}
if(!isTest){
  const tested=JSON.parse(readFileSync('.verification-results/build01-identity-priority-test.json','utf8'));
  if(tested.state!=='deployed_needs_hosted_acceptance'||
    tested.changedIndexSha256!==report.changedIndexSha256)
    throw Error('LIVE scheduler index differs from TEST release');
  const currentTest=(await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`,{
    headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)}).then(r=>{
      if(!r.ok)throw Error('TEST scheduler inventory unavailable');return r.json();
    })).find(r=>r.slug===endpoint);
  if(currentTest?.version!==tested.afterVersion||
    currentTest?.ezbr_sha256!==tested.afterWireSha256||currentTest?.status!=='ACTIVE')
    throw Error('TEST scheduler release changed');
}
const resultPath=`.verification-results/build01-identity-priority-${isTest?'test':'live'}.json`;
const rollbackPath=`.verification-results/build01-identity-priority-${isTest?'test':'live'}-rollback.eszip`;
writeFileSync(rollbackPath,rollback,{flag:'wx',mode:0o600});
const deployed=spawnSync(cli,['functions','deploy',endpoint,'--project-ref',project,'--use-api','--workdir',stage],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2097152});
const after=await inventory(),current=after.find(r=>r.slug===endpoint);
const others=rows=>JSON.stringify(rows.filter(r=>r.slug!==endpoint)
  .map(r=>[r.slug,r.version,r.ezbr_sha256]).sort((a,b)=>a[0].localeCompare(b[0])));
const okay=deployed.status===0&&current?.version===prior.version+1&&
  current?.status==='ACTIVE'&&current?.verify_jwt===false&&
  current?.ezbr_sha256!==prior.ezbr_sha256&&others(after)===others(before);
const result={state:okay?'deployed_needs_hosted_acceptance':'requires_inspection',...report,
  afterVersion:current?.version??null,afterWireSha256:current?.ezbr_sha256??null,
  otherEndpointsUnchanged:others(after)===others(before),cliStatus:deployed.status};
writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));
if(!okay)process.exitCode=1;
