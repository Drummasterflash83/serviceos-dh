/** Read only the bounded content-free Email inventory marker from LIVE logs. */
import { savedCliToken } from './learn-test-readiness.mjs';
const args=process.argv.slice(2);
if(args.length!==5||args[0]!=='--live-read-only'||args[1]!=='--from'||
  args[3]!=='--to'||!Number.isFinite(Date.parse(args[2])))
  throw Error('Exact LIVE log read-only mode and UTC range required');
const project='tgbnakbxwcqjeimygroz';
const start=args[2];
const end=process.argv[6];
if(!/^2026-10-16T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(start)||
  !/^2026-10-16T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(end)||
  Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>3600000)
  throw Error('Bounded UTC log range required');
const sql=`select timestamp,event_message from logs where source='function_logs'
 and event_message like '%learn_email_inventory_stage=%'
 order by timestamp desc limit 20`;
const params=new URLSearchParams({sql,iso_timestamp_start:start,iso_timestamp_end:end});
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/analytics/endpoints/logs?${params}`,{
  redirect:'error',signal:AbortSignal.timeout(45000),
  headers:{Authorization:`Bearer ${savedCliToken()}`}});
if(!response.ok) throw Error(`Email diagnostic log readback HTTP ${response.status}`);
const raw=await response.json();
if(!Array.isArray(raw?.result)||raw.result.length>20)
  throw Error('Email diagnostic log shape changed');
const observations=raw.result.map(row=>{
  const value=typeof row.event_message==='string'?row.event_message:'';
  const match=value.match(/learn_email_inventory_stage=(selector_rpc|selector_shape|review_rpc|review_shape) database_code=([A-Z0-9_]{3,12}|none)/);
  if(!match || !Number.isFinite(Date.parse(row.timestamp)))
    throw Error('Email diagnostic log marker changed');
  return {at:row.timestamp,stage:match[1],databaseCode:match[2]};
});
console.log(JSON.stringify({project,start,end,observations,
  messageContentReturned:false,productionDataWrites:false}));
