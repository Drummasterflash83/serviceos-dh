/** Reconstruct the candidate from the exact LIVE worker; no hosted mutations.
 * Keep output in the persistent private verification directory, not /tmp.
 */
import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, join, dirname, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { savedCliToken } from './learn-test-readiness.mjs';

const root=resolve(process.argv[2]??''), project='tgbnakbxwcqjeimygroz';
const sourceMapPath=process.argv[3];
if(process.argv.length!==4||!root.startsWith(resolve('.verification-results')+'/')||
 !sourceMapPath||!resolve(sourceMapPath).startsWith(resolve('.verification-results')+'/'))
  throw Error('Fresh private verification directory required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const prior=JSON.parse(readFileSync('supabase/release/learn-worker-throughput/runtime.manifest.json'))
  .targets.find(x=>x.environment==='live');
const specification=JSON.parse(readFileSync('supabase/release/learn-public-slack-observation/manifest.json'));
const image='public.ecr.aws/supabase/edge-runtime:v1.74.3';
const imageId='sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c';
const docker='/usr/local/bin/docker';
if(spawnSync(docker,['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8'}).stdout.trim()!==imageId)
  throw Error('Existing pinned runtime image required');
if(specification.project!==project||sha(readFileSync(specification.source.path))!==specification.source.sha256)
  throw Error('Reviewed schema differs');
const token=savedCliToken();
async function inventory(){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/functions`,{
  headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Runtime inventory HTTP '+r.status);
 const f=(await r.json()).find(x=>x.slug==='platform-worker');
 if(!f||f.version!==prior.version||f.ezbr_sha256!==prior.wireSha256||f.status!=='ACTIVE'||f.verify_jwt!==false)
  throw Error('Observed LIVE worker differs from retained baseline');
 return {name:f.slug,id:f.id,version:f.version,wireSha256:f.ezbr_sha256,verifyJwt:f.verify_jwt};
}
const before=await inventory();
mkdirSync(root,{mode:0o700});
// CLI downloads transpile TypeScript; these cannot be compared byte-for-byte
// with the typed source closure. Bind retained typed sources to the previously
// verified closure and independently read back the exact deployed executable.
const sourceMap=JSON.parse(readFileSync(sourceMapPath));
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/functions/platform-worker/body`,{
 headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Current executable readback HTTP '+response.status);
const deployedArtifact=Buffer.from(await response.arrayBuffer());
if(sha(deployedArtifact)!==prior.eszipSha256||!deployedArtifact.subarray(0,5).equals(Buffer.from('ESZIP')))
 throw Error('Deployed executable differs from retained source provenance');
function closure(base){
 const files=new Map();
 function visit(path){
  if(files.has(path))return;
  if(path.startsWith('/')||path.startsWith('../')||! /\.(ts|js|json)$/.test(path))throw Error('Unexpected dependency path');
  const full=join(base,path);if(lstatSync(full).isSymbolicLink())throw Error('Unexpected dependency symlink');
  const source=readFileSync(full,'utf8');files.set(path,source);
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
  function dep(node){
   if(!ts.isStringLiteral(node))throw Error('Dynamic dependency requires review');
   const s=node.text;
   if(s.startsWith('.'))visit(posix.normalize(posix.join(posix.dirname(path),s)));
   else if(!/^(https:\/\/|npm:|jsr:|node:)/.test(s))throw Error('Unresolved bare dependency');
  }
  function walk(n){
   if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier)dep(n.moduleSpecifier);
   if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)dep(n.arguments[0]);
   ts.forEachChild(n,walk);
  }walk(ast);
 }visit('platform-worker/index.ts');
 return [...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,source])=>({path,source}));
}
// Normalize only the typed files pinned by the prior release, checking every
// byte before dependency traversal. Never recover from unpinned current source.
const normalized=join(root,'normalized');mkdirSync(normalized,{mode:0o700});
for(const file of prior.sourceFiles){
 const locations=[sourceMap[file.path]].filter(p=>typeof p==='string');
 const available=locations.filter(existsSync);
 if(!available.length||available.some(p=>lstatSync(p).isSymbolicLink()||sha(readFileSync(p))!==file.sha256))
  throw Error('Downloaded pinned source missing or different: '+file.path);
 const destination=join(normalized,file.path);mkdirSync(dirname(destination),{recursive:true,mode:0o700});
 writeFileSync(destination,readFileSync(available[0]),{mode:0o600});
}
const original=prior.sourceFiles.map(f=>({path:f.path,source:readFileSync(join(normalized,f.path),'utf8')}))
 .sort((a,b)=>a.path.localeCompare(b.path));
