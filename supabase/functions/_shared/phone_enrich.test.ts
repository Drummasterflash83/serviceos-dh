import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeInteractionForRecording} from './phone_enrich.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={tenantId:id(1),runId:id(2),recordingId:id(3),transcriptId:id(4),insightId:id(5)};
const receipt={version:'learn-phone-handoff/1',state:'committed',...input,callId:id(6),interactionId:id(7),eventId:id(8),sourceFingerprint:'a'.repeat(64),eventPublished:true,alreadyEnriched:false};
function fixture(respond:(phase:string)=>any=()=>({data:receipt,error:null})){
 const phases:string[]=[];
 const admin:any={async rpc(name:string,args:any){assert.equal(name,'learn_phone_handoff');assert.deepEqual(args,{p_tenant:id(1),p_run:id(2),p_recording:id(3),p_transcript:id(4),p_insight:id(5),p_phase:args.p_phase});phases.push(args.p_phase);return respond(args.p_phase);},from(){throw Error('Direct DML forbidden');}};
 return{phases,run:(override:any={})=>finalizeInteractionForRecording({admin,...input,...override})};
}
test('atomic publisher accepts only exact run/source receipt and performs no direct writes',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.ok,true);assert.deepEqual(r.receipt,receipt);assert.deepEqual(f.phases,['publish']);
});
test('lost publication acknowledgement is inspected once without republishing',async()=>{
 const f=fixture(phase=>{if(phase==='publish')throw Error('PRIVATE network failure');return{data:receipt,error:null};});
 assert.equal((await f.run()).ok,true);assert.deepEqual(f.phases,['publish','inspect']);
});
test('foreign, incomplete, inconsistent or unsupported receipts never confirm delivery',async()=>{
 for(const changed of [{version:'old'},{state:'running'},...['tenantId','runId','recordingId','transcriptId','insightId'].map(k=>({[k]:id(99)})),{callId:'invalid'},{interactionId:null},{eventId:null},{eventPublished:false},{eventPublished:'true'},{alreadyEnriched:'false'},{alreadyEnriched:true},{sourceFingerprint:'bad'}]){
  const f=fixture(()=>({data:{...receipt,...changed},error:null})),r=await f.run();assert.equal(r.ok,false,JSON.stringify(changed));assert.deepEqual(f.phases,['publish','inspect']);
 }
});
test('confirmed unchanged enrichment requires no event and preserves receipt evidence',async()=>{
 const f=fixture(()=>({data:{...receipt,alreadyEnriched:true,eventPublished:false,eventId:null},error:null}));
 const r=await f.run();assert.equal(r.ok,true);assert.equal(r.alreadyEnriched,true);assert.equal(r.eventPublished,false);
});
test('known source holds are safe diagnostics; provider prose remains private',async()=>{
 for(const message of ['phone_handoff_source_unverified','phone_handoff_source_changed','learn_capture_paused','PRIVATE SQL body']){
  const f=fixture(()=>({data:null,error:{message}})),r=await f.run();assert.equal(r.ok,false);assert.equal(r.reason,message.startsWith('PRIVATE')?'phone_handoff_unconfirmed':message);assert.ok(!JSON.stringify(r).includes('PRIVATE'));
 }
});
test('missing input identity prevents any database call',async()=>{
 const f=fixture();assert.equal((await f.run({insightId:null})).ok,false);assert.deepEqual(f.phases,[]);
});
test('existing PostgreSQL tenant UUIDs can publish while exact tenant binding remains required',async()=>{
 const tenantId='00000000-0000-0000-0000-000000000001';
 for(const foreign of [false,true]){
  const phases:string[]=[];
  const admin:any={async rpc(name:string,args:any){
   assert.equal(name,'learn_phone_handoff');assert.equal(args.p_tenant,tenantId);phases.push(args.p_phase);
   return {data:{...receipt,tenantId:foreign?id(99):tenantId},error:null};
  }};
  const result=await finalizeInteractionForRecording({admin,...input,tenantId});
  assert.equal(result.ok,!foreign);assert.deepEqual(phases,foreign?['publish','inspect']:['publish']);
 }
});
test('malformed UUID input cannot call the handoff RPC',async()=>{
 for(const value of ['','00000000-0000-0000-0000-00000000000z',' '+id(1),id(1)+',other']){
  const f=fixture();assert.equal((await f.run({tenantId:value})).ok,false);assert.deepEqual(f.phases,[]);
 }
});
