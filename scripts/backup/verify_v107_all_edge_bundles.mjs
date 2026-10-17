/** Rebuild every exact LIVE v107 Edge tree in isolated local containers.
 * Public dependencies may be fetched; no production endpoint or secret is used.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

if(process.argv.slice(2).join(' ')!=='--rebuild-all-reviewed-v107')
 throw Error('Exact reviewed v107 rebuild mode required');
const root=resolve('.verification-results');
const stage=join(root,'build01-edge-staged-v107');
const output=join(root,'build01-edge-bundles-v107');
const manifestPath=join(root,'build01-runtime-archive-2026-10-16T23-22-48-811Z','manifest.private.json');
const manifestBytes=readFileSync(manifestPath);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestSha='4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488';
assert.equal(sha(manifestBytes),manifestSha,'Reviewed v107 manifest changed');
const manifest=JSON.parse(manifestBytes);
assert.equal(manifest.contract,'build01-live-runtime-archive/1');
assert.equal(manifest.project,'tgbnakbxwcqjeimygroz');
assert.equal(manifest.inventoryStable,true);
assert.equal(manifest.activeFunctions,103);
assert.equal(manifest.entries.length,103);
const summary=JSON.parse(readFileSync(join(stage,'staging-summary.json')));
assert.equal(summary.sourceManifestSha256,manifestSha);
assert.equal(summary.functions,103);
assert.equal(summary.files,728);
const stagedPath=(slug,name)=>{
 const bits=name.split('/');
 assert(bits.every(bit=>bit && bit!=='.' && bit!=='..'),'Invalid source path');
 if(bits[0]==='functions')return join(stage,slug,'supabase',name);
 if(bits[0]==='work'&&bits[1]==='supabase')return join(stage,slug,...bits.slice(1));
 if(bits.length===1)return join(stage,slug,'supabase','functions',slug,name);
 throw Error('Unrecognised reviewed source path');
};
let fileCount=0;
for(const entry of manifest.entries){
 assert.match(entry.slug,/^[a-z0-9][a-z0-9-]{0,80}$/);
 for(const file of entry.files){
  const bytes=readFileSync(stagedPath(entry.slug,file.path));
  assert.equal(bytes.length,file.bytes);
  assert.equal(sha(bytes),file.sha256,'Staged source differs from reviewed LIVE manifest');
  fileCount++;
 }
 assert(existsSync(join(stage,entry.slug,'supabase','functions',entry.slug,'index.ts')));
}
assert.equal(fileCount,728);
mkdirSync(output,{recursive:true,mode:0o700});
const image='sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c';
const results=[];
const entries=[...manifest.entries];
async function build(entry){
 const slug=entry.slug;
 const out=join(output,`${slug}.eszip`);
 const log=join(output,`${slug}.log`);
 rmSync(out,{force:true});
 const args=['run','--rm','--pull=never','--network','bridge','--memory','768m','--cpus','2',
  '--mount',`type=bind,source=${join(stage,slug)},target=/work,readonly`,
  '--mount',`type=bind,source=${output},target=/out`,
  '--workdir','/work',image,'bundle','--entrypoint',
  `/work/supabase/functions/${slug}/index.ts`,'--output',`/out/${slug}.eszip`,
  '--checksum','sha256','--timeout','55'];
 const started=Date.now();
 const run=await new Promise(resolveRun=>{
  const child=spawn('/usr/local/bin/docker',args,{stdio:['ignore','pipe','pipe']});
  let data='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
   if(data.length<262144)data+=chunk.toString().slice(0,262144-data.length);
  });
  const timer=setTimeout(()=>child.kill('SIGKILL'),65000);
  child.on('error',error=>{clearTimeout(timer);resolveRun({code:-1,data:String(error)});});
  child.on('close',code=>{clearTimeout(timer);resolveRun({code,data});});
 });
 writeFileSync(log,run.data,{mode:0o600});
 const ok=run.code===0&&existsSync(out)&&statSync(out).size>0;
 if(!ok)rmSync(out,{force:true});
 return {slug,state:ok?'bundled':'failed',bytes:ok?statSync(out).size:null,
  sha256:ok?sha(readFileSync(out)):null,durationMs:Date.now()-started};
}
async function worker(){
 while(entries.length){
  const entry=entries.shift();
  const result=await build(entry);
  results.push(result);
  if(results.length%10===0||results.length===manifest.entries.length)
   console.log(JSON.stringify({completed:results.length,total:manifest.entries.length,
    failed:results.filter(row=>row.state==='failed').length}));
 }
}
await Promise.all([worker(),worker(),worker()]);
results.sort((a,b)=>a.slug.localeCompare(b.slug));
const report={contract:'learn-build01-edge-v107-all-bundles/1',
 observedAt:new Date().toISOString(),sourceManifestSha256:manifestSha,
 functionCount:manifest.entries.length,sourceFileCount:fileCount,
 bundledCount:results.filter(row=>row.state==='bundled').length,
 failed:results.filter(row=>row.state==='failed').map(row=>row.slug),
 imageId:image,network:'public_dependency_resolution_only',
 runtimeSecretsMounted:false,productionWrites:false,sourceProviderWrites:false,
 isolatedStartupVerified:false,fullApplicationAuthRecoveryVerified:false,
 results};
writeFileSync(join(output,'report.private.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({state:report.failed.length?'bundle_failures':'all_function_bundles_verified',
 functionCount:report.functionCount,bundledCount:report.bundledCount,failed:report.failed,
 sourceManifestSha256:manifestSha,productionWrites:false,
 fullApplicationAuthRecoveryVerified:false}));
if(report.failed.length)process.exitCode=1;
