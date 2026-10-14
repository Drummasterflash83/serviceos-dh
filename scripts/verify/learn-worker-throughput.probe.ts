const name='platform-worker', tenant='af420001-aaaa-4000-8000-000000000001';
const claims=[], problems=[], settled=new Set();let dbRequests=0, syntheticCount=0;
Deno.serve(async req=>{
 const u=new URL(req.url);
 if(u.pathname.startsWith('/rest/'))dbRequests++;
 if(u.pathname==='/rest/v1/rpc/voicemail_schedule_tick')return Response.json({state:'idle',historical_receipt:false,coverage_complete:false,routes_attempted:0,routes_failed:0,pages:0,rows_examined:0,jobs_enqueued:0,observed_at:new Date().toISOString()});
 if(u.pathname==='/rest/v1/rpc/voicemail_queue_recover')return Response.json(0);
 if(u.pathname==='/rest/v1/rpc/platform_jobs_claim'){
  const q=await req.json();claims.push(q);
  if(q.p_lease_seconds!==300||!q.p_worker?.startsWith('worker-'))problems.push('Claim lease/owner changed');
  return Response.json(Array.from({length:Math.min(syntheticCount,q.p_batch)},(_,i)=>({id:`af420001-aaaa-4000-8000-${String(i+11).padStart(12,'0')}`,tenant_id:tenant,job_type:'synthetic.unsupported',claimed_by:q.p_worker,attempt_count:1,max_attempts:5,payload:{}})));
 }
 if(u.pathname==='/rest/v1/platform_jobs'&&req.method==='PATCH'){
  const b=await req.json();
  if(b.status==='retrying'){
   if(u.searchParams.get('status')!=='eq.running'||u.searchParams.get('job_type')!=='neq.phone.voicemail_import'||!u.searchParams.get('lease_expires_at')?.startsWith('lt.'))problems.push('Recovery filters changed');
  }else if(b.status==='dead_letter'&&b.error_code==='unsupported_job')settled.add(u.searchParams.get('id'));
  else problems.push('Unexpected job mutation');
  return Response.json([]);
 }
 if(u.pathname!=='/'+name){problems.push('Unexpected request: '+u.pathname);return Response.json({error:'Unexpected request'},{status:404});}
 const worker=await EdgeRuntime.userWorkers.create({servicePath:'/work/supabase/functions/'+name,memoryLimitMb:256,maybeEszip:await Deno.readFile('/artifacts/'+name+'.eszip'),maybeEntrypoint:'file:///work/supabase/functions/'+name+'/index.ts',workerTimeoutMs:15000,noModuleCache:false,forceCreate:true,cpuTimeSoftLimitMs:5000,cpuTimeHardLimitMs:5000,envVars:[['SUPABASE_URL','http://127.0.0.1:9000'],['SUPABASE_SERVICE_ROLE_KEY','synthetic-service-key'],['WORKER_SECRET','synthetic-worker-secret']]});
 return worker.fetch(req);
});
try{
 const invoke=async(body,auth='schedule')=>{const r=await fetch('http://127.0.0.1:9000/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(auth==='schedule'?{'x-schedule-secret':'synthetic-worker-secret'}:auth==='service'?{Authorization:'Bearer synthetic-service-key'}:{})},body:typeof body==='string'?body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const denied=await invoke({},'none');if(denied.status!==403||dbRequests!==0)throw Error('Missing auth touched database');
 const cases=[{body:{},batch:10},{body:{batch_size:1},batch:1},{body:{batch_size:100},batch:20},{body:{batch_size:0},batch:1},{body:{batch_size:2.9},batch:2},{body:{batch_size:'20'},batch:10},{body:'malformed-json',batch:10},{body:{job_types:['synthetic.unsupported',42]},batch:10,filter:['synthetic.unsupported']}];
 for(const c of cases){const r=await invoke(c.body);const q=claims.at(-1);if(r.status!==200||r.body.success!==true||q.p_batch!==c.batch||JSON.stringify(q.p_job_types)!==JSON.stringify(c.filter??null))throw Error(JSON.stringify({case:c,response:r,claim:q}));}
 syntheticCount=10;const processed=await invoke({},'service');
 if(processed.status!==200||processed.body.claimed!==10||processed.body.dead_lettered!==10||processed.body.failed!==0||settled.size!==10||problems.length)throw Error(JSON.stringify({processed,settled:settled.size,problems}));
 console.log('WORKER_VERIFY='+JSON.stringify({state:'passed',defaultBatch:10,explicitBatchBounds:[1,20],leaseSeconds:300,cases:cases.length,syntheticJobsSettled:10,missingAuthStatus:denied.status,noDatabaseBeforeAuth:true,serviceAuthVerified:true,jobTypeFilterPreserved:true,network:'none',realCredentials:false,providerCalls:0}));
}catch(error){console.log('WORKER_VERIFY='+JSON.stringify({state:'failed',error:String(error)}));}
