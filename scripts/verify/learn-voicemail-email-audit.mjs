/** Read-only discovery of possible voicemail notification emails. Subject matches
 * and attachment metadata are clues, never authenticated provider-message proof.
 * No bodies, sender addresses, filenames, audio or raw payloads are retained. */
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const hash=value=>createHash('sha256').update(value).digest('hex');
const PAGE=250,MAX_PAGES=80,MAX_BODY=2*1024*1024;
const MATCH='(subject.ilike.*voicemail*,subject.ilike.*voice mail*,subject.ilike.*voice-mail*)';
const audioMime=/^audio\/[a-z0-9.+-]+$/i;
const audioExtension=/\.(wav|wave|mp3|ogg|oga|m4a|aac|flac|gsm|amr|wma)$/i;

async function boundedJson(response){
  if(!response.body)throw Error('empty');
  const reader=response.body.getReader(),parts=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BODY)throw Error('size');parts.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
function count(response){const raw=response.headers.get('content-range')?.split('/')[1];return /^\d+$/.test(raw??'')&&Number.isSafeInteger(Number(raw))?Number(raw):null;}
export function attachmentSignals(row){
  return {audioMime:typeof row.mime_type==='string'&&audioMime.test(row.mime_type),
    audioFilename:typeof row.filename==='string'&&audioExtension.test(row.filename),
    storedPointer:typeof row.storage_path==='string'&&row.storage_path.length>0,
    positiveBytes:Number.isSafeInteger(row.size_bytes)&&row.size_bytes>0};
}
export async function auditVoicemailEmails({origin,projectRef,tenant,token,fetcher=fetch,cutoff=new Date().toISOString()}){
  if(!/^[a-z0-9]{20}$/.test(projectRef??'')||origin!==`https://${projectRef}.supabase.co`||!UUID.test(tenant??'')||!token||!Number.isFinite(Date.parse(cutoff)))throw Error('Invalid voicemail email audit scope');
  cutoff=new Date(cutoff).toISOString();
  const headers={apikey:token,Authorization:`Bearer ${token}`,Prefer:'count=exact'};
  let requests=0;
  const readFailures=[];
  async function request(table,query,method='GET'){
    if(requests>=200)return {ok:false};
    requests++;
    const url=new URL(`/rest/v1/${table}`,origin);for(const [k,v]of Object.entries(query))url.searchParams.set(k,v);
    try{const r=await fetcher(url,{method,headers,redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!r.ok){await r.body?.cancel().catch(()=>{});readFailures.push({table,method,kind:'http',status:r.status});return {ok:false};}
      return {ok:true,count:count(r),data:method==='HEAD'?null:await boundedJson(r)};
    }catch(error){readFailures.push({table,method,kind:error?.name==='TimeoutError'?'timeout':'transport_or_response'});return {ok:false};}
  }
  const identity=await request('tenants',{select:'id',id:`eq.${tenant}`,limit:'1'});
  if(!identity.ok||identity.data?.length!==1||identity.data[0].id!==tenant)throw Error('Tenant identity unavailable');
  const base={tenant_id:`eq.${tenant}`,created_at:`lte.${cutoff}`};
  const total=await request('email_messages',{...base,select:'id'},'HEAD');
  async function scan(table,query,validate){
    const start=await request(table,query,'HEAD');
    if(!start.ok||start.count===null||start.count>PAGE*MAX_PAGES)return {complete:false,rows:[],expected:start.count??null};
    const rows=[],seen=new Set();let cursor=null,complete=false;
    for(let page=0;page<MAX_PAGES;page++){
      const r=await request(table,{...query,order:'id.asc',limit:String(PAGE),...(cursor?{id:`gt.${cursor}`}:{})});
      if(!r.ok||!Array.isArray(r.data)||r.data.length>PAGE||r.data.some((v,i)=>!v||v.tenant_id!==tenant||!UUID.test(v.id??'')||seen.has(v.id)||(cursor&&v.id<=cursor)||(i&&v.id<=r.data[i-1].id)||!validate(v)))break;
      for(const v of r.data){seen.add(v.id);rows.push(v);}
      if(rows.length>start.count)break;
      if(r.data.length<PAGE||rows.length===start.count){complete=true;break;}
      cursor=r.data.at(-1).id;
    }
    const end=complete?await request(table,query,'HEAD'):null;
    complete=complete&&end.ok&&end.count===start.count&&rows.length===end.count;
    return {complete,rows,expected:start.count};
  }
  // Matching takes place on the server. Do not fetch email subjects or bodies.
  const messages=await scan('email_messages',{...base,or:MATCH,select:'id,tenant_id,direction,attachment_hint:raw_payload->has_attachments'},v=>['inbound','outbound',null].includes(v.direction)&&(v.attachment_hint===null||typeof v.attachment_hint==='boolean'));
  const candidates=messages.rows.map(r=>({messageId:r.id,direction:r.direction??'unknown',attachmentHint:r.attachment_hint===true,attachmentMetadataComplete:false,attachments:0,audioMimeAttachments:0,audioFilenameAttachments:0,audioCandidatesWithPointer:0,audioCandidatesWithPositiveBytes:0}));
  // Limit every attachment request to retained candidate message IDs. A partial
  // email scan still reports its observations, never complete coverage.
  for(let at=0;at<candidates.length;at+=50){
    const batch=candidates.slice(at,at+50),byId=new Map(batch.map(c=>[c.messageId,c]));
    const attachments=await scan('email_attachments',{...base,message_id:`in.(${batch.map(c=>c.messageId).join(',')})`,select:'id,tenant_id,message_id,mime_type,filename,size_bytes,storage_path'},r=>byId.has(r.message_id));
    for(const c of batch)c.attachmentMetadataComplete=attachments.complete;
    for(const row of attachments.rows){const c=byId.get(row.message_id),s=attachmentSignals(row);c.attachments++;if(s.audioMime)c.audioMimeAttachments++;if(s.audioFilename)c.audioFilenameAttachments++;
      if(s.audioMime||s.audioFilename){if(s.storedPointer)c.audioCandidatesWithPointer++;if(s.positiveBytes)c.audioCandidatesWithPositiveBytes++;}}
  }
  const after=await request('email_messages',{...base,select:'id'},'HEAD');
  const totalStable=total.ok&&after.ok&&total.count!==null&&total.count===after.count;
  const complete=messages.complete&&candidates.every(c=>c.attachmentMetadataComplete)&&totalStable;
  const report={version:'learn-voicemail-email-audit/1',projectRef,tenantId:tenant,cutoff,observedAt:new Date().toISOString(),status:complete?'complete_for_subject_query':'unverified',
    storedEmailsAtCutoff:totalStable?total.count:null,subjectQueryComplete:messages.complete,expectedSubjectMatches:messages.expected,observedSubjectMatches:candidates.length,
    directions:{inbound:0,outbound:0,unknown:0},withAttachmentHint:0,withAttachmentMetadata:0,withAudioMetadata:0,withAudioPointer:0,
    requests,readFailures,candidates:candidates.map(({messageId,...c})=>({messageFingerprint:hash(`${projectRef}:${tenant}:${messageId}`),...c})),
    limitations:['Subject matches are candidates, not verified voicemail messages or evidence of Birchills origin.',
      'Only subjects containing voicemail, voice mail or voice-mail are matched; other subjects, bodies and unimported mail are outside coverage.',
      'An attachment hint is not retained attachment metadata; a storage pointer is not downloaded or playable audio.',
      'Existing imported metadata does not establish sender authentication, mailbox ownership, provider message identity or notification delivery.',
      'Stable counts are not a transactionally consistent snapshot and cannot detect all concurrent edits.',
      'Read-only: no provider request, email-body or audio download, import, transcription, notification or access change.']};
  for(const c of candidates){report.directions[c.direction]++;if(c.attachmentHint)report.withAttachmentHint++;if(c.attachments)report.withAttachmentMetadata++;if(c.audioMimeAttachments||c.audioFilenameAttachments)report.withAudioMetadata++;if(c.audioCandidatesWithPointer)report.withAudioPointer++;}
  // Private references permit subsequent explicitly scoped sample inspection.
  // Caller must keep these outside committed reports; no email text is included.
  return {report,privateReferences:candidates.map(c=>({messageId:c.messageId,messageFingerprint:hash(`${projectRef}:${tenant}:${c.messageId}`)}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const env=process.env;
  const result=await auditVoicemailEmails({origin:(env.SUPABASE_URL??'').replace(/\/$/,''),projectRef:env.VERIFY_ALLOW_PROJECT_REF,tenant:env.VERIFY_TENANT,token:env.SUPABASE_SERVICE_ROLE_KEY});
  if(process.argv[2]){const path=resolve(process.argv[2]);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});}
  console.log(JSON.stringify(result.report,null,2));
  if(result.report.status==='unverified')process.exitCode=2;
}
