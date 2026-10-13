import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleRecurringSlack,scheduleSlackCampaigns} from './slack_recurring.ts';
import {slackWorkerEndpoint} from './slack_worker_http.ts';

test('scheduler makes one bounded call and strips unexpected server fields',async()=>{
  const calls: unknown[]=[];
  const result=await scheduleRecurringSlack({rpc:async(name,args)=>{
    calls.push([name,args]);return {data:{checked:4,queued:2,held:1,secret:'never-output'},error:null};
  }});
  assert.deepEqual(calls,[['learn_slack_schedule_recurring',{p_batch:10}]]);
  assert.deepEqual(result,{checked:4,queued:2,held:1});
});
test('uncertain or malformed scheduling reply is not retried or reported successful',async()=>{
  for(const data of [null,{},[],{checked:11,queued:1,held:1},{checked:1,queued:1,held:1},{checked:2,queued:-1,held:0}]) {
    let calls=0;await assert.rejects(scheduleRecurringSlack({rpc:async()=>{calls++;return {data,error:null};}}),/unconfirmed/);
    assert.equal(calls,1);
  }
  await assert.rejects(scheduleRecurringSlack({rpc:async()=>({data:{checked:0,queued:0,held:0},error:{message:'PRIVATE'}})}),e=>e instanceof Error&&!e.message.includes('PRIVATE'));
});
test('HTTP scheduling rejects user-only credentials and caller-selected work',async()=>{
  const key='synthetic-trigger-value-for-tests';let calls=0;
  const handler=slackWorkerEndpoint(key,async()=>{calls++;return {checked:0,queued:0,held:0};});
  assert.equal((await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer user-only'}}))).status,403);
  assert.equal((await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'x-serviceos-worker-key':key},body:'{"tenant":"other"}'}))).status,400);
  assert.equal(calls,0);
  const r=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'x-serviceos-worker-key':key}}));
  assert.equal(r.status,200);assert.equal(calls,1);
});

test('campaign scheduling reports bounded work and does not retry uncertain acknowledgements',async()=>{
 const calls:unknown[]=[];
 assert.deepEqual(await scheduleSlackCampaigns({rpc:async(n,a)=>{calls.push([n,a]);return {data:{checked:3,queued:1,held:1,raw:'private'},error:null};}}),{checked:3,queued:1,held:1});
 assert.deepEqual(calls,[['learn_slack_schedule_campaigns',{p_batch:10}]]);
 for(const data of [null,{},[],{checked:1,queued:2,held:0},{checked:2,queued:0,held:3},{checked:11,queued:0,held:0}]){
  let tries=0;await assert.rejects(scheduleSlackCampaigns({rpc:async()=>{tries++;return {data,error:null};}}),/slack_campaign_schedule_unconfirmed/);assert.equal(tries,1);
 }
});
