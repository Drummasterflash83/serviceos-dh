import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSlackHistoryPage} from './slack_history.ts';
import {readSlackThreadPage} from './slack_thread_history.ts';
import {slackMessageKind} from './slack_message_kind.ts';
const tenant='11111111-1111-4111-8111-111111111111';
const scope={tenantId:tenant,teamId:'T123',channelIds:['C123'],oldest:'100.000001',latest:'200.000001',consentReference:'synthetic',parentTimestamp:'110.000001'};
const record=(subtype?:string)=>({type:'message',ts:'120.000001',thread_ts:scope.parentTimestamp,text:'Synthetic source',...(subtype?{subtype}:{})});
const readBoth=async(message:any)=>Promise.all([
 readSlackHistoryPage(scope,tenant,'C123',null,async()=>({ok:true,has_more:false,messages:[message]})),
 readSlackThreadPage(scope,tenant,'C123',null,async()=>({ok:true,has_more:false,messages:[message]})),
]);
test('common conversation and channel activity subtypes survive both history routes without dropping original payload',async()=>{
 for(const subtype of [undefined,'bot_message','thread_broadcast','me_message','file_share','file_comment','file_mention',
 'channel_archive','channel_unarchive','channel_join','channel_leave','channel_name','channel_purpose','channel_topic',
 'channel_posting_permissions','channel_convert_to_private','channel_convert_to_public',
 'group_archive','group_unarchive','group_join','group_leave','group_name','group_purpose','group_topic','pinned_item','unpinned_item']){
  const message={...record(subtype),files:[{id:'F123',url_private:'https://files.slack.com/synthetic'}]};
  for(const page of await readBoth(message)) assert.deepEqual(page.records[0].provider_payload,message);
 }
 assert.equal(slackMessageKind(record('file_share')),'conversation');
 assert.equal(slackMessageKind(record('channel_join')),'channel_activity');
});
test('redaction, unknown subtype and event envelopes stop both routes instead of claiming complete coverage',async()=>{
 for(const message of [record('ekm_access_denied'),record('future_subtype'),record('message_deleted'),record('message_changed'),
  {...record(),hidden:true},{...record(),hidden:'false'},{...record(),type:'reaction_added'},
  {...record(),subtype:null},{...record(),subtype:[]},{...record(),type:null}]){
  await assert.rejects(readSlackHistoryPage(scope,tenant,'C123',null,async()=>({ok:true,has_more:false,messages:[message]})),(e:any)=>e.code?.startsWith('slack_history_') && e.retryable===false);
  await assert.rejects(readSlackThreadPage(scope,tenant,'C123',null,async()=>({ok:true,has_more:false,messages:[message]})),(e:any)=>e.code?.startsWith('slack_history_') && e.retryable===false);
 }
});
test('file metadata is retained without fetching any attachment URL',async()=>{
 let requests=0;const message={...record('file_share'),text:'',files:[{id:'F123',url_private:'https://files.slack.com/synthetic'}]};
 const page=await readSlackHistoryPage(scope,tenant,'C123',null,async(method)=>{requests++;assert.equal(method,'conversations.history');return {ok:true,has_more:false,messages:[message]};});
 assert.equal(requests,1);assert.equal(page.records[0].text,'');assert.deepEqual(page.records[0].provider_payload,message);
});
test('a rejected record prevents page publication and cursor advancement',async()=>{
 const {readSlackHistoryBatch}=await import('./slack_history_batch.ts');
 const {historyScopeKey}=await import('./slack_history.ts');
 const channelScope={...scope,parentTimestamp:undefined};const initial={scopeKey:historyScopeKey(channelScope,'C123'),cursor:null,pages:0,complete:false};
 let writes=0;
 await assert.rejects(readSlackHistoryBatch(channelScope,tenant,'C123',initial,2,{authorised:async()=>true,
 request:async()=>({ok:true,has_more:true,messages:[record('file_share'),{...record('future_subtype'),ts:'121.000001'}],response_metadata:{next_cursor:'later'}}),
 persist:async()=>{writes++;}}),(e:any)=>e.code==='slack_history_message_subtype_unsupported');
 assert.equal(writes,0);assert.equal(initial.pages,0);assert.equal(initial.cursor,null);
});
