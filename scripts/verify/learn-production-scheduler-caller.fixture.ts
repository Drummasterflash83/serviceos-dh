// Runs only in the isolated acceptance container. All identities and credentials
// are synthetic. The real, unmodified compiled workers call this HTTP fixture.
const config=JSON.parse(await Deno.readTextFile('/probe/config.json'));
const tenantA='11111111-1111-4111-8111-111111111111',tenantB='22222222-2222-4222-8222-222222222222';
const service='synthetic-service-caller-credential',schedule='synthetic-scheduler-caller-credential';
const endpoints=config.endpoints;
let scenario='',endpoint='',requests:any[]=[],violations:string[]=[];
const jobs:Record<string,string>={};
const json=(v:unknown,status=200)=>Response.json(v,{status});
const database=async(req:Request)=>{
 const u=new URL(req.url);let body:any=null;try {body=await req.json();}catch{}
 requests.push({method:req.method,path:u.pathname,query:u.search,body});
 if(req.headers.get('authorization')!=='Bearer '+service||req.headers.get('apikey')!==service){violations.push('database_auth');return json({message:'fixture authentication mismatch'},401);}
 if(u.pathname==='/rest/v1/tenant_connectors'&&req.method==='GET') {
  if(u.searchParams.get('enabled')!=='eq.true')violations.push('connector_enabled_filter');
  if(endpoint==='phone-processing-scheduled-sync'&&u.searchParams.get('connector_id')!=='eq.simwood')violations.push('phone_connector_filter');
  return json(scenario==='empty'?[]:[{tenant_id:tenantA},{tenant_id:tenantB},{tenant_id:tenantA}]);
 }
 if(u.pathname==='/rest/v1/platform_jobs'&&req.method==='POST') {
  const spec=endpoints.find((x:any)=>x.name===endpoint),tenant=body?.tenant_id;
  if(![tenantA,tenantB].includes(tenant)||body.job_type!==spec.kind||body.status!=='queued'||body.module_id!==spec.module||
    body.connector_id!==spec.connector||body.job_key!==spec.kind+':'+tenant+(spec.kind==='interactions.sync'?':all':''))violations.push('queue_binding');
  if(scenario==='enqueue_failure'||scenario==='partial_failure'&&tenant===tenantB)return json({code:'XX000',message:'synthetic uncertain queue'},503);
  if(scenario==='duplicate'||scenario==='duplicate_lookup_failure')return json({code:'23505',message:'synthetic existing job'},409);
  const id=tenant===tenantA?'33333333-3333-4333-8333-333333333333':'44444444-4444-4444-8444-444444444444';jobs[tenant]=id;return json({id},201);
 }
 if(u.pathname==='/rest/v1/platform_jobs'&&req.method==='GET') {
  const tenant=u.searchParams.get('tenant_id')?.slice(3),spec=endpoints.find((x:any)=>x.name===endpoint);
  if(![tenantA,tenantB].includes(tenant??'')||u.searchParams.get('job_key')!=='eq.'+spec.kind+':'+tenant+(spec.kind==='interactions.sync'?':all':''))violations.push('duplicate_binding');
  return json(scenario==='duplicate_lookup_failure'?[]:[{id:tenant===tenantA?'33333333-3333-4333-8333-333333333333':'44444444-4444-4444-8444-444444444444'}]);
 }
 violations.push('unexpected_database_request');return json({message:'unexpected fixture request'},500);
};
const envVars=[['SUPABASE_URL','http://127.0.0.1:9000'],['SUPABASE_SERVICE_ROLE_KEY',service],['SUPABASE_ANON_KEY','synthetic-anon'],
 ...endpoints.map((e:any)=>[e.secret,schedule])];
Deno.serve({port:9000,hostname:'127.0.0.1'},async(req:Request)=>{
 if(new URL(req.url).pathname.startsWith('/rest/v1/'))return database(req);
 const name=new URL(req.url).pathname.slice(1);
 const worker=await EdgeRuntime.userWorkers.create({servicePath:'/work/supabase/functions/'+name,memoryLimitMb:128,
  maybeEszip:await Deno.readFile('/artifacts/'+name+'.eszip'),maybeEntrypoint:'file:///work/supabase/functions/'+name+'/index.ts',
  workerTimeoutMs:10000,cpuTimeSoftLimitMs:3000,cpuTimeHardLimitMs:3000,envVars,forceCreate:true});
 return await worker.fetch(req);
});
for(const spec of endpoints)for(const mode of ['wrong_auth','empty','queued','duplicate','enqueue_failure','duplicate_lookup_failure','partial_failure']) {
 endpoint=spec.name;scenario=mode;requests=[];violations=[];
 try {
  const r=await fetch('http://127.0.0.1:9000/'+endpoint,{method:'POST',headers:{'content-type':'application/json','x-schedule-secret':mode==='wrong_auth'?'wrong':schedule},body:'{}'});
  const response=await r.json();const posts=requests.filter(r=>r.method==='POST');
  const expected=mode==='wrong_auth'?403:['enqueue_failure','duplicate_lookup_failure','partial_failure'].includes(mode)?503:200;
  const expectedPosts=['wrong_auth','empty'].includes(mode)?0:2;
  const resultMatches=mode==='queued'?response.success===true&&response.queued===2&&response.duplicates===0:
    mode==='duplicate'?response.success===true&&response.duplicates===2&&response.queued===0:
    mode==='empty'?response.success===true&&response.tenants===0:
    expected===503?response.success===false&&response.error?.code==='enqueue_unconfirmed':response.success===false;
  const passed=r.status===expected&&resultMatches&&posts.length===expectedPosts&&!violations.length&&
    (mode!=='wrong_auth'||requests.length===0);
  console.log('SCHEDULER_CASE='+JSON.stringify({endpoint,scenario:mode,passed,status:r.status,expectedStatus:expected,
    databaseRequests:requests.length,queueWrites:posts.length,violations,response}));
 } catch(error) {console.log('SCHEDULER_CASE='+JSON.stringify({endpoint,scenario:mode,passed:false,error:String(error.message).slice(0,200)}));}
}
console.log('SCHEDULER_CALLERS_DONE');
