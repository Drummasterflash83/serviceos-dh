const name='intelligence-ingestion-scheduled-sync',tenant='af410001-aaaa-4000-8000-000000000001';
const ids=['af410001-aaaa-4000-8000-000000000011','af410001-aaaa-4000-8000-000000000012'];
const jobs=new Map();const selections=[];let inserts=0,duplicateReads=0;const problems=[];
Deno.serve(async req=>{
 const u=new URL(req.url);
 if(u.pathname==='/rest/v1/tenant_connectors'){
  if(u.searchParams.get('enabled')!=='eq.true')problems.push('Enabled tenant filter missing');
  return Response.json([{tenant_id:tenant}]);
 }
 if(u.pathname==='/rest/v1/rpc/intelligence_select_uningested'){
  const q=await req.json();selections.push(q);
  if(q.p_mapper_version!=='obs-ingest/2'||q.p_tenant!==tenant||q.p_limit!==25)problems.push('Selector contract mismatch');
  return Response.json(ids.map(interaction_id=>({interaction_id})));
 }
 if(u.pathname==='/rest/v1/platform_jobs'){
  if(req.method==='POST'){
   const j=await req.json();inserts++;
   if(j.tenant_id!==tenant||j.job_type!=='intelligence.ingest_interaction'||j.payload.mapper_version!=='obs-ingest/2'||!ids.includes(j.payload.interaction_id)||j.job_key!==`intelligence.ingest_interaction:${tenant}:${j.payload.interaction_id}`)problems.push('Queue contract mismatch');
   if(jobs.has(j.job_key))return Response.json({code:'23505',message:'Synthetic duplicate'},{status:409});
   const row={id:j.payload.interaction_id};jobs.set(j.job_key,row);return Response.json(row,{status:201});
  }
  duplicateReads++;const key=u.searchParams.get('job_key')?.replace(/^eq\./,'');
  if(u.searchParams.get('tenant_id')!=='eq.'+tenant)problems.push('Duplicate tenant fence missing');
  const row=jobs.get(key);return Response.json(row?[row]:[]);
 }
 if(u.pathname!=='/'+name)return Response.json({error:'Unexpected request'},{status:404});
 const worker=await EdgeRuntime.userWorkers.create({servicePath:'/work/supabase/functions/'+name,memoryLimitMb:128,maybeEszip:await Deno.readFile('/artifacts/'+name+'.eszip'),maybeEntrypoint:'file:///work/supabase/functions/'+name+'/index.ts',workerTimeoutMs:10000,noModuleCache:false,forceCreate:true,cpuTimeSoftLimitMs:3000,cpuTimeHardLimitMs:3000,envVars:[['SUPABASE_URL','http://127.0.0.1:9000'],['SUPABASE_SERVICE_ROLE_KEY','synthetic-service-key'],['INTELLIGENCE_INGEST_SECRET','synthetic-schedule-secret']]});
 return worker.fetch(req);
});
try{
 const invoke=async auth=>{const r=await fetch('http://127.0.0.1:9000/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{'x-schedule-secret':'synthetic-schedule-secret'}:{})},body:'{}'});return {status:r.status,body:await r.json()};};
 const denied=await invoke(false);if(denied.status!==403||jobs.size!==0||selections.length!==0)throw Error('Authorization guard');
 const first=await invoke(true),repeat=await invoke(true);
 if(first.status!==200||first.body.queued!==2||first.body.candidates!==2||first.body.duplicates!==0||repeat.status!==200||repeat.body.queued!==0||repeat.body.duplicates!==2||selections.length!==2||jobs.size!==2||inserts!==4||duplicateReads!==2||problems.length)throw Error(JSON.stringify({first,repeat,selections:selections.length,jobs:jobs.size,inserts,duplicateReads,problems}));
 console.log('SCHEDULER_VERIFY='+JSON.stringify({state:'passed',mapperVersion:'obs-ingest/2',selectorRequests:2,queued:2,duplicateReuse:2,missingAuthStatus:denied.status,tenantFence:true,explicitPayloadMapper:true,network:'none',realCredentials:false,providerCalls:0}));
}catch(error){console.log('SCHEDULER_VERIFY='+JSON.stringify({state:'failed',error:String(error)}));}
console.log('SCHEDULER_VERIFY_DONE');
