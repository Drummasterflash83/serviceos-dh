/** Private, read-only source inventory. No messages, audio or transcript text are
 * downloaded. The manifest is not a backup; it can detect lost rows/pointers. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const sha = value => createHash('sha256').update(value).digest('hex');
const SOURCES = ['email_messages','phone_calls','phone_recordings','phone_transcripts','interactions','customer_cards','jobs','team_members','receptionist_voicemails','email_accounts','tenant_connectors'];
export function comparePreservation(before,after) {
  if(before.project_ref!==after.project_ref||before.tenant_id!==after.tenant_id)throw Error('Cannot compare different project or tenant');
  const result={sources:{},storage:{missing_objects:0,changed_objects:0},complete:true};
  for(const [name,prior] of Object.entries(before.sources)) {
    const current=after.sources[name];
    if(!prior.complete||!current?.complete){result.sources[name]={status:'unverified'};result.complete=false;continue;}
    const next=new Map(current.rows.map(r=>[r.id,r]));
    const missing=prior.rows.filter(r=>!next.has(r.id));
    const changed=prior.rows.filter(r=>next.has(r.id)&&r.storage_pointer_hash&&r.storage_pointer_hash!==next.get(r.id).storage_pointer_hash);
    result.sources[name]={status:missing.length||changed.length?'changed':'preserved',prior_count:prior.rows.length,current_count:current.rows.length,missing_rows:missing.length,changed_storage_pointers:changed.length};
  }
  if(!before.storage.complete||!after.storage.complete){result.storage={status:'unverified'};result.complete=false;}
  else {const next=new Map(after.storage.objects.map(o=>[o.path_hash,o]));for(const p of before.storage.objects){const n=next.get(p.path_hash);if(!n)result.storage.missing_objects++;else if(p.size!==n.size||p.updated_at!==n.updated_at)result.storage.changed_objects++;}result.storage.status=result.storage.missing_objects||result.storage.changed_objects?'changed':'preserved';}
  result.comparison_state=Object.values(result.sources).some(s=>s.status==='changed')||result.storage.status==='changed'?'changed':result.complete?'preserved':'unverified';
  return result;
}

export async function collectPreservation({origin,projectRef,tenant,token,fetcher=fetch,now=new Date().toISOString(),scanMode='counted',requestBudget=1000}) {
  if(!/^[a-z0-9]{20}$/.test(projectRef)||origin!==`https://${projectRef}.supabase.co`||!uuid.test(tenant)||!token||!Number.isFinite(Date.parse(now))||!['counted','double_keyset'].includes(scanMode)||!Number.isSafeInteger(requestBudget)||requestBudget<1||requestBudget>10000)throw Error('Invalid inventory scope or scan options');
  const headers={apikey:token,Authorization:`Bearer ${token}`};
  let requests=0,budgetReported=false;
  const readErrors=[];
  async function request(path,{method='GET',query={},body}={}) {
    if(requests>=requestBudget){if(!budgetReported){readErrors.push({kind:'request_budget'});budgetReported=true;}return {ok:false};}
    requests++;
    const url=new URL(path,origin);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
    try{
      // Page reads do not need another global count. Only explicit HEAD probes
      // in counted mode ask PostgREST to run count=exact.
      const response=await fetcher(url,{method,headers:{...headers,...(method==='HEAD'?{Prefer:'count=exact'}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok){await response.body?.cancel().catch(()=>{});readErrors.push({path,method,kind:'http',status:response.status});return {ok:false};}
      const raw=response.headers.get('content-range')?.split('/')[1];
      const count=raw&&/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null;
      if(method==='HEAD')return {ok:true,count,data:null};
      if(!response.body)throw Error('empty');
      const reader=response.body.getReader(),parts=[];let bytes=0;
      try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>8*1024*1024)throw Error('size');parts.push(part.value);}}
      finally{await reader.cancel().catch(()=>{});}
      return {ok:true,count,data:JSON.parse(Buffer.concat(parts).toString('utf8'))};
    }catch(error){readErrors.push({path,method,kind:error?.name==='TimeoutError'?'timeout':'transport_or_response'});return {ok:false};}
  }
  const identity=await request('/rest/v1/tenants',{query:{select:'id',id:`eq.${tenant}`,limit:'1'}});
  if(!identity.ok||identity.data?.length!==1||identity.data[0].id!==tenant)throw Error('Tenant identity unavailable');
  const manifest={version:'learn-preservation/2',project_ref:projectRef,tenant_id:tenant,cutoff:now,observed_at:null,scan_mode:scanMode,request_budget:requestBudget,requests:0,read_errors:readErrors,sources:{},storage:{complete:false,objects:[],recordings_matched:0,recordings_missing:0,recordings_unverified:0}};
  const recordingPaths=new Map();
  async function scan(table,base){
    const rows=[],seen=new Set(),paths=new Map();let cursor=null,complete=false;
    for(let page=0;page<1000;page++){
      const response=await request(`/rest/v1/${table}`,{query:{...base,order:'id.asc',limit:'1000',...(cursor?{id:`gt.${cursor}`}:{})}});
      if(!response.ok||!Array.isArray(response.data)||response.data.length>1000)break;
      if(response.data.some((r,i)=>!r||r.tenant_id!==tenant||!uuid.test(r.id??'')||seen.has(r.id)||(cursor&&r.id<=cursor)||(i>0&&r.id<=response.data[i-1].id)))break;
      // Only an empty page proves exhaustion. A lower server-side row cap can
      // return a short page even when more rows remain.
      if(response.data.length===0){complete=true;break;}
      for(const r of response.data){seen.add(r.id);const out={id:r.id};
        if(table==='phone_recordings'){out.storage_pointer_hash=typeof r.storage_path==='string'?sha(r.storage_path):null;if(typeof r.storage_path==='string'&&r.storage_path)paths.set(r.id,r.storage_path);}
        if(table==='phone_transcripts')out.status=typeof r.status==='string'?r.status:'unknown';
        rows.push(out);
      }
      cursor=response.data.at(-1).id;
    }
    return {rows,paths,complete};
  }
  for(const table of SOURCES){
    const select=table==='phone_recordings'?'id,tenant_id,storage_path':table==='phone_transcripts'?'id,tenant_id,status':'id,tenant_id';
    const base={select,tenant_id:`eq.${tenant}`,created_at:`lte.${now}`};
    let first,complete=false,count=null;
    if(scanMode==='counted'){
      const start=await request(`/rest/v1/${table}`,{method:'HEAD',query:base});
      first=start.ok&&start.count!==null?await scan(table,base):{rows:[],paths:new Map(),complete:false};
      const end=first.complete?await request(`/rest/v1/${table}`,{method:'HEAD',query:base}):null;
      complete=!!(first.complete&&end.ok&&start.count===end.count&&first.rows.length===end.count);
      count=start.count??null;
    }else{
      first=await scan(table,base);
      const second=first.complete?await scan(table,base):null;
      complete=!!(first.complete&&second.complete&&JSON.stringify(first.rows)===JSON.stringify(second.rows));
      count=complete?first.rows.length:null;
    }
    manifest.sources[table]={complete,count,verification:scanMode==='counted'?'exact_counts_and_keyset':'matching_keyset_passes',rows:first.rows};
    if(table==='phone_recordings')for(const [id,path]of first.paths)recordingPaths.set(id,path);
  }
  // Storage list is a read-only POST, never an upload/download/provider recovery.
  const folders=new Set();
  for(const path of recordingPaths.values())if(path.startsWith(`${tenant}/`)&&!path.split('/').some(s=>s==='..'||s==='.'||s===''))folders.add(path.slice(0,path.lastIndexOf('/')));
  const objects=new Map();let storageComplete=manifest.sources.phone_recordings.complete;
  for(const prefix of folders){
    let exhausted=false,offset=0;const seenNames=new Set();
    for(let page=0;page<1000;page++){
      const r=await request('/storage/v1/object/list/phone-recordings',{method:'POST',body:{prefix,limit:1000,offset,sortBy:{column:'name',order:'asc'}}});
      if(!r.ok||!Array.isArray(r.data)||r.data.length>1000){storageComplete=false;break;}
      if(r.data.some((item,i)=>!item||typeof item.name!=='string'||!item.name||item.name.includes('/')||['.','..'].includes(item.name)||seenNames.has(item.name)||r.data.slice(0,i).some(prior=>prior.name===item.name))){storageComplete=false;break;}
      if(r.data.length===0){exhausted=true;break;}
      for(const item of r.data){seenNames.add(item.name);if(!item.id)continue;const path=`${prefix}/${item.name}`;objects.set(sha(path),{path_hash:sha(path),size:Number.isFinite(item.metadata?.size)?item.metadata.size:null,updated_at:typeof item.updated_at==='string'?item.updated_at:null});}
      offset+=r.data.length;
    }
    if(!exhausted)storageComplete=false;
  }
  manifest.storage.complete=storageComplete;
  manifest.storage.objects=[...objects.values()].sort((a,b)=>a.path_hash.localeCompare(b.path_hash));
  for(const r of manifest.sources.phone_recordings.rows){const object=objects.get(r.storage_pointer_hash);if(object&&object.size>44)manifest.storage.recordings_matched++;else if(!storageComplete)manifest.storage.recordings_unverified++;else manifest.storage.recordings_missing++;}
  manifest.requests=requests;
  manifest.observed_at=new Date().toISOString();
  return manifest;
}

export function summarizePreservation(manifest) {
  const transcripts=manifest.sources.phone_transcripts;
  const statuses={};if(transcripts.complete)for(const r of transcripts.rows)statuses[r.status]=(statuses[r.status]??0)+1;
  return {version:manifest.version,project_ref:manifest.project_ref,tenant_id:manifest.tenant_id,cutoff:manifest.cutoff,observed_at:manifest.observed_at,scan_mode:manifest.scan_mode??'counted',request_budget:manifest.request_budget??null,requests:manifest.requests??null,read_errors:manifest.read_errors??[],
    sources:Object.fromEntries(Object.entries(manifest.sources).map(([key,value])=>[key,{complete:value.complete,count:value.complete?value.rows.length:null}])),
    transcript_statuses:transcripts.complete?statuses:null,
    storage:{complete:manifest.storage.complete,objects:manifest.storage.objects.length,recordings_matched:manifest.storage.recordings_matched,recordings_missing:manifest.storage.recordings_missing,recordings_unverified:manifest.storage.recordings_unverified},
    limitations:['Not a transactionally consistent database snapshot or a backup.','Storage metadata confirms object presence and size, not playable audio.','A changed row set needs investigation; a higher total alone cannot prove preservation.','Matching keyset passes compare IDs, transcript statuses and recording pointers, not every source column; they cannot exclude all concurrent changes.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const destination=process.argv[2];if(!destination)throw Error('Supply an ignored private manifest output path');
  const env=process.env;
  const result=await collectPreservation({origin:(env.SUPABASE_URL??'').replace(/\/$/,''),projectRef:env.VERIFY_ALLOW_PROJECT_REF,tenant:env.VERIFY_TENANT,token:env.SUPABASE_SERVICE_ROLE_KEY,scanMode:env.VERIFY_SCAN_MODE??'counted',requestBudget:env.VERIFY_REQUEST_BUDGET===undefined?1000:Number(env.VERIFY_REQUEST_BUDGET)});
  await mkdir(dirname(resolve(destination)),{recursive:true});await writeFile(destination,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
  const summary=summarizePreservation(result);
  if(process.argv[3])summary.comparison=comparePreservation(JSON.parse(await readFile(process.argv[3],'utf8')),result);
  console.log(JSON.stringify(summary,null,2));
}
