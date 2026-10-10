import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectPreservation,comparePreservation,summarizePreservation} from './learn-preservation.mjs';
const tenant='00000000-0000-4000-8000-000000000001',projectRef='abcdefghijklmnopqrst',origin=`https://${projectRef}.supabase.co`;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const record=(n,extra={})=>({id:id(n),tenant_id:tenant,...extra});
const cutoff='2026-10-09T12:00:00Z';
function fixture({failure,duplicate,foreign,storageFailure,rowCap=1000,exactFails=false}={}){
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url:String(url),method:options.method,body:options.body,headers:options.headers});
  assert.equal(url.origin,origin);assert.equal(options.redirect,'error');
  if(url.pathname==='/rest/v1/tenants')return Response.json([{id:tenant,display_name:'Fixture company'}]);
  if(url.pathname==='/storage/v1/object/list/phone-recordings'){
   assert.equal(options.method,'POST');assert.ok(JSON.parse(options.body).prefix.startsWith(tenant+'/'));
   return storageFailure?new Response(null,{status:503}):Response.json(JSON.parse(options.body).offset>0?[]:[{id:id(77),name:'recording.wav',metadata:{size:1234},updated_at:cutoff}]);
  }
  assert.equal(url.searchParams.get('tenant_id'),`eq.${tenant}`);assert.equal(url.searchParams.get('created_at'),`lte.${cutoff}`);
  assert.ok(['GET','HEAD'].includes(options.method));
  const table=url.pathname.split('/').at(-1);
  if(table===failure)return new Response(null,{status:503});
  let rows=table==='email_messages'?Array.from({length:1002},(_,i)=>record(i+1)):
   table==='phone_recordings'?[record(1,{storage_path:`${tenant}/simwood/recordings/recording.wav`}),record(2,{storage_path:`${tenant}/simwood/recordings/missing.wav`})]:
   table==='phone_transcripts'?[record(1,{status:'completed'}),record(2,{status:'failed'})]:[];
  const count=rows.length;
  if(options.method==='HEAD'&&exactFails)return new Response(null,{status:500});
  if(options.method==='HEAD')return new Response(null,{headers:{'content-range':`*/${count}`}});
  const after=url.searchParams.get('id')?.slice(3);if(after)rows=rows.filter(r=>r.id>after);rows=rows.slice(0,rowCap);
  if(table==='email_messages'&&duplicate&&rows.length>1)rows[1]=rows[0];
  if(table==='email_messages'&&foreign&&rows.length)rows[0]={...rows[0],tenant_id:id(99)};
  return Response.json(rows,{headers:{'content-range':`0-${rows.length}/${count}`}});
 };
 return {fetcher,calls};
}
const collect=(options,configuration={})=>{const f=fixture(options);return collectPreservation({origin,projectRef,tenant,token:'fixture-only',fetcher:f.fetcher,now:cutoff,...configuration}).then(m=>({m,calls:f.calls}));};
test('read-only scoped inventory paginates IDs, separates transcript status and reconciles stored objects',async()=>{
 const {m,calls}=await collect();const summary=summarizePreservation(m);
 assert.equal(m.sources.email_messages.rows.length,1002);assert.equal(m.sources.email_messages.complete,true);
 assert.deepEqual(summary.transcript_statuses,{completed:1,failed:1});
 assert.equal(summary.storage.recordings_matched,1);assert.equal(summary.storage.recordings_missing,1);
 assert.ok(!JSON.stringify(m).includes('recording.wav'),'manifest uses hashed storage paths');
 assert.ok(!JSON.stringify(summary).includes(id(77)));
 assert.ok(calls.some(c=>c.url.includes('id=gt.')));
});
test('failed, duplicate and foreign responses cannot masquerade as a complete source baseline',async()=>{
 for(const options of [{failure:'email_messages'},{duplicate:true},{foreign:true}]){
  const {m}=await collect(options);assert.equal(m.sources.email_messages.complete,false);assert.equal(summarizePreservation(m).sources.email_messages.count,null);
 }
 const {m}=await collect({storageFailure:true});assert.equal(m.storage.complete,false);assert.equal(m.storage.recordings_missing,0);assert.equal(m.storage.recordings_unverified,2);
});
test('equal or higher totals cannot conceal an older record disappearing',async()=>{
 const {m}=await collect();const next=structuredClone(m);
 next.sources.email_messages.rows.shift();next.sources.email_messages.rows.push({id:id(5000)},{id:id(5001)});
 const result=comparePreservation(m,next);assert.equal(result.comparison_state,'changed');assert.equal(result.sources.email_messages.status,'changed');assert.equal(result.sources.email_messages.missing_rows,1);assert.equal(result.sources.email_messages.current_count,1003);
 assert.throws(()=>comparePreservation(m,{...next,tenant_id:id(99)}));
});
test('storage pointer and object changes remain visible independently from row retention',async()=>{
 const {m}=await collect();const next=structuredClone(m);next.sources.phone_recordings.rows[0].storage_pointer_hash='changed';next.storage.objects[0].size=1;
 const result=comparePreservation(m,next);assert.equal(result.sources.phone_recordings.changed_storage_pointers,1);assert.equal(result.storage.changed_objects,1);
});
test('an unverified follow-up never confirms preservation',async()=>{
 const {m}=await collect();const next=structuredClone(m);next.sources.email_messages.complete=false;next.storage.complete=false;
 const result=comparePreservation(m,next);assert.equal(result.complete,false);assert.equal(result.comparison_state,'unverified');assert.equal(result.sources.email_messages.status,'unverified');
});

