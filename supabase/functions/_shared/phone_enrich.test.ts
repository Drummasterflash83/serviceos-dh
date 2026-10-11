import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeInteractionForRecording} from './phone_enrich.ts';
const version='a'.repeat(32), tenant='tenant',callId='call',recordingId='recording';
function fixture({fault='',existing=null,insightCall='call',versionResult=version,eventFailure=false}:any={}) {
 const writes:any[]=[];
 const admin:any={
  async rpc(name:string,args:any){assert.equal(name,'phone_projection_version');assert.equal(args.p_tenant_id,tenant);return {data:versionResult,error:fault==='version'?{message:'PRIVATE'}:null};},
  from(table:string){let op='read',patch:any;const filters:any[]=[];
   function result(){
    assert.ok(filters.some(([k,v])=>k==='tenant_id'&&v===tenant)||patch?.tenant_id===tenant);
    if(fault===`${table}:${op}`)return {data:null,error:{message:'PRIVATE'}};
    if(op==='read'){
     if(table==='phone_recordings')return{data:{id:recordingId,provider:'simwood',provider_call_id:'provider-call'},error:null};
     if(table==='phone_calls'){assert.ok(filters.some(([k,v])=>k==='provider'&&v==='simwood'));return {data:{id:callId,provider_call_id:'provider-call',direction:'IN',started_at:'2026-10-11T10:00:00Z',created_at:'2026-10-11T10:00:00Z'},error:null};}
     if(table==='phone_ai_insights')return{data:{id:'insight',call_id:insightCall,summary:'Synthetic summary',sentiment:'neutral'},error:null};
     if(table==='interactions')return {data:existing,error:null};
     throw Error('Unexpected read');
    }
    if(table==='platform_events'&&eventFailure)return{data:null,error:{code:'XX000',message:'PRIVATE'}};
    if(table==='phone_ai_insights')return{data:{id:'insight',call_id:patch.call_id},error:null};
    return{data:{id:table==='interactions'?'interaction':'event'},error:null};
   }
   const q:any={select(){return q;},eq(k:string,v:any){filters.push([k,v]);return q;},is(k:string,v:any){filters.push([k,v]);return q;},order(){return q;},limit(){return q;},
    update(v:any){op='update';patch=v;writes.push({table,op,patch:v});return q;},upsert(v:any){op='upsert';patch=v;writes.push({table,op,patch:v});return q;},insert(v:any){op='insert';patch=v;writes.push({table,op,patch:v});return q;},async maybeSingle(){return result();},async single(){return result();},then(resolve:any,reject:any){return Promise.resolve().then(result).then(resolve,reject);}};
   return q;
  },
 };
 return{writes,run:()=>finalizeInteractionForRecording({admin,tenantId:tenant,recordingId})};
}
test('canonical handoff stops on failed source/identity reads or unavailable projection',async()=>{
 for(const fault of ['phone_recordings:read','phone_calls:read','phone_ai_insights:read','interactions:read','version']){
  const f=fixture({fault}),r=await f.run();assert.equal(r.ok,false,fault);assert.ok(!f.writes.some(w=>w.table==='interactions'||w.table==='platform_events'));assert.ok(!JSON.stringify(r).includes('PRIVATE'));
 }
 const f=fixture({versionResult:null});assert.equal((await f.run()).reason,'projection_unavailable');
});
test('failed insight link or conflicting call cannot publish an interaction',async()=>{
 for(const opts of [{insightCall:null,fault:'phone_ai_insights:update'},{insightCall:'other-call'}]){
  const f=fixture(opts);assert.equal((await f.run()).ok,false);assert.ok(!f.writes.some(w=>w.table==='interactions'));
 }
});
test('changed projected content returns enriched interaction to downstream processing without clearing identity',async()=>{
 const f=fixture({existing:{id:'interaction',processing_status:'enriched',source_version:'b'.repeat(32)}}),r=await f.run();
 assert.equal(r.ok,true);assert.equal(r.alreadyEnriched,false);assert.equal(r.eventPublished,true);
 const row=f.writes.find(w=>w.table==='interactions').patch;assert.equal(row.processing_status,'ready');assert.equal(row.source_version,version);
 assert.ok(!('related_person_id' in row));assert.ok(!('related_company_id' in row));
});
test('unchanged enriched version retains enrichment and does not publish a duplicate event',async()=>{
 const f=fixture({existing:{id:'interaction',processing_status:'enriched',source_version:version}}),r=await f.run();
 assert.equal(r.ok,true);assert.equal(r.alreadyEnriched,true);assert.equal(r.eventPublished,false);assert.ok(!f.writes.some(w=>w.table==='platform_events'));
});
test('event publication failure remains explicitly unconfirmed for pipeline settlement',async()=>{
 const f=fixture({eventFailure:true}),r=await f.run();assert.equal(r.ok,true);assert.equal(r.eventPublished,false);assert.equal(r.alreadyEnriched,false);assert.equal(r.interactionId,'interaction');
});
