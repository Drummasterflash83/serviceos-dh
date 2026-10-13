import test from 'node:test';import assert from 'node:assert/strict';
import {readStoredSourceReplay,sourceReplayPersistence} from './slack_source_replay.ts';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope={approved:true,campaignId:id,connectionId:id,teamId:'TTEAM',channelId:'CCHANNEL',oldest:'1791815290.565708',latest:'1791815290.565710',consentReference:`learn-slack-source-replay:${id}`,expiresAt:'2026-10-20Z',maxPages:1};
const fixture=()=>({replayId:id,accountId:account,sourceId:id,sourceVersion:'a'.repeat(64),timestamp:'1791815290.565709',scope:{...scope}});
const clock=()=>Date.parse('2026-10-13Z');
const context=(data:any)=>({tenantId:id,jobId:id,claim:{claimedBy:'worker',attemptCount:1},supabaseAdmin:{rpc:async()=>({data,error:null})}} as any);
test('durable RPC supplies exact microsecond scope without account cursor',async()=>{
 const binding=await readStoredSourceReplay(context(fixture()),account,id,clock);assert.equal(binding?.sourceReplayId,id);assert.equal(binding?.checkpoint.pages,0);assert.equal(binding?.checkpoint.cursor,null);assert.equal(binding?.maxPages,1);
});
test('foreign identity, widened time, expiry, and invented parent fail closed',async()=>{
 const changes=[{accountId:id},{sourceVersion:'invalid'},{scope:{...scope,latest:'1791815291.565710'}},{scope:{...scope,expiresAt:'2026-10-01Z'}},{scope:{...scope,parentTimestamp:'1791815290.565710'}},{scope:{...scope,consentReference:'forged'}}];
 for(const change of changes)assert.equal(await readStoredSourceReplay(context({...fixture(),...change}),account,id,clock),null);
});
test('replay requires complete one-page result and exact commit acknowledgement',async()=>{
 const calls:any[]=[];const ctx=context(true);ctx.supabaseAdmin.rpc=async(name:any,args:any)=>{calls.push({name,args});return {data:true,error:null};};
 const persist=sourceReplayPersistence(ctx.supabaseAdmin,ctx,()=>({is_private:false}));
 await persist({records:[]},null,{pages:1,complete:true,cursor:null});assert.equal(calls[0].name,'learn_slack_commit_source_replay');assert.equal(calls[0].args.p_records.length,0);
 for(const next of [{pages:1,complete:false,cursor:'more'},{pages:2,complete:true,cursor:null}])await assert.rejects(()=>persist({records:[]},null,next));
 await assert.rejects(()=>persist({records:[{},{}]},null,{pages:1,complete:true,cursor:null}));
 assert.equal(calls.length,1);
 ctx.supabaseAdmin.rpc=async()=>({data:null,error:{code:'PT409'}});await assert.rejects(()=>sourceReplayPersistence(ctx.supabaseAdmin,ctx,()=>({}))({records:[]},null,{pages:1,complete:true,cursor:null}));
});

test('history handler revalidates one exact source through dedicated commit without continuation',async()=>{
 const {createSlackHistoryHandler}=await import('../worker_handlers/slack_history.ts');
 const {historyScopeKey}=await import('./slack_history.ts');
 const calls:any[]=[];const ctx:any={...context(true),jobType:'slack.history_sync',payload:{source_replay_id:id}};
 ctx.supabaseAdmin.rpc=async(name:any,args:any)=>{calls.push({name,args});return {data:true,error:null};};
 const historyScope={tenantId:id,teamId:'TTEAM',channelIds:['CCHANNEL'],oldest:scope.oldest,latest:scope.latest,consentReference:scope.consentReference};
 const handler=createSlackHistoryHandler(async()=>({tenantId:id,jobId:id,accountId:account,sourceReplayId:id,channelId:'CCHANNEL',scope:historyScope,checkpoint:{scopeKey:historyScopeKey(historyScope,'CCHANNEL'),pages:0,cursor:null,complete:false},maxPages:1,authorised:async()=>true,captureVisibility:()=>({is_private:false}),request:async(method,args)=>{assert.equal(method,'conversations.history');assert.equal(args.oldest,scope.oldest);assert.equal(args.latest,scope.latest);return {ok:true,messages:[{ts:'1791815290.565709',text:'Retained source'}],has_more:false};}}));
 const result=await handler(ctx);assert.equal(result.success,true);assert.equal(result.continuation,undefined);assert.equal(result.result?.coverage,'one_retained_source_revalidation');assert.equal(calls.length,1);assert.equal(calls[0].name,'learn_slack_commit_source_replay');
});

test('a retained reply keeps its observed parent and reads only the exact reply window',async()=>{
 const r=fixture();(r.scope as any).parentTimestamp='1791815200.000001';
 const stored=await readStoredSourceReplay(context(r),account,id,clock);assert.equal(stored?.scope.parentTimestamp,'1791815200.000001');
 const {readSlackHistoryBatch}=await import('./slack_history_batch.ts');let methodSeen='';let committed=0;
 await readSlackHistoryBatch(stored!.scope,id,'CCHANNEL',stored!.checkpoint,1,{authorised:async()=>true,request:async(method,args)=>{methodSeen=method;assert.equal(args.ts,'1791815200.000001');return {ok:true,messages:[{ts:'1791815290.565709',thread_ts:'1791815200.000001',text:'Retained reply'}],has_more:false};},persist:async()=>{committed++;}},1);
 assert.equal(methodSeen,'conversations.replies');assert.equal(committed,1);
});
