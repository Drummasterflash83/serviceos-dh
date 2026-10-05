import {test} from 'node:test';
import assert from 'node:assert/strict';
import {learnCountView} from './learn-count-view.ts';
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',now=Date.parse('2026-10-05T10:00:00Z');
const source=(count:number)=>({read_status:'ok',record_count:count,latest_record_at:count?'2026-10-05T09:50:00Z':null});
const snapshot=()=>({version:'learn-status/1',tenant_id:tenant,observed_at:new Date(now).toISOString(),valid_until:new Date(now+60000).toISOString(),phone:source(86),email:source(1284)});
test('stored-row counts preserve one phone total, with storage time distinct from sync',()=>{
 const v=learnCountView(tenant,{state:'ready',snapshot:snapshot()},now);assert.equal(v.email,1284);assert.equal(v.phone,86);assert.equal(v.latestPhoneStorageAt,'2026-10-05T09:50:00Z');assert.equal(Object.hasOwn(v,'lastSyncAt'),false);assert.equal(Object.hasOwn(v,'emma'),false);
});
test('cross tenant, malformed, fabricated metadata and future/expired observations clear all counts',()=>{
 for(const [s,t,n] of [[snapshot(),other,now],[{...snapshot(),version:'unknown'},tenant,now],[{...snapshot(),phone:{...source(86),record_count:-1}},tenant,now],[{...snapshot(),emma:source(100)},tenant,now],[snapshot(),tenant,now+60000],[snapshot(),tenant,now-1]] as const){const v=learnCountView(t,{state:'ready',snapshot:s},n);assert.equal(v.email,null);assert.equal(v.phone,null);}
});
test('loading, denied, error and unavailable never retain previous evidence',()=>{
 for(const state of ['loading','denied','failed','unavailable'] as const){const v=learnCountView(tenant,{state},now);assert.equal(v.state,state);assert.equal(v.email,null);assert.equal(v.phone,null);assert.equal(v.latestEmailStorageAt,null);}
 assert.equal(learnCountView(tenant,null,NaN).phone,null);
});
test('zero is supported, partial data stays qualified and no inferred connection state',()=>{
 const s=snapshot();s.phone=source(0);s.email=source(0);assert.equal(learnCountView(tenant,{state:'ready',snapshot:s},now).state,'empty');
 const p={...snapshot(),email:{read_status:'unavailable',record_count:null,latest_record_at:null}};const v=learnCountView(tenant,{state:'ready',snapshot:p},now);assert.equal(v.state,'partial');assert.equal(v.phone,86);assert.equal(v.email,null);assert.equal(Object.hasOwn(v,'connected'),false);
});
