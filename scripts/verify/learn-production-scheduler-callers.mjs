/** Positive/negative HTTP caller checks against exact compiled scheduler artifacts.
 * Network-isolated loopback database fixture, not hosted gateway/database proof. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve('.'),source=resolve(process.argv[2]??''),output=resolve(process.argv[3]??'');
if(![source,output].every(p=>p.startsWith(join(root,'.verification-results')+'/')))throw Error('Private artifact and new output paths required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const report=JSON.parse(readFileSync(join(source,'report.json'))),manifestBytes=readFileSync('supabase/release/learn-production/runtime-candidate.manifest.json'),manifest=JSON.parse(manifestBytes);
const endpoints=[{name:'customer-card-scheduled-sync',secret:'CARD_SYNC_SECRET',kind:'customer_card.sync',module:'core.customer_card',connector:'openfolk-core'},
{name:'identity-scheduled-sync',secret:'IDENTITY_SYNC_SECRET',kind:'identity.resolve',module:'core.identity',connector:'openfolk-core'},
{name:'interactions-scheduled-sync',secret:'SIGNAL_SYNC_SECRET',kind:'interactions.sync',module:'core.interactions',connector:'openfolk-core'},
{name:'phone-processing-scheduled-sync',secret:'PHONE_PROCESSING_SECRET',kind:'phone.process_pending',module:'communications.phone',connector:'simwood'}];
if(report.state!=='all_candidate_endpoints_bundled'||report.manifestSha256!==sha(manifestBytes)||report.sourceClosureSha256!==manifest.sourceClosureSha256||
 endpoints.some(e=>sha(readFileSync(join(source,'artifacts',e.name+'.eszip')))!==report.endpoints.find(r=>r.name===e.name)?.eszipSha256))throw Error('Exact accepted artifacts required');
const docker='/usr/local/bin/docker',image=report.image;
if(spawnSync(docker,['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8'}).stdout.trim()!==report.imageId)throw Error('Pinned runtime image required');
mkdirSync(output,{mode:0o700});
const harness=readFileSync('scripts/verify/learn-production-scheduler-caller.fixture.ts');
writeFileSync(join(output,'index.ts'),harness,{mode:0o600});writeFileSync(join(output,'config.json'),JSON.stringify({endpoints}),{mode:0o600});
const name='serviceos-scheduler-callers-'+randomUUID().slice(0,8);let created=false,logs='',seen=0;
const result={version:'learn-production-scheduler-callers/1',state:'running',startedAt:new Date().toISOString(),
 manifestSha256:sha(manifestBytes),sourceClosureSha256:report.sourceClosureSha256,harnessSha256:sha(harness),
 artifacts:endpoints.map(e=>({name:e.name,sha256:report.endpoints.find(r=>r.name===e.name).eszipSha256})),
 imageId:report.imageId,network:'none',publishedPorts:false,realCredentials:false,customerData:false,productionChanges:0,containerRemoved:false,checks:[],
 limitations:['Exact executable HTTP auth/enqueue checks against a synthetic loopback database. No Supabase gateway or real database/provider execution.',
 'Four production schedulers only; signed-in users and remaining scheduled/worker callers require separate acceptance.']};
try {
 const run=spawnSync(docker,['run','-d','--pull=never','--network','none','--memory','768m','--cpus','2','--name',name,
 '--mount',`type=bind,source=${join(source,'artifacts')},target=/artifacts,readonly`,
 '--mount',`type=bind,source=${output},target=/probe,readonly`,image,'start','--main-service','/probe'],{encoding:'utf8'});
 if(run.status!==0)throw Error('Caller probe container did not start');created=true;
 const deadline=Date.now()+240000;
 while(Date.now()<deadline){const read=spawnSync(docker,['logs',name],{encoding:'utf8',maxBuffer:8*1024*1024});if(read.status!==0)throw Error('Caller log read failed');logs=read.stdout+read.stderr;
 result.checks=logs.split('\n').filter(l=>l.startsWith('SCHEDULER_CASE=')).map(l=>JSON.parse(l.slice('SCHEDULER_CASE='.length)));
 if(result.checks.length!==seen){seen=result.checks.length;console.log(JSON.stringify({checked:seen,total:28}));}
 if(logs.includes('SCHEDULER_CALLERS_DONE'))break;
 const live=spawnSync(docker,['inspect','--format','{{.State.Running}}',name],{encoding:'utf8'});if(live.status!==0||live.stdout.trim()!=='true')throw Error('Caller probe stopped early');
 await new Promise(r=>setTimeout(r,1000));}
 result.state=result.checks.length===28&&result.checks.every(c=>c.passed)?'scheduler_callers_verified_offline':'scheduler_callers_failed';
 if(result.state==='scheduler_callers_failed')process.exitCode=1;
}catch(error){result.state='scheduler_probe_failed';result.error=error.message;process.exitCode=1;}
finally {if(created)result.containerRemoved=spawnSync(docker,['rm','-f',name],{encoding:'utf8'}).status===0;
 if(!result.containerRemoved){result.state='cleanup_unconfirmed';process.exitCode=1;}
 result.completedAt=new Date().toISOString();writeFileSync(join(output,'runtime.log'),logs,{mode:0o600});writeFileSync(join(output,'report.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({state:result.state,checks:result.checks.length,failures:result.checks.filter(c=>!c.passed).map(c=>({endpoint:c.endpoint,scenario:c.scenario,status:c.status,error:c.error})),containerRemoved:result.containerRemoved}));}
