/** Exercise the compiled worker over synthetic PostgREST; network stays disabled. */
const id=(n:number)=>`af430001-aaaa-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),interaction=id(2),source=id(3),job=id(4),observing=id(5),ledgerId=id(6);
const revision='a'.repeat(64),stamp='2026-10-14T06:00:00.123456+00:00';
const row={id:interaction,tenant_id:tenant,source_type:'chat',source_connector_id:'slack',
 source_table:'slack_messages',source_id:source,source_external_id:'TSYN:CSYN:1.123456',
 interaction_type:'slack_message',direction:'unknown',processing_status:'identity_review',
 occurred_at:stamp,updated_at:stamp,subject:null,summary:null,body_preview:'Synthetic urgent missing parts request',
 from_name:null,from_address:null,sentiment:null,priority:null,related_person_id:null,
 related_company_id:null,related_job_id:null,metadata:{source_version:revision}};
const proof={version:'learn-retained-source-context/1',tenant_id:tenant,interaction_id:interaction,
 source_id:source,source_version:revision,interaction_updated_at:stamp,scope:'company_source',attribution:'unresolved'};
let mode='verified',checks=0,inserts=0,ledger:any=null,queued:any=null,settlement:any=null;
const problems:string[]=[];
const objectResponse=(req:Request,value:any)=>Response.json(
 req.headers.get('accept')?.includes('object+json')?value:value==null?[]:[value]);
Deno.serve(async req=>{
 const u=new URL(req.url),path=u.pathname;
 if(path==='/rest/v1/rpc/voicemail_schedule_tick')return Response.json({state:'idle',historical_receipt:false,
  coverage_complete:false,routes_attempted:0,routes_failed:0,pages:0,rows_examined:0,jobs_enqueued:0,observed_at:stamp});
 if(path==='/rest/v1/rpc/voicemail_queue_recover')return Response.json(0);
 if(path==='/rest/v1/rpc/platform_jobs_claim'){
  const q=await req.json();return Response.json([{id:job,tenant_id:tenant,job_type:'intelligence.ingest_interaction',
   claimed_by:q.p_worker,attempt_count:1,max_attempts:5,payload:{interaction_id:interaction,mapper_version:'obs-ingest/2'}}]);
 }
 if(path==='/rest/v1/rpc/learn_public_slack_observation_context'){
  const q=await req.json();checks++;
  if(q.p_tenant!==tenant||q.p_interaction!==interaction)problems.push('proof scope');
  return Response.json(mode==='unproven'||(mode==='withdrawn'&&checks>1)?null:proof);
 }
 if(path==='/rest/v1/rpc/serviceos_record_health_check')return Response.json(null);
 if(path==='/rest/v1/interactions'){
  if(req.method!=='GET'||u.searchParams.get('tenant_id')!==`eq.${tenant}`)problems.push('interaction scope');
  return objectResponse(req,row);
 }
 if(path==='/rest/v1/graph_nodes'){
  if(u.searchParams.get('tenant_id')!==`eq.${tenant}`)problems.push('graph scope');return Response.json([]);
 }
 if(path==='/rest/v1/intelligence_ingestions'){
  if(req.method==='POST'){
   const q=await req.json();
   if(q.tenant_id!==tenant||q.interaction_id!==interaction||q.mapper_version!=='obs-ingest/2')problems.push('ledger scope');
   if(ledger)return Response.json({code:'23505',message:'synthetic duplicate'},{status:409});
   ledger={id:ledgerId,status:q.status,observe_job_id:null};return objectResponse(req,ledger);
  }
  if(u.searchParams.get('tenant_id')!==`eq.${tenant}`)problems.push('ledger read/update scope');
  if(req.method==='PATCH')ledger={...ledger,...await req.json()};
  return objectResponse(req,ledger);
 }
 if(path==='/rest/v1/platform_jobs'){
  if(req.method==='POST'){
   queued=await req.json();inserts++;
   if(queued.tenant_id!==tenant||queued.job_type!=='intelligence.observe')problems.push('observe scope');
   return objectResponse(req,{id:observing});
  }
  if(req.method==='PATCH'){
   const q=await req.json();if(q.status!=='retrying'||u.searchParams.get('status')!=='eq.running')settlement=q;
   return Response.json([]);
  }
  if(u.searchParams.get('tenant_id')!==`eq.${tenant}`)problems.push('observe lookup scope');
  return objectResponse(req,queued?{id:observing}:null);
 }
 if(path!=='/platform-worker'){problems.push('unexpected endpoint');return Response.json({error:'unexpected'},{status:404});}
 const worker=await EdgeRuntime.userWorkers.create({servicePath:'/work/supabase/functions/platform-worker',
  memoryLimitMb:256,maybeEszip:await Deno.readFile('/artifacts/platform-worker.eszip'),
  maybeEntrypoint:'file:///work/supabase/functions/platform-worker/index.ts',workerTimeoutMs:15000,
  noModuleCache:false,forceCreate:true,cpuTimeSoftLimitMs:5000,cpuTimeHardLimitMs:5000,
  envVars:[['SUPABASE_URL','http://127.0.0.1:9000'],['SUPABASE_SERVICE_ROLE_KEY','synthetic-service'],
   ['WORKER_SECRET','synthetic-schedule']]});
 return worker.fetch(req);
});
try{
 const run=async()=>{
  const r=await fetch('http://127.0.0.1:9000/platform-worker',{method:'POST',
   headers:{'content-type':'application/json','x-schedule-secret':'synthetic-schedule'},body:JSON.stringify({batch_size:1})});
  const result=await r.json();if(r.status!==200||problems.length)throw Error('Runtime or request scope failed');return result;
 };
 const first=await run();
 if(first.succeeded!==1||checks!==2||inserts!==1||ledger?.observe_job_id!==observing||settlement?.status!=='succeeded')
  throw Error('Confirmed source hand-off failed');
 const draft=queued.payload.observation;
 if(draft.attributes.retained_source_context?.attribution!=='unresolved'||
  draft.attributes.customer_context!==null||draft.attributes.work_context!==null)
  throw Error('Source proof or unresolved attribution changed');
 const again=await run();
 if(again.succeeded!==1||inserts!==1)throw Error('Duplicate recovery enqueued another observation');
 mode='unproven';checks=0;ledger=null;queued=null;inserts=0;settlement=null;
 const denied=await run();if(denied.succeeded!==0||inserts!==0||ledger!==null||checks!==1)
  throw Error('Unproven source mutated observation state');
 mode='withdrawn';checks=0;settlement=null;
 const withdrawn=await run();if(withdrawn.succeeded!==0||inserts!==0||ledger!==null||checks!==2)
  throw Error('Withdrawn proof mutated observation state');
 console.log('WORKER_VERIFY='+JSON.stringify({state:'passed',compiledSourceHandOff:true,
  duplicateRecovery:true,unprovenSourceDenied:true,withdrawnProofDenied:true,tenantFiltersVerified:true,
  customerAndJobAttribution:'unresolved',network:'none',realCredentials:false,providerCalls:0,cases:4}));
}catch(error){console.log('WORKER_VERIFY='+JSON.stringify({state:'failed',error:String(error),problems}));}
