/** Read-only canonical-source keyset protocol. No credentials or HTTP client. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const SOURCE_TABLES=['email_messages','phone_calls','phone_recordings','phone_transcripts','slack_messages',
 'slack_message_versions','receptionist_voicemails','customer_cards','jobs','people','companies'];
const FIELDS=['id','raw_payload','provider_payload','message_text','source_version','storage_path','storage_bucket',
 'audio_path','recording_url','source_external_id','provider_call_id','linked_id','source_storage_path','source_sha256',
 'transcript_text','provider','provider_message_id','provider_thread_id','from_email','from_name','to_emails','cc_emails',
 'subject','snippet','body_text','body_html','sent_at','received_at','direction','recording_path','transcript'];
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function sourceFingerprintQuery({table,tenant,cutoff,cursor=null,columns,pageSize=2000}){
 if(!SOURCE_TABLES.includes(table)||!UUID.test(tenant)||
  !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00(?::00)?)$/.test(cutoff)||
  !Number.isFinite(Date.parse(cutoff))||(cursor!==null&&!UUID.test(cursor))||
  !Array.isArray(columns)||columns.some(c=>typeof c!=='string')||
  !columns.includes('id')||!columns.includes('tenant_id')||
  !Number.isSafeInteger(pageSize)||pageSize<1||pageSize>2000)
  throw Error('Explicit source keyset scope required');
 const clock=table==='slack_message_versions'?'observed_at':'created_at';
 if(!columns.includes(clock))throw Error('Source cutoff column missing');
 // Gmail's raw_payload is mutable label/history/availability metadata. Bodies,
 // headers and provider identities remain independently protected below.
 const protectedFields=table==='email_messages'?FIELDS.filter(k=>k!=='raw_payload'):FIELDS;
 const fields=protectedFields.map(k=>`'${k}',${columns.includes(k)?
  `case when s.${k} is null then null else encode(sha256(convert_to(s.${k}::text,'UTF8')),'hex') end`:'null::text'}`).join(',');
 return `set local statement_timeout='20s';with scoped as materialized(
  select * from public.${table} where tenant_id='${tenant}'::uuid and ${clock}<='${cutoff}'::timestamptz
  ${cursor?`and id>'${cursor}'::uuid`:''} order by id limit ${pageSize})
  select s.id,md5(jsonb_build_object(${fields})::text) fingerprint from scoped s order by s.id`;
}
export function validateSourcePage(rows,cursor=null,pageSize=2000){
 if(!Array.isArray(rows)||rows.length>pageSize||rows.some((r,i)=>!UUID.test(r?.id)||
  !/^[a-f0-9]{32}$/.test(r?.fingerprint)||(cursor&&r.id<=cursor)||(i&&r.id<=rows[i-1].id)))
  throw Error('Incomplete or unordered source keyset page');
 return rows;
}
export function assertSourcesPreserved(before,after){
 if(before[0]?.cutoff!==after[0]?.cutoff||!Array.isArray(before[0]?.sources)||!Array.isArray(after[0]?.sources))
  throw Error('Complete source preservation cutoff required');
 if(new Set(before[0].sources.map(s=>s.name)).size!==before[0].sources.length||
  new Set(after[0].sources.map(s=>s.name)).size!==after[0].sources.length)throw Error('Duplicate dataset inventory');
 for(const original of before[0].sources){
  const current=after[0].sources.find(x=>x.name===original.name);
  if(!Array.isArray(original.rows)||!Array.isArray(current?.rows)||
   original.count!==original.rows.length||current.count!==current.rows.length)
   throw Error('Complete source identity/digest baseline required');
  validateSourcePage(original.rows,null,original.rows.length);validateSourcePage(current.rows,null,current.rows.length);
  const next=new Map(current.rows.map(r=>[r.id,r.fingerprint]));
  if(original.rows.some(r=>next.get(r.id)!==r.fingerprint))throw Error('Retained source changed: '+original.name);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.slice(2).join(' ')!=='--sql-from-stdin')throw Error('Read-only SQL rendering mode required');
 console.log(sourceFingerprintQuery(JSON.parse(readFileSync(0,'utf8'))));
}
