import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectPreservation,comparePreservation,summarizePreservation} from './learn-preservation.mjs';
const tenant='00000000-0000-4000-8000-000000000001',projectRef='abcdefghijklmnopqrst',origin=`https://${projectRef}.supabase.co`;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const record=(n,extra={})=>({id:id(n),tenant_id:tenant,...extra});
const cutoff='2026-10-09T12:00:00Z';
function fixture({failure,duplicate,foreign,storageFailure}={}){
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url:String(url),method:options.method,body:options.body});
  assert.equal(url.origin,origin);assert.equal(options.redirect,'error');
  if(url.pathname==='/rest/v1/tenants')return Response.json([{id:tenant,display_name:'Fixture company'}]);
  if(url.pathname==='/storage/v1/object/list/phone-recordings'){
   assert.equal(options.method,'POST');assert.ok(JSON.parse(options.body).prefix.startsWith(tenant+'/'));
   return storageFailure?new Response(null,{status:503}):Response.json([{id:id(77),name:'recording.wav',metadata:{size:1234},updated_at:cutoff}]);
  }
  assert.equal(url.searchParams.get('tenant_id'),`eq.${tenant}`);assert.equal(url.searchParams.get('created_at'),`lte.${cutoff}`);
  assert.ok(['GET','HEAD'].includes(options.method));
  const table=url.pathname.split('/').at(-1);
  if(table===failure)return new Response(null,{status:503});
  let rows=table==='email_messages'?Array.from({length:1002},(_,i)=>record(i+1)):
   table==='phone_recordings'?[record(1,{storage_path:`${tenant}/simwood/recordings/recording.wav`}),record(2,{storage_path:`${tenant}/simwood/recordings/missing.wav`})]:
   table==='phone_transcripts'?[record(1,{status:'completed'}),record(2,{status:'failed'})]:[];
  const count=rows.length;
  if(options.method==='HEAD')return new Response(null,{headers:{'content-range':`*/${count}`}});
  const after=url.searchParams.get('id')?.slice(3);if(after)rows=rows.filter(r=>r.id>after);rows=rows.slice(0,1000);
  if(table==='email_messages'&&duplicate&&rows.length>1)rows[1]=rows[0];
  if(table==='email_messages'&&foreign&&rows.length)rows[0]={...rows[0],tenant_id:id(99)};
  return Response.json(rows,{headers:{'content-range':`0-${rows.length}/${count}`}});
 };
 return {fetcher,calls};
}
const collect=options=>{const f=fixture(options);return collectPreservation({origin,projectRef,tenant,token:'fixture-only',fetcher:f.fetcher,now:cutoff}).then(m=>({m,calls:f.calls}));};
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
