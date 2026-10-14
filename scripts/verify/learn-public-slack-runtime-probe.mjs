/** Reuse the pinned executable runner with the source-proof-specific harness. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
const root=resolve(process.argv[2]??''),sha=b=>createHash('sha256').update(b).digest('hex');
if(process.argv.length!==3||!root.startsWith(resolve('.verification-results')+'/'))throw Error('Private runtime directory required');
const build=JSON.parse(readFileSync(root+'/build.json'));
if(build.state!=='compiled_with_public_dependency_resolution'||build.endpoints.length!==1||
 sha(readFileSync(root+'/artifacts/platform-worker.eszip'))!==build.endpoints[0].eszipSha256)throw Error('Exact executable required');
const docker='/usr/local/bin/docker',name='serviceos-slack-proof-'+randomUUID().slice(0,8);
if(spawnSync(docker,['image','inspect',build.image,'--format','{{.Id}}'],{encoding:'utf8'}).stdout.trim()!==build.imageId)throw Error('Pinned image differs');
const probe=root+'/source-probe';mkdirSync(probe,{mode:0o700});
writeFileSync(probe+'/index.ts',readFileSync(new URL('./learn-public-slack-runtime.probe.ts',import.meta.url)),{mode:0o600});
let created=false,result,logs='';
try{
 const started=spawnSync(docker,['run','-d','--pull=never','--network','none','--name',name,'--memory','1024m','--cpus','2',
  '--mount',`type=bind,source=${root}/artifacts,target=/artifacts,readonly`,'--mount',`type=bind,source=${probe},target=/probe,readonly`,
  build.image,'start','--main-service','/probe'],{encoding:'utf8'});
 if(started.status!==0)throw Error('Probe startup failed');created=true;
 for(let i=0;i<60;i++){
  const r=spawnSync(docker,['logs',name],{encoding:'utf8',maxBuffer:4000000});
  if(r.status!==0)throw Error('Probe log read failed');logs=r.stdout+r.stderr;
  const line=logs.split('\n').find(x=>x.startsWith('WORKER_VERIFY='));
  if(line){result=JSON.parse(line.slice('WORKER_VERIFY='.length));break;}
  if(spawnSync(docker,['inspect','--format','{{.State.Running}}',name],{encoding:'utf8'}).stdout.trim()!=='true')throw Error('Probe stopped');
  await new Promise(r=>setTimeout(r,1000));
 }
 if(result?.state!=='passed')throw Error('Compiled retained-source journey failed');
}finally{
 const removed=created?spawnSync(docker,['rm','-f',name],{encoding:'utf8'}).status===0:true;
 writeFileSync(root+'/source-probe.log',logs,{mode:0o600});
 writeFileSync(root+'/source-probe.json',JSON.stringify({...result,containerRemoved:removed,
  sourceClosureSha256:build.sourceClosureSha256,artifact:build.endpoints[0],harnessSha256:sha(readFileSync(probe+'/index.ts'))},null,2),{mode:0o600});
 if(!removed)throw Error('Probe cleanup unconfirmed');
}
console.log(JSON.stringify(result));
