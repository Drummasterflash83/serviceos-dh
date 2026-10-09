import {test} from 'node:test';import assert from 'node:assert/strict';import {readSlackHistoryPage} from './slack_history.ts';
const T='11111111-1111-4111-8111-111111111111',scope={tenantId:T,teamId:'T123',channelIds:['C123'],oldest:'100.000001',latest:'200.000001',consentReference:'synthetic-consent'};
test('original provider fields survive ingestion without sharing mutable response objects',async()=>{
 const message={ts:'123.1',text:'Original',user:'U123',thread_ts:'120.1',edited:{ts:'150.1'},blocks:[{type:'section',text:{type:'plain_text',text:'Original'}}]};
 const page=await readSlackHistoryPage(scope,T,'C123',null,async()=>({ok:true,has_more:false,messages:[message]}));
 assert.deepEqual(page.records[0].provider_payload,message);message.blocks[0].text.text='Changed after read';
 assert.equal(page.records[0].provider_payload.blocks[0].text.text,'Original');
});
test('malformed thread timestamps and oversized payloads stop before persistence',async()=>{
 for(const message of [{ts:'123.1',text:'test',thread_ts:'bad'},{ts:'123.1',text:'x'.repeat(40001)},{ts:'123.1',text:'test',blocks:[{text:'x'.repeat(262144)}]}]){
  await assert.rejects(readSlackHistoryPage(scope,T,'C123',null,async()=>({ok:true,has_more:false,messages:[message]})));
 }
});
test('allow-listed channel only, stable tenant/source identity, cursor and thread limits explicit',async()=>{const calls:any[]=[];const result=await readSlackHistoryPage(scope,T,'C123',null,async(m,b)=>{calls.push([m,b]);return {ok:true,has_more:true,messages:[{ts:'123.000001',text:'Synthetic message'}],response_metadata:{next_cursor:'synthetic-cursor'}};});assert.equal(result.records[0].source_external_id,'T123:C123:123.000001');assert.equal(result.historyComplete,false);assert.equal(result.threadCoverage,'unverified');assert.equal(calls[0][1].limit,15);});
test('foreign tenant, private channel and missing consent do not request history',async()=>{let calls=0;for(const [s,t,c] of [[scope,'22222222-2222-4222-8222-222222222222','C123'],[scope,T,'G123'],[{...scope,consentReference:''},T,'C123']] as const)await assert.rejects(readSlackHistoryPage(s,t,c,null,async()=>{calls++;}));assert.equal(calls,0);});
test('provider denial, duplicate messages, unsupported deletion and incomplete cursor fail closed',async()=>{for(const page of [{ok:false,error:'missing_scope'},{ok:true,has_more:false,messages:[{ts:'123.1',text:'a'},{ts:'123.1',text:'b'}]},{ok:true,has_more:false,messages:[{ts:'123.1',text:'a',subtype:'message_deleted'}]},{ok:true,has_more:true,messages:[]},{ok:true,has_more:false,messages:[],response_metadata:{next_cursor:'contradictory'}}])await assert.rejects(readSlackHistoryPage(scope,T,'C123',null,async()=>page));});
