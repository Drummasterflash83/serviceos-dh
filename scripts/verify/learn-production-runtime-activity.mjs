/** Read-only operational evidence. Logs can arrive late or be absent; an empty
 * window is never drain acceptance, and a 200 is never durable capture proof.
 * No event messages, headers, addresses or request bodies are selected.
 */
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {savedCliToken} from './learn-test-readiness.mjs';
export const PROJECT='tgbnakbxwcqjeimygroz';
const check=(v,m)=>{if(!v)throw Error(m);};
export const ACTIVITY_QUERIES={
 invocations:`select log_attributes['function_id'] as function_id,log_attributes['response.status_code'] as status,count() as count,max(timestamp) as latest,max(toFloat64OrZero(log_attributes['execution_time_ms'])) as max_duration_ms from logs where source='function_edge_logs' group by function_id,status order by function_id,status limit 1001`,
 lifecycle:`select log_attributes['function_id'] as function_id,log_attributes['event_type'] as event_type,count() as count,max(timestamp) as latest from logs where source='function_logs' and log_attributes['event_type'] in ('Boot','Shutdown') group by function_id,event_type order by function_id,event_type limit 1001`,
};
export function activityWindow(start,end){
 const a=Date.parse(start),b=Date.parse(end);
 check(typeof start==='string'&&typeof end==='string'&&Number.isFinite(a)&&Number.isFinite(b)&&
  a%60000===0&&b%60000===0&&b>a&&b-a<=30*60000,'Minute-aligned window of at most 30 minutes required');
 return {start:new Date(a).toISOString(),end:new Date(b).toISOString()};
}
export function assessRuntimeActivity({inventory,invocations,lifecycle,start,end}){
 const window=activityWindow(start,end);
 check(Array.isArray(inventory)&&inventory.length>0&&new Set(inventory.map(v=>v.id)).size===inventory.length&&
  inventory.every(v=>typeof v.id==='string'&&/^[a-z0-9-]+$/.test(v.name)),'Complete named runtime inventory required');
 const known=new Map(inventory.map(v=>[v.id,v.name]));
 const rows=(value,kind)=>{
  check(Array.isArray(value)&&value.length<1001,'Log result incomplete or truncated');
  const keys=new Set();
  return value.map(r=>{
   const type=kind==='invocations'?r.status:r.event_type,key=r.function_id+':'+type;
   check(!keys.has(key)&&Number.isSafeInteger(r.count)&&r.count>0&&typeof r.latest==='string'&&
    Number.isFinite(Date.parse(r.latest.endsWith('Z')?r.latest:r.latest+'Z'))&&typeof r.function_id==='string'&&
    (kind==='invocations'?/^[1-5][0-9]{2}$/.test(type)&&Number.isFinite(r.max_duration_ms)&&r.max_duration_ms>=0:
     ['Boot','Shutdown'].includes(type)),'Malformed or ambiguous runtime activity');
   keys.add(key);
   return {function:known.get(r.function_id)??'unknown_function',...(kind==='invocations'?
    {httpStatus:Number(type),maxDurationMs:r.max_duration_ms}:{eventType:type}),count:r.count,latest:r.latest};
  });
 };
 const http=rows(invocations,'invocations'),events=rows(lifecycle,'lifecycle');
 return {version:'learn-production-runtime-activity/1',project:PROJECT,...window,
  state:'observed_activity_not_drain_or_capture_acceptance',invocations:http,lifecycle:events,
  httpRequestCount:http.reduce((a,r)=>a+r.count,0),httpErrorCount:http.filter(r=>r.httpStatus>=400).reduce((a,r)=>a+r.count,0),
  missingInvocationEvidence:http.length===0,unknownFunctions:[...http,...events].some(r=>r.function==='unknown_function'),
  inFlightWorkVerifiedStopped:false,durableCaptureVerified:false,productionChanges:0,providerRequests:0,
  limitations:['Log windows may be delayed, missing or cross execution boundaries; absence is not proof of inactivity.',
   'Boot/Shutdown totals cannot be subtracted to count active executions: events can span the window.',
   'HTTP 200 does not prove durable capture, complete history, authenticated user journeys or background completion.',
   'Current schedule state, leases, downstream work and caller coordination must be checked separately.']};
}
export async function readRuntimeActivity({token,start,end,fetcher=fetch}){
 const window=activityWindow(start,end);
 check(typeof token==='string'&&token.length>20,'Existing management login required');
 async function get(path){
  const r=await fetcher('https://api.supabase.com'+path,{method:'GET',redirect:'error',
   signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+token}});
  check(r.status===200,'Runtime activity read failed (HTTP '+r.status+')');
  return r.json();
 }
 const inventory=await get(`/v1/projects/${PROJECT}/functions`),data={};
 for(const [name,sql] of Object.entries(ACTIVITY_QUERIES)){
  const params=new URLSearchParams({sql,iso_timestamp_start:window.start,iso_timestamp_end:window.end});
  const result=await get(`/v1/projects/${PROJECT}/analytics/endpoints/logs?${params}`);
  check(result&&!result.error&&Array.isArray(result.result),'Log query returned incomplete evidence');
  data[name]=result.result;
 }
 return {...assessRuntimeActivity({inventory,...data,...window}),observedAt:new Date().toISOString()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [start,end,output]=process.argv.slice(2);
 check(process.argv.length===5&&process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT===PROJECT&&
  /^\.verification-results\/[a-z0-9-]+\.json$/.test(output??''),'Explicit production read-only target and private report required');
 const report=await readRuntimeActivity({token:savedCliToken(),start,end});
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({state:report.state,httpRequests:report.httpRequestCount,httpErrors:report.httpErrorCount,
  unknownFunctions:report.unknownFunctions,productionChanges:0,providerRequests:0}));
}
