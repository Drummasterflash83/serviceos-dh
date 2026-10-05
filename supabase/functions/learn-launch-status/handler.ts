import {linkedRecordingIds} from './linked-recordings.ts';
/** Existing tenant JWT + user-RLS reads only. No provider calls or mutations. */
export type Actor={userId:string;tenantId:string;role:string};
type Result={data?:any;count?:number|null;error?:unknown};
export interface ReadClient{from(table:string):{select(columns:string,options?:{count:'exact'}):any}}
type Authorize=()=>Promise<Actor|null>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const unavailable=()=>({read_status:'unavailable' as const,record_count:null,latest_record_at:null});
const fail=(status:number,code:string)=>({status,body:{error:{code,message:'LEARN is unavailable or not authorised.'}}});
async function query(run:()=>PromiseLike<Result>):Promise<Result>{try{return await run();}catch{return {error:true};}}
function total(r:Result){return !r.error&&Number.isSafeInteger(r.count)&&r.count!>=0?r.count!:null;}
function stored(r:Result,now:number){const count=total(r);if(count===null||!Array.isArray(r.data))return unavailable();if(count===0)return r.data.length===0?{read_status:'ok' as const,record_count:0,latest_record_at:null}:unavailable();const at=r.data[0]?.created_at;return r.data.length===1&&typeof at==='string'&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=now?{read_status:'ok' as const,record_count:count,latest_record_at:at}:unavailable();}
function latest(r:Result,key:string,now:number){const at=!r.error&&Array.isArray(r.data)?r.data[0]?.[key]:null;return typeof at==='string'&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=now?at:null;}
export async function readLaunchStatus(body:unknown,db:ReadClient,authorize:Authorize,clock:()=>number=Date.now){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!uuid((body as any).tenant_id))return fail(400,'invalid_request');
 const tenant=(body as any).tenant_id as string,actor=await authorize();
 if(!actor)return fail(401,'unauthorised');if(actor.tenantId!==tenant)return fail(403,'tenant_mismatch');
 const start=clock();
 const count=(table:string)=>query(()=>db.from(table).select('created_at',{count:'exact'}).eq('tenant_id',tenant).order('created_at',{ascending:false,nullsFirst:false}).limit(1));
 const [phone,email,recordings,accounts,mailboxes,selected,removed,emailSync,phoneSync,voicemails,recentCalls,inboxLabels,sentLabels,draftLabels]=await Promise.all([
  count('phone_calls'),count('email_messages'),count('phone_recordings'),
  query(()=>db.from('email_accounts').select('status').eq('tenant_id',tenant).limit(101)),
  query(()=>db.from('google_workspace_mailboxes').select('id',{count:'exact'}).eq('tenant_id',tenant).limit(1)),
  query(()=>db.from('google_workspace_mailboxes').select('id',{count:'exact'}).eq('tenant_id',tenant).eq('sync_enabled',true).neq('status','removed').limit(1)),
  query(()=>db.from('google_workspace_mailboxes').select('id',{count:'exact'}).eq('tenant_id',tenant).eq('status','removed').limit(1)),
  query(()=>db.from('email_sync_runs').select('completed_at').eq('tenant_id',tenant).eq('status','success').in('sync_type',['messages','scheduled_sync','workspace_messages','workspace_scheduled_sync','workspace_backfill']).order('completed_at',{ascending:false,nullsFirst:false}).limit(1)),
  query(()=>db.from('phone_sync_runs').select('completed_at').eq('tenant_id',tenant).eq('status','success').eq('sync_type','calls').order('completed_at',{ascending:false,nullsFirst:false}).limit(1)),
  count('receptionist_voicemails'),
  query(()=>db.from('phone_calls').select('id,provider_call_id,linked_id,direction,started_at,duration_seconds').eq('tenant_id',tenant).order('started_at',{ascending:false,nullsFirst:false}).limit(10)),
  ...['INBOX','SENT','DRAFT'].map(label=>query(()=>db.from('email_messages').select('id',{count:'exact'}).eq('tenant_id',tenant).contains('raw_payload',{label_ids:[label]}).limit(1))),
 ]);
 // Bounded metadata reconciliation: direct leg OR linked family; dedupe by recording ID.
 const usableCalls=!recentCalls.error&&Array.isArray(recentCalls.data)&&recentCalls.data.length<=10;
 const keys=(field:string)=>usableCalls?[...new Set(recentCalls.data!.map((r:any)=>r[field]).filter((v:any)=>typeof v==='string'&&v.length>0))]:[];
 const readRecordings=(field:string,values:unknown[])=>values.length?query(()=>db.from('phone_recordings').select('tenant_id,id,provider_call_id,linked_id').eq('tenant_id',tenant).in(field,values).limit(1001)):Promise.resolve({data:[]} as Result);
 const [directRecordings,familyRecordings]=await Promise.all([readRecordings('provider_call_id',keys('provider_call_id')),readRecordings('linked_id',keys('linked_id'))]);
 const recordingRows=[directRecordings,familyRecordings].every(r=>!r.error&&Array.isArray(r.data)&&r.data.length<=1000)?[...directRecordings.data!,...familyRecordings.data!]:null;
 function recordingIds(call:any){try{return recordingRows?linkedRecordingIds(tenant,{...call,tenant_id:tenant},recordingRows):null;}catch{return null;}}
 const current=await authorize(),now=clock();if(!current||current.userId!==actor.userId||current.tenantId!==tenant||current.role!==actor.role)return fail(403,'authority_changed');
 if(!Number.isFinite(start)||!Number.isFinite(now)||now<start||now>=start+60000)return fail(503,'observation_expired');
 const validAccounts=!accounts.error&&Array.isArray(accounts.data)&&accounts.data.length<=100;
 return {status:200,body:{version:'learn-launch/1',tenant_id:tenant,observed_at:new Date(now).toISOString(),valid_until:new Date(start+60000).toISOString(),
  counts:{version:'learn-status/1',tenant_id:tenant,observed_at:new Date(now).toISOString(),valid_until:new Date(start+60000).toISOString(),phone:stored(phone,now),email:stored(email,now)},
  recordings:stored(recordings,now),voicemails:stored(voicemails,now),email:{accounts:validAccounts?accounts.data!.length:null,disabled_accounts:validAccounts?accounts.data!.filter((a:any)=>a.status==='disabled').length:null,mailboxes:total(mailboxes),selected_mailboxes:total(selected),removed_mailboxes:total(removed),last_successful_message_sync_at:latest(emailSync,'completed_at',now),stored_label_counts:{inbox:total(inboxLabels),sent:total(sentLabels),draft:total(draftLabels)},label_scope:'stored_current_metadata',draft_lifecycle:'unverified',coverage:'unverified',pause_deferral_reason:'unavailable'},
  phone:{last_successful_call_sync_at:latest(phoneSync,'completed_at',now),provider_coverage:'unverified',recent_calls:!recentCalls.error&&Array.isArray(recentCalls.data)&&recentCalls.data.length<=10&&recentCalls.data.every((r:any)=>uuid(r.id)&&[null,undefined,'IN','OUT'].includes(r.direction)&&(r.started_at==null||typeof r.started_at==='string'&&Number.isFinite(Date.parse(r.started_at))&&Date.parse(r.started_at)<=now)&&(r.linked_id==null||typeof r.linked_id==='string'))?recentCalls.data.map((r:any)=>({id:r.id,linked_id:r.linked_id??null,raw_direction:r.direction??null,started_at:r.started_at??null,duration_seconds:r.duration_seconds??null,recording_ids:recordingIds(r)})):null,recording_scope:'direct_or_linked_family_metadata',direction_scope:'raw_provider',family_audio_coverage:'unverified'},slack:{notifications_enabled:null,message_ingestion:'unavailable'},emma:{stored_observation:'unavailable'},acceptance:'not_live_verified'}};
}