// The pinned bundle also retains the Slack endpoint's three unused modules.
// Verify traversal, but preserve the entire original bundle inventory.
closure(normalized);
if(sha(JSON.stringify(original))!==prior.sourceClosureSha256||original.length!==prior.sourceFiles.length||
 original.some(f=>prior.sourceFiles.find(x=>x.path===f.path)?.sha256!==sha(f.source)))
 throw Error('Downloaded source differs from verified deployment closure');
if(JSON.stringify(await inventory())!==JSON.stringify(before))throw Error('Worker changed during download');
const changed=['_shared/observation_ingest.ts','_shared/worker_handlers/intelligence_ingest.ts','_shared/observation_source_context.ts'];
const candidate=new Map(original.map(f=>[f.path,f.source]));
for(const path of changed)candidate.set(path,readFileSync('supabase/functions/'+path,'utf8'));
const stage=join(root,'stage'),rollbackStage=join(root,'rollback-stage'),artifacts=join(root,'artifacts'),cache=join(root,'cache');
for(const p of [stage,rollbackStage,artifacts,cache])mkdirSync(p,{mode:0o700});
for(const [dir,files]of [[stage,[...candidate].map(([path,source])=>({path,source}))],[rollbackStage,original]]){
 for(const f of files){const p=join(dir,'supabase/functions',f.path);mkdirSync(dirname(p),{recursive:true,mode:0o700});writeFileSync(p,f.source,{mode:0o600});}
 writeFileSync(join(dir,'deno.json'),JSON.stringify({nodeModulesDir:'auto'}),{mode:0o600});
}
const staged=[...candidate].sort(([a],[b])=>a.localeCompare(b)).map(([path,source])=>({path,source}));
closure(join(stage,'supabase/functions'));
if(staged.some(f=>!changed.includes(f.path)&&original.find(x=>x.path===f.path)?.source!==f.source)||
 original.some(f=>!staged.some(x=>x.path===f.path)))throw Error('Unrelated runtime source changed');
const report={state:'building',observedAt:new Date().toISOString(),project,before,image,imageId,
 sourceClosureSha256:sha(JSON.stringify(staged)),changedFiles:changed,
 sourceFiles:staged.map(f=>({path:f.path,sha256:sha(f.source)})),endpoints:[],productionChanged:false,
 hostedTestChanged:false,credentialsMounted:false,providerCalls:0};
writeFileSync(join(artifacts,'platform-worker.rollback.eszip'),deployedArtifact,{mode:0o600});
report.rollback={name:'platform-worker',verifyJwt:false,eszipSha256:sha(deployedArtifact),
 bytes:deployedArtifact.length,sourceClosureSha256:prior.sourceClosureSha256,exactHostedArtifact:true};
const save=()=>writeFileSync(join(root,'build.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});save();
for(const [dir,name]of [[stage,'platform-worker']]){
 const r=spawnSync(docker,['run','--rm','--pull=never','--network','bridge','--memory','768m','--cpus','2',
 '--env','DENO_DIR=/cache','--mount',`type=bind,source=${dir},target=/work`,
 '--mount',`type=bind,source=${artifacts},target=/artifacts`,'--mount',`type=bind,source=${cache},target=/cache`,
 '--workdir','/work',image,'bundle','--entrypoint','/work/supabase/functions/platform-worker/index.ts',
 '--output',`/artifacts/${name}.eszip`,'--checksum','sha256','--timeout','55'],
 {encoding:'utf8',timeout:65000,maxBuffer:4*1024*1024});
 writeFileSync(join(root,name+'.log'),(r.stdout??'')+(r.stderr??''),{mode:0o600});
 if(r.status!==0){report.state='bundle_failed';save();throw Error('Runtime compilation failed: '+name);}
 const bytes=readFileSync(join(artifacts,name+'.eszip'));
 const artifact={name:'platform-worker',verifyJwt:false,eszipSha256:sha(bytes),bytes:bytes.length};
 if(name.endsWith('.rollback'))report.rollback={...artifact,sourceClosureSha256:prior.sourceClosureSha256};
 else report.endpoints.push(artifact);
 save();
}
if(staged.some(f=>readFileSync(join(stage,'supabase/functions',f.path),'utf8')!==f.source)||
 JSON.stringify(await inventory())!==JSON.stringify(before))throw Error('Source or hosted baseline changed during compilation');
report.state='compiled_with_public_dependency_resolution';report.completedAt=new Date().toISOString();save();
console.log(JSON.stringify({state:report.state,baselineVersion:before.version,files:staged.length,
 changedFiles:changed,sourceClosureSha256:report.sourceClosureSha256,exactHostedRollbackRetained:true,productionChanged:false}));
