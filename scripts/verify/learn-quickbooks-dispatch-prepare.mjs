/** Build from the exact recorded LIVE worker closure, preserving unrelated code. */
import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';
import{execFileSync,spawnSync}from'node:child_process';
import{join,dirname,resolve}from'node:path';
import{createHash}from'node:crypto';
import{savedCliToken}from'./learn-test-readiness.mjs';
const root=resolve('.verification-results/quickbooks-dispatch-v77-prepared'),project='tgbnakbxwcqjeimygroz';
if(existsSync(root))throw Error('Preparation already attempted; inspect');mkdirSync(root,{recursive:true,mode:0o700});
const sha=b=>createHash('sha256').update(b).digest('hex'),prior=JSON.parse(readFileSync('supabase/release/learn-worker-throughput/runtime.manifest.json')).targets.find(x=>x.environment==='live'),token=savedCliToken();
async function get(path){const r=await fetch(`https://api.supabase.com/v1/projects/${project}${path}`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Readback '+r.status);return r;}
const inventory=await(await get('/functions')).json(),f=inventory.find(x=>x.slug==='platform-worker');const slack=JSON.parse(readFileSync('supabase/release/learn-public-slack-observation/manifest.json')).runtimeCandidate;const newer=f.version===77&&f.ezbr_sha256==='3ebae05b3eb27b47030b8040290c5ca8cca3f2c53ff83b2e45fa07d6bada8ebe';if((!newer&&(f.version!==prior.version||f.ezbr_sha256!==prior.wireSha256))||f.verify_jwt!==false||f.status!=='ACTIVE')throw Error('LIVE worker changed; preserve current source first');
const artifact=Buffer.from(await(await get('/functions/platform-worker/body')).arrayBuffer());if(sha(artifact)!==(newer?slack.endpoints[0].eszipSha256:prior.eszipSha256))throw Error('Hosted artifact differs');
let files=[];
for(const pinned of prior.sourceFiles){let body;for(const ref of ['e81575a0','origin/codex/learn-v1-test']){try{const b=execFileSync('git',['show',ref+':supabase/functions/'+pinned.path],{stdio:['ignore','pipe','ignore']});if(sha(b)===pinned.sha256){body=b;break;}}catch{}}
 if(!body){const refs=execFileSync('git',['log','--all','--format=%H','--','supabase/functions/'+pinned.path],{encoding:'utf8'}).trim().split('\n');for(const ref of refs){try{const b=execFileSync('git',['show',ref+':supabase/functions/'+pinned.path],{stdio:['ignore','pipe','ignore']});if(sha(b)===pinned.sha256){body=b;break;}}catch{}}}
 if(!body&&pinned.path==='platform-worker/index.ts'){const b=Buffer.from(execFileSync('git',['show','e81575a0:supabase/functions/platform-worker/index.ts'],{encoding:'utf8'}).replace('const DEFAULT_BATCH = 3;','const DEFAULT_BATCH = 10;'));if(sha(b)===pinned.sha256)body=b;}
 if(!body)throw Error('Pinned typed source unavailable: '+pinned.path);files.push({path:pinned.path,source:body.toString()});
}
files.sort((a,b)=>a.path.localeCompare(b.path));if(sha(JSON.stringify(files))!==prior.sourceClosureSha256)throw Error('Original closure differs');
if(newer){const map=new Map(files.map(f=>[f.path,f.source]));for(const path of slack.changedFiles)map.set(path,readFileSync('supabase/functions/'+path,'utf8'));files=[...map].map(([path,source])=>({path,source})).sort((a,b)=>a.path.localeCompare(b.path));if(sha(JSON.stringify(files))!==slack.sourceClosureSha256)throw Error('Newer LIVE typed closure differs');}
const stage=join(root,'stage'),artifacts=join(root,'artifacts'),cache=join(root,'cache');for(const p of [stage,artifacts,cache])mkdirSync(p,{recursive:true,mode:0o700});
writeFileSync(join(artifacts,'platform-worker.rollback.eszip'),artifact,{mode:0o600});
const originalIndex=files.find(x=>x.path==='platform-worker/index.ts').source,needle='    slackEnabled: Deno.env.get("LEARN_SLACK_DISPATCH_ENABLED"),';if(originalIndex.split(needle).length!==2)throw Error('Dispatch anchor differs');
const changed=['platform-worker/index.ts','_shared/learn_input_tick.ts'];
for(const file of files){if(file.path==='platform-worker/index.ts')file.source=originalIndex.replace(needle,needle+'\n    quickbooksEnabled: Deno.env.get("LEARN_QUICKBOOKS_DISPATCH_ENABLED"),\n    quickbooksKey: Deno.env.get("LEARN_QUICKBOOKS_WORKER_KEY"),');if(file.path==='_shared/learn_input_tick.ts')file.source=readFileSync('supabase/functions/'+file.path,'utf8');const path=join(stage,'supabase/functions',file.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,file.source);}
writeFileSync(join(stage,'deno.json'),JSON.stringify({nodeModulesDir:'auto'}));
const report={project,state:'preparing',before:{version:f.version,id:f.id,hash:f.ezbr_sha256},sourceClosureSha256:sha(JSON.stringify(files)),sourceFiles:files.map(x=>({path:x.path,sha256:sha(x.source)})),changedFiles:changed,rollbackEszipSha256:sha(artifact),productionChanges:0};
const save=()=>writeFileSync(join(root,'build.json'),JSON.stringify(report,null,2));save();
const docker='/usr/local/bin/docker',image='public.ecr.aws/supabase/edge-runtime:v1.74.3';
const imageId='sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c';if(spawnSync(docker,['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8'}).stdout.trim()!==imageId)throw Error('Pinned runtime image differs');
const r=spawnSync(docker,['run','--rm','--pull=never','--network','bridge','--memory','768m','--cpus','2','--env','DENO_DIR=/cache','--mount',`type=bind,source=${stage},target=/work`,'--mount',`type=bind,source=${artifacts},target=/artifacts`,'--mount',`type=bind,source=${cache},target=/cache`,'--workdir','/work',image,'bundle','--entrypoint','/work/supabase/functions/platform-worker/index.ts','--output','/artifacts/platform-worker.eszip','--checksum','sha256','--timeout','55'],{encoding:'utf8',timeout:65000,maxBuffer:4194304});
writeFileSync(join(root,'build.log'),(r.stdout??'')+(r.stderr??''));if(r.status!==0){report.state='compile_unconfirmed';save();throw Error('Compilation failed');}
report.eszipSha256=sha(readFileSync(join(artifacts,'platform-worker.eszip')));report.image=image;report.imageId=imageId;report.endpoints=[{name:'platform-worker',eszipSha256:report.eszipSha256,verifyJwt:false}];report.state='compiled_with_public_dependency_resolution';save();console.log(JSON.stringify({state:report.state,root,sourceFiles:files.length,changedFiles:changed,sourceClosureSha256:report.sourceClosureSha256,productionChanges:0}));
