import test from 'node:test';import assert from 'node:assert/strict';
import {releaseDelivery,deliveryPackage,DELIVERY_RELEASE_SHA} from './learn-delivery-release.mjs';
import {DELIVERY_PRESERVED} from './learn-delivery-catalog.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
const token='sbp_'+'0'.repeat(40),manifest=deliveryPackage().manifest;
const prior=manifest.priorFingerprint,expected='1'.repeat(32);
const preserved=DELIVERY_PRESERVED.map(name=>({name,count:0,fingerprint:'0'.repeat(32)}));
function fixture({missingReceipt=false,changedSources=false}={}){
 let sent=0,journal=false;
 return {get sent(){return sent;},persistJournal:async()=>{journal=true;},catalog:async()=>({fingerprint:prior}),query:async(_token,sql,options)=>{
  if(options?.readOnly===false){assert.ok(journal);sent++;assert.match(sql,/rollback;\n$/);assert.ok(!sql.endsWith('commit;\n'));return missingReceipt?[]:[{marker:'learn-delivery-progress/1',fingerprint:expected,catalog:{delivery:{tables:Array(3).fill({}),functions:Array(2).fill({})},health:{runtime:{ledger:Array(37).fill({})}}},preserved}];}
  return changedSources&&sent?preserved.map((r,i)=>({...r,count:i===0?1:0})):preserved;
 }};
}
const args={mode:'rehearse',allowProjectRef:TEST_PROJECT,token};
test('package pins all migrations and selects delivery and audit without billing or storage',()=>{const p=deliveryPackage();assert.equal(p.manifest.sources.length,4);assert.match(p.sql,/before truncate on public.controlplane_change_log/);assert.match(p.sql,/Editing is unavailable in client preview/);assert.doesNotMatch(p.sql,/create table public.client_invoices|insert into storage.buckets/);assert.match(p.sql,/Retained sources changed/);});
test('rehearsal sends once after journal, verifies rollback and retains expected fingerprint',async()=>{const f=fixture();const r=await releaseDelivery({...args,...f});assert.equal(f.sent,1);assert.equal(r.state,'rehearsed_rolled_back');assert.equal(r.expectedFingerprint,expected);assert.equal(r.preservedDataSets,67);});
test('wrong target, missing rehearsal, schema drift and failed journaling prevent SQL submission',async()=>{
 for(const override of [{allowProjectRef:'production'},{mode:'apply'},{catalog:async()=>({fingerprint:'0'.repeat(32)})},{persistJournal:async()=>{throw Error('disk unavailable');}}]){const f=fixture();await assert.rejects(releaseDelivery({...args,...f,...override}));assert.equal(f.sent,0);}
});
test('missing response or changed sources never report a verified rehearsal or retry',async()=>{for(const config of [{missingReceipt:true},{changedSources:true}]){const f=fixture(config);const r=await releaseDelivery({...args,...f});assert.equal(f.sent,1);assert.equal(r.state,'requires_inspection');}});
test('apply requires the exact rehearsed fingerprint and confirms committed state',async()=>{
 let sent=0,journal=false;
 const r=await releaseDelivery({mode:'apply',allowProjectRef:TEST_PROJECT,token,rehearsal:{state:'rehearsed_rolled_back',sourceSha256:DELIVERY_RELEASE_SHA,projectRef:TEST_PROJECT,expectedFingerprint:expected},persistJournal:async()=>{journal=true;},catalog:async()=>({fingerprint:sent?expected:prior}),query:async(_token,sql,options)=>{if(options?.readOnly===false){assert.ok(journal);assert.match(sql,/commit;\n$/);sent++;return [];}return preserved;}});
 assert.equal(sent,1);assert.equal(r.state,'installed_needs_signed_in_acceptance');
});