test('ordinary page and storage reads never ask for expensive exact counts',async()=>{
 const {calls}=await collect();for(const call of calls)assert.equal(call.headers.Prefer,call.method==='HEAD'?'count=exact':undefined);
});
test('double keyset scans exhaust short server pages without a global count query',async()=>{
 const {m,calls}=await collect({rowCap:73,exactFails:true},{scanMode:'double_keyset'});
 assert.equal(m.version,'learn-preservation/2');assert.equal(m.scan_mode,'double_keyset');assert.equal(m.sources.email_messages.complete,true);assert.equal(m.sources.email_messages.count,1002);assert.equal(m.sources.email_messages.rows.length,1002);
 assert.equal(m.storage.complete,true);assert.ok(calls.every(c=>c.method!=='HEAD'&&c.headers.Prefer===undefined));
 const zeroCalls=calls.filter(c=>c.url.includes('/rest/v1/jobs'));assert.equal(zeroCalls.length,2,'two exhausted empty passes establish known zero');
 assert.equal(comparePreservation((await collect()).m,m).comparison_state,'preserved');
});
test('same-count replacements, changed pointers and changed transcript states invalidate a double scan',async()=>{
 for(const table of ['email_messages','phone_recordings','phone_transcripts']){
  const f=fixture();let pass=0;
  const fetcher=async(url,opts)=>{
   const response=await f.fetcher(url,opts);
   if(url.pathname===`/rest/v1/${table}`&&opts.method==='GET'){
    if(!url.searchParams.has('id'))pass++;
    const data=await response.json();
    if(pass===2&&data.length){if(table==='email_messages'&&!url.searchParams.has('id'))data[0].id=id(0);if(table==='phone_recordings')data[0].storage_path=`${tenant}/simwood/recordings/changed.wav`;if(table==='phone_transcripts')data[0].status='failed';}
    return Response.json(data);
   }
   return response;
  };
  const m=await collectPreservation({origin,projectRef,tenant,token:'fixture',fetcher,now:cutoff,scanMode:'double_keyset'});
  assert.equal(m.sources[table].complete,false,table);assert.equal(m.sources[table].count,null);assert.equal(summarizePreservation(m).sources[table].count,null);
 }
});
test('failed, duplicate and foreign pages stay unverified in count-free mode',async()=>{
 for(const options of [{failure:'email_messages'},{duplicate:true},{foreign:true}]){
  const {m}=await collect(options,{scanMode:'double_keyset'});assert.equal(m.sources.email_messages.complete,false);
 }
});
test('request and response budgets stop reads without inventing complete counts or exposing errors',async()=>{
 const {m,calls}=await collect({}, {scanMode:'double_keyset',requestBudget:5});assert.equal(calls.length,5);assert.equal(m.requests,5);assert.equal(m.sources.email_messages.complete,false);assert.deepEqual(m.read_errors,[{kind:'request_budget'}]);
 const f=fixture();const fetcher=(url,opts)=>url.pathname.endsWith('/email_messages')?new Response('PRIVATE'.repeat(1500000)):f.fetcher(url,opts);
 const oversized=await collectPreservation({origin,projectRef,tenant,token:'fixture',fetcher,now:cutoff,scanMode:'double_keyset'});
 assert.equal(oversized.sources.email_messages.complete,false);assert.equal(oversized.read_errors[0].kind,'transport_or_response');assert.ok(!JSON.stringify(oversized).includes('PRIVATE'));
 await assert.rejects(collectPreservation({origin,projectRef,tenant,token:'fixture',scanMode:'skip',fetcher:()=>assert.fail()}),/scan options/);
});
test('storage list repetition cannot appear to be an exhausted complete catalogue',async()=>{
 const f=fixture();const fetcher=async(url,opts)=>{
  if(url.pathname.includes('/storage/'))return Response.json([{id:id(77),name:'recording.wav',metadata:{size:1234},updated_at:cutoff}]);
  return f.fetcher(url,opts);
 };
 const m=await collectPreservation({origin,projectRef,tenant,token:'fixture',fetcher,now:cutoff,scanMode:'double_keyset'});
 assert.equal(m.storage.complete,false);assert.equal(m.storage.recordings_unverified,1);assert.equal(m.storage.recordings_missing,0);
});
