/** Read-only diagnosis: failed transcript metadata + three completed examples.
 * Reads at most one initial audio chunk per sample, keeps only format metadata,
 * and never saves audio bytes, transcript text, tokens or provider error prose. */
import {createHash} from 'node:crypto';
import {inspectAudioHeader} from './audio-header.mjs';
const env=process.env,tenant=env.VERIFY_TENANT,ref=env.VERIFY_ALLOW_PROJECT_REF;
const origin=(env.SUPABASE_URL??'').replace(/\/$/,'');
if(!/^[a-z0-9]{20}$/.test(ref??'')||origin!==`https://${ref}.supabase.co`||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(tenant??'')||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Invalid audio audit scope');
const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
async function rows(table,query){const url=new URL(`/rest/v1/${table}`,origin);url.searchParams.set('tenant_id',`eq.${tenant}`);for(const [k,v]of Object.entries(query))url.searchParams.set(k,v);try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)return null;const data=await r.json();return Array.isArray(data)?data:null;}catch{return null;}}
async function header(path){
 if(typeof path!=='string'||!path.startsWith(`${tenant}/`)||path.split('/').some(p=>p==='..'||p==='.'||!p))return {status:'invalid_pointer'};
 try{const url=new URL('/storage/v1/object/authenticated/phone-recordings/'+path.split('/').map(encodeURIComponent).join('/'),origin);const r=await fetch(url,{headers:{...headers,Range:'bytes=0-63'},signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!r.ok||!r.body)return {status:'unavailable',http_status:r.status};
 const reader=r.body.getReader();let prefix=new Uint8Array(0);
 try{while(prefix.length<64){const part=await reader.read();if(part.done)break;const copy=part.value.slice(0,64-prefix.length),next=new Uint8Array(prefix.length+copy.length);next.set(prefix);next.set(copy,prefix.length);prefix=next;}}finally{await reader.cancel();}
 const contentRange=r.headers.get('content-range');const total=contentRange?.split('/')[1];
 return {...inspectAudioHeader(prefix),object_bytes:total&&/^\d+$/.test(total)?Number(total):null};
 }catch{return {status:'unavailable'};}
}
const failed=await rows('phone_transcripts',{select:'id,recording_id,status,updated_at',status:'eq.failed',order:'updated_at.desc',limit:'100'});
const completed=await rows('phone_transcripts',{select:'id,recording_id,status,updated_at',status:'eq.completed',order:'updated_at.desc',limit:'3'});
if(!failed||!completed)throw Error('Transcript audit list unavailable');
const report=[];
for(const transcript of [...failed,...completed]){
 if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(transcript.recording_id??''))continue;
 const recordings=await rows('phone_recordings',{select:'id,storage_path,file_size,duration_seconds,started_at',id:`eq.${transcript.recording_id}`,limit:'1'});
 const r=recordings?.[0];const runs=await rows('phone_sync_runs',{select:'status,started_at,completed_at,error_code:metadata->>error_code,provider_status:metadata->>provider_status,audio_bytes:metadata->>audio_bytes',sync_type:'eq.transcription','metadata->>recording_id':`eq.${transcript.recording_id}`,order:'started_at.desc',limit:'3'});
 report.push({recording_fingerprint:createHash('sha256').update(transcript.recording_id).digest('hex').slice(0,16),transcript_status:transcript.status,transcript_updated_at:transcript.updated_at,provider_file_size:r?.file_size??null,provider_duration_seconds:r?.duration_seconds??null,recording_started_at:r?.started_at??null,storage:r?await header(r.storage_path):{status:'recording_unavailable'},recent_attempts:runs?.map(run=>({...run,error_code:typeof run.error_code==='string'&&/^[a-z0-9_]{1,100}$/.test(run.error_code)?run.error_code:null}))??null});
}
console.log(JSON.stringify({observed_at:new Date().toISOString(),project_ref:ref,tenant_id:tenant,failed_list_truncated:failed.length===100,samples:report,limitations:['Read-only; no retries or paid processing started.','Header recognition is not a complete audio decode or playback check.','Three recently completed examples do not prove every recording is playable.']},null,2));
