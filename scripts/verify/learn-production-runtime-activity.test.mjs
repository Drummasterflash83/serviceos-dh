import test from 'node:test';
import assert from 'node:assert/strict';
import {activityWindow,assessRuntimeActivity,readRuntimeActivity} from './learn-production-runtime-activity.mjs';
const window={start:'2026-10-13T00:53:00.000Z',end:'2026-10-13T01:08:00.000Z'};
const inventory=[{id:'example-id',name:'platform-worker'}];
const invocation={function_id:'example-id',status:'200',count:2,latest:'2026-10-13T01:07:00.000000',max_duration_ms:100};
const base={...window,inventory,invocations:[invocation],lifecycle:[]};
test('empty logs and HTTP success never become drain or durable-capture acceptance',()=>{
 const empty=assessRuntimeActivity({...base,invocations:[]});assert.equal(empty.missingInvocationEvidence,true);assert.equal(empty.inFlightWorkVerifiedStopped,false);
 const success=assessRuntimeActivity(base);assert.equal(success.httpRequestCount,2);assert.equal(success.durableCaptureVerified,false);
});
test('unknown functions, failed calls and lifecycle counts stay explicit without inventing active counts',()=>{
 const r=assessRuntimeActivity({...base,invocations:[{...invocation,function_id:'unmapped',status:'502'}],lifecycle:[{function_id:'example-id',event_type:'Shutdown',count:5,latest:invocation.latest}]});
 assert.equal(r.httpErrorCount,2);assert.equal(r.unknownFunctions,true);assert.equal(r.lifecycle[0].count,5);assert.equal('activeExecutions' in r,false);
});
test('unbounded windows, duplicate aggregates, truncated and malformed data fail closed',()=>{
 assert.throws(()=>activityWindow(window.start,'2026-10-13T02:08:00.000Z'));assert.throws(()=>activityWindow(window.end,window.start));
 assert.throws(()=>assessRuntimeActivity({...base,invocations:[invocation,invocation]}));
 assert.throws(()=>assessRuntimeActivity({...base,invocations:Array(1001).fill(invocation)}));
 assert.throws(()=>assessRuntimeActivity({...base,invocations:[{...invocation,count:'2'}]}));
});
test('bounded transport uses three GETs, selects no raw messages and rejects provider query errors',async()=>{
 const calls=[];const fake=async(u,o)=>{calls.push({u,o});return{status:200,json:async()=>calls.length===1?inventory:{result:calls.length===2?[invocation]:[]}};};
 const r=await readRuntimeActivity({...window,token:'synthetic-local-test-token',fetcher:fake});assert.equal(r.httpRequestCount,2);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.o.method==='GET'&&c.o.redirect==='error'));
 assert.ok(calls.slice(1).every(c=>!new URL(c.u).searchParams.get('sql').includes('event_message')));
 let n=0;await assert.rejects(readRuntimeActivity({...window,token:'synthetic-local-test-token',fetcher:async()=>({status:200,json:async()=>++n===1?inventory:{result:[],error:'invalid query'}})}));assert.equal(n,2);
});
