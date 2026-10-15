import {test} from 'node:test';import assert from 'node:assert/strict';
import {readSlackThreadPage,observedThreadParents} from './slack_thread_history.ts';
const tenant='11111111-1111-4111-8111-111111111111',scope={tenantId:tenant,teamId:'T123',channelIds:['C123'],oldest:'100.000001',latest:'200.000001',consentReference:'synthetic',parentTimestamp:'110.000001'};
const parent={ts:'110.000001',thread_ts:'110.000001',reply_count:2,text:'Root'},reply={ts:'120.000001',thread_ts:'110.000001',text:'Reply',user:'U123',files:[{id:'F123'}]};
test('thread reader binds root/channel/window and preserves the raw reply payload',async()=>{
 const calls:any[]=[];const r=await readSlackThreadPage(scope,tenant,'C123',null,async(...args)=>{calls.push(args);return {ok:true,has_more:false,messages:[parent,reply]};});
 assert.deepEqual(calls,[['conversations.replies',{channel:'C123',ts:parent.ts,oldest:scope.oldest,latest:scope.latest,limit:15}]]);
 assert.deepEqual(r.records[1].provider_payload,reply);assert.equal(r.records[1].source_external_id,'T123:C123:120.000001');assert.equal(r.threadComplete,true);assert.equal(r.coverage,'observed_thread_window');
});
test('foreign scope and thread, missing parent association, duplicate and out-of-window replies fail',async()=>{
 let calls=0;await assert.rejects(readSlackThreadPage(scope,'22222222-2222-4222-8222-222222222222','C123',null,async()=>{calls++;}));assert.equal(calls,0);
 for(const messages of [[{...reply,thread_ts:'109.000001'}],[{...reply,thread_ts:undefined}],[reply,reply],[{...reply,ts:'200.000002'}],[{...reply,ts:'109.000001'}],[{...parent,thread_ts:'109.000001'}]]){
  await assert.rejects(readSlackThreadPage(scope,tenant,'C123',null,async()=>({ok:true,has_more:false,messages})),/thread_page_integrity/);
 }
});
test('older observed parents may scope in-window replies but their out-of-window content is refused',async()=>{
 const old={...scope,parentTimestamp:'90.000001'};
 const r=await readSlackThreadPage(old,tenant,'C123',null,async()=>({ok:true,has_more:false,messages:[{ts:old.parentTimestamp,text:'Outside window'},{...reply,thread_ts:old.parentTimestamp}]}));
 assert.equal(r.records.length,1);assert.equal(r.records[0].provider_timestamp,reply.ts);
 const empty=await readSlackThreadPage(old,tenant,'C123',null,async()=>({ok:true,has_more:false,messages:[{ts:old.parentTimestamp,text:'Outside window'}]}));
 assert.equal(empty.records.length,0);assert.equal(empty.threadComplete,true);
 await assert.rejects(readSlackThreadPage(old,tenant,'C123',null,async()=>({ok:true,has_more:false,messages:[{ts:old.parentTimestamp,thread_ts:'80.000001',text:'Wrong parent'}]})),/thread_page_integrity/);
 await assert.rejects(readSlackThreadPage(old,tenant,'C123',null,async()=>({ok:true,has_more:false,messages:[{ts:'95.000001',thread_ts:old.parentTimestamp,text:'Outside window'}]})),/thread_page_integrity/);
});
test('pagination does not confuse page budget with completeness; malformed/cyclic cursors fail',async()=>{
 const r=await readSlackThreadPage(scope,tenant,'C123','previous',async(_,args)=>{assert.equal(args.cursor,'previous');return {ok:true,has_more:true,messages:[reply],response_metadata:{next_cursor:'next'}};});assert.equal(r.threadComplete,false);assert.equal(r.nextCursor,'next');
 for(const page of [{has_more:true},{has_more:true,response_metadata:{next_cursor:'previous'}},{has_more:false,response_metadata:{next_cursor:'unexpected'}}])await assert.rejects(readSlackThreadPage(scope,tenant,'C123','previous',async()=>({ok:true,messages:[],...page})),/thread_cursor_unavailable/);
});
test('roots are discovered from provider reply counts or reply/broadcast references only',()=>{
 const row=(m:any)=>({provider_timestamp:m.ts,thread_timestamp:m.thread_ts??null,provider_payload:m});
 assert.deepEqual(observedThreadParents([row(parent),row(reply),row({...reply,thread_ts:'90.000001',subtype:'thread_broadcast'}),row({ts:'150.000001',text:'Unthreaded'})]),['90.000001',parent.ts]);
 for(const m of [{...parent,reply_count:-1},{...parent,reply_count:1.5},{...reply,thread_ts:'130.000001'}])assert.throws(()=>observedThreadParents([row(m)]),/thread_discovery_invalid/);
});
