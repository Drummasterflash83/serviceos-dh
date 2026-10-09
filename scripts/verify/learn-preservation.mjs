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

export async function collectPreservation({origin,projectRef,tenant,token,fetcher=fetch,now=new Date().toISOString()}) {
  if(!/^[a-z0-9]{20}$/.test(projectRef)||origin!==`https://${projectRef}.supabase.co`||!uuid.test(tenant)||!token)throw Error('Invalid inventory scope');
  const headers={apikey:token,Authorization:`Bearer ${token}`};
  async function request(path,{method='GET',query={},body}={}) {
    const url=new URL(path,origin);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
    try{const response=await fetcher(url,{method,headers:{...headers,Prefer:'count=exact',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)return {ok:false,status:response.status};
      const count=response.headers.get('content-range')?.split('/')[1];
      return {ok:true,count:count&&/^\d+$/.test(count)?Number(count):null,data:method==='HEAD'?null:await response.json()};
    }catch{return {ok:false,status:null};}
  }
  const identity=await request('/rest/v1/tenants',{query:{select:'id,display_name',id:`eq.${tenant}`,limit:'1'}});
  if(!identity.ok||identity.data?.length!==1||identity.data[0].id!==tenant)throw Error('Tenant identity unavailable');
  const manifest={version:'learn-preservation/1',project_ref:projectRef,tenant_id:tenant,cutoff:now,observed_at:null,sources:{},storage:{complete:false,objects:[],recordings_matched:0,recordings_missing:0,recordings_unverified:0}};
  const recordingPaths=new Map();
  for(const table of SOURCES) {
    const select=table==='phone_recordings'?'id,tenant_id,storage_path':table==='phone_transcripts'?'id,tenant_id,status':'id,tenant_id';
    const base={select,tenant_id:`eq.${tenant}`,created_at:`lte.${now}`};
    const start=await request(`/rest/v1/${table}`,{method:'HEAD',query:base});
    const rows=[],seen=new Set();let cursor=null,complete=start.ok&&start.count!==null;
    for(let page=0;complete&&page<1000;page++) {
      const response=await request(`/rest/v1/${table}`,{query:{...base,order:'id.asc',limit:'1000',...(cursor?{id:`gt.${cursor}`}:{})}});
      if(!response.ok||!Array.isArray(response.data)){complete=false;break;}
      if(response.data.some((r,i)=>r.tenant_id!==tenant||!uuid.test(r.id)||seen.has(r.id)||(cursor&&r.id<=cursor)||(i>0&&r.id<=response.data[i-1].id))){complete=false;break;}
      for(const r of response.data){seen.add(r.id);const out={id:r.id};
        if(table==='phone_recordings'){out.storage_pointer_hash=typeof r.storage_path==='string'?sha(r.storage_path):null;if(r.storage_path)recordingPaths.set(r.id,r.storage_path);}
        if(table==='phone_transcripts')out.status=typeof r.status==='string'?r.status:'unknown';
        rows.push(out);
      }
      if(response.data.length<1000)break;
      cursor=response.data.at(-1).id;
      if(page===999)complete=false;
    }
    const end=complete?await request(`/rest/v1/${table}`,{method:'HEAD',query:base}):null;
    complete=complete&&end.ok&&start.count===end.count&&rows.length===end.count;
    manifest.sources[table]={complete,count:start.count??null,rows};
  }
  // Enumerate only folders referenced by this tenant's recording rows. Storage
  // list is a read-only POST, not upload, download, delete or provider recovery.
  const folders=new Set();
  for(const path of recordingPaths.values())if(typeof path==='string'&&path.startsWith(`${tenant}/`)&&!path.split('/').some(s=>s==='..'||s==='.'||s===''))folders.add(path.slice(0,path.lastIndexOf('/')));
  const objects=new Map();let storageComplete=manifest.sources.phone_recordings.complete;
  for(const prefix of folders) {
    let exhausted=false;
    for(let offset=0;offset<1000000;offset+=1000){const r=await request('/storage/v1/object/list/phone-recordings',{method:'POST',body:{prefix,limit:1000,offset,sortBy:{column:'name',order:'asc'}}});
      if(!r.ok||!Array.isArray(r.data)){storageComplete=false;break;}
      for(const item of r.data){if(!item.id)continue;const path=`${prefix}/${item.name}`;objects.set(sha(path),{path_hash:sha(path),size:Number.isFinite(item.metadata?.size)?item.metadata.size:null,updated_at:typeof item.updated_at==='string'?item.updated_at:null});}
      if(r.data.length<1000){exhausted=true;break;}
    }
    if(!exhausted)storageComplete=false;
  }
  manifest.storage.complete=storageComplete;
  manifest.storage.objects=[...objects.values()].sort((a,b)=>a.path_hash.localeCompare(b.path_hash));
  for(const r of manifest.sources.phone_recordings.rows){const object=objects.get(r.storage_pointer_hash);if(object&&object.size>44)manifest.storage.recordings_matched++;else if(!storageComplete)manifest.storage.recordings_unverified++;else manifest.storage.recordings_missing++;}
  manifest.observed_at=new Date().toISOString();
  return manifest;
}

export function summarizePreservation(manifest) {
  const transcripts=manifest.sources.phone_transcripts;
  const statuses={};if(transcripts.complete)for(const r of transcripts.rows)statuses[r.status]=(statuses[r.status]??0)+1;
  return {version:manifest.version,project_ref:manifest.project_ref,tenant_id:manifest.tenant_id,cutoff:manifest.cutoff,observed_at:manifest.observed_at,
    sources:Object.fromEntries(Object.entries(manifest.sources).map(([key,value])=>[key,{complete:value.complete,count:value.complete?value.rows.length:null}])),
    transcript_statuses:transcripts.complete?statuses:null,
    storage:{complete:manifest.storage.complete,objects:manifest.storage.objects.length,recordings_matched:manifest.storage.recordings_matched,recordings_missing:manifest.storage.recordings_missing,recordings_unverified:manifest.storage.recordings_unverified},
    limitations:['Not a transactionally consistent database snapshot or a backup.','Storage metadata confirms object presence and size, not playable audio.','A changed row set needs investigation; a higher total alone cannot prove preservation.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const destination=process.argv[2];if(!destination)throw Error('Supply an ignored private manifest output path');
  const env=process.env;
  const result=await collectPreservation({origin:(env.SUPABASE_URL??'').replace(/\/$/,''),projectRef:env.VERIFY_ALLOW_PROJECT_REF,tenant:env.VERIFY_TENANT,token:env.SUPABASE_SERVICE_ROLE_KEY});
  await mkdir(dirname(resolve(destination)),{recursive:true});await writeFile(destination,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
  const summary=summarizePreservation(result);
  if(process.argv[3])summary.comparison=comparePreservation(JSON.parse(await readFile(process.argv[3],'utf8')),result);
  console.log(JSON.stringify(summary,null,2));
}
