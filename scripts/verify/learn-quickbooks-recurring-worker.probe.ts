/** Compiled worker guards and schedule-to-import order; synthetic network only. */
const name='learn-quickbooks-worker',key='synthetic-quickbooks-trigger-key',calls:string[]=[];let invalidSchedule=false;
Deno.serve(async req=>{
 const path=new URL(req.url).pathname;
 if(path==='/rest/v1/rpc/learn_quickbooks_schedule_tick'){calls.push('schedule');return Response.json(invalidSchedule?{checked:0,queued:1,held:0}:{checked:0,queued:0,held:0});}
 if(path==='/rest/v1/rpc/learn_quickbooks_import_acquire'){calls.push('acquire');return Response.json({state:'idle'});}
 if(path!=='/'+name)return Response.json({unexpected:true},{status:404});
 const configured=new URL(req.url).searchParams.get('configured')!=='false';
 const worker=await EdgeRuntime.userWorkers.create({servicePath:'/work/supabase/functions/'+name,memoryLimitMb:256,maybeEszip:await Deno.readFile('/artifacts/'+name+'.eszip'),maybeEntrypoint:'file:///work/supabase/functions/'+name+'/index.ts',workerTimeoutMs:15000,noModuleCache:false,forceCreate:true,cpuTimeSoftLimitMs:5000,cpuTimeHardLimitMs:5000,envVars:[['SUPABASE_URL','http://127.0.0.1:9000'],['SUPABASE_SERVICE_ROLE_KEY','synthetic-service-key'],...(configured?[['LEARN_QUICKBOOKS_WORKER_KEY',key]]:[])]});
 return worker.fetch(req);
});
async function invoke(headers:Record<string,string>={},method='POST',body?:string,configured=true){
 const r=await fetch('http://127.0.0.1:9000/'+name+'?configured='+configured,{method,headers,...(body!==undefined?{body}:{})});return{status:r.status,body:await r.json(),noStore:r.headers.get('cache-control')?.includes('no-store')};
}
try{
 const missing=await invoke(),wrong=await invoke({'x-serviceos-worker-key':'wrong'}),method=await invoke({},'GET'),body=await invoke({'x-serviceos-worker-key':key},'POST','{}'),unconfigured=await invoke({},'POST',undefined,false);
 if(missing.status!==403||wrong.status!==403||method.status!==405||body.status!==400||unconfigured.status!==503||calls.length||[missing,wrong,method,body,unconfigured].some(x=>!x.noStore))throw Error('Guard failure');
 const good=await invoke({'x-serviceos-worker-key':key});if(good.status!==200||good.body.ok!==true||good.body.result.claimed!==0||good.body.result.state!=='idle'||calls.join(',')!=='schedule,acquire')throw Error('Idle dispatch/order failure');
 calls.length=0;invalidSchedule=true;const rejected=await invoke({'x-serviceos-worker-key':key});if(rejected.status!==503||calls.join(',')!=='schedule')throw Error('Malformed schedule must not acquire');
 console.log('WORKER_VERIFY='+JSON.stringify({state:'passed',cases:7,missingKeyStatus:403,unconfiguredStatus:503,bodyStatus:400,noDatabaseBeforeAuth:true,scheduleBeforeImport:true,malformedScheduleStops:true,network:'none',realCredentials:false,providerCalls:0}));
}catch(e){console.log('WORKER_VERIFY='+JSON.stringify({state:'failed',error:String(e)}));}
