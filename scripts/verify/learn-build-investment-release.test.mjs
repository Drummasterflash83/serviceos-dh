import test from 'node:test';import assert from 'node:assert/strict';
import {releaseInvestment,investmentPackage,INVESTMENT_RELEASE_SHA} from './learn-build-investment-release.mjs';
import {INVESTMENT_PRESERVED} from './learn-build-investment-catalog.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
const token='sbp_'+'0'.repeat(40),manifest=investmentPackage().manifest;
const prior=manifest.priorFingerprint,expected='1'.repeat(32);
const preserved=INVESTMENT_PRESERVED.map(name=>({name,count:0,fingerprint:'0'.repeat(32)}));
function fixture({missingReceipt=false,changedSources=false}={}){
 let sent=0,journal=false;
 return {get sent(){return sent;},persistJournal:async()=>{journal=true;},catalog:async()=>({fingerprint:prior}),query:async(_token,sql,options)=>{
  if(options?.readOnly===false){assert.ok(journal);sent++;assert.match(sql,/rollback;\n$/);assert.ok(!sql.endsWith('commit;\n'));return missingReceipt?[]:[{marker:'learn-investment-progress/1',fingerprint:expected,catalog:{functions:Array(2).fill({}),delivery:{health:{runtime:{ledger:Array(38).fill({})}}}},preserved}];}
  return changedSources&&sent?preserved.map((r,i)=>({...r,count:i===0?1:0})):preserved;
 }};
}
const args={mode:'rehearse',allowProjectRef:TEST_PROJECT,token};
test('package selects only the original private gate and dated estimate',()=>{
 const p=investmentPackage();assert.equal(p.manifest.sources.length,2);
 assert.match(p.sql,/lower\(email\)='chris@openfolk.ai'/);assert.match(p.sql,/platform.controlplane.admin/);
 assert.match(p.sql,/ended_at is null/);assert.match(p.sql,/'asOf', '2026-09-29'/);
 assert.doesNotMatch(p.sql,/create table public.receptionist|create or replace function public.care_require_admin|insert into auth.users|insert into public.platform_authority_grants/);
 assert.match(p.sql,/Retained sources changed/);
});
test('rehearsal sends once after journal, verifies rollback and retains expected fingerprint',async()=>{const f=fixture();const r=await releaseInvestment({...args,...f});assert.equal(f.sent,1);assert.equal(r.state,'rehearsed_rolled_back');assert.equal(r.expectedFingerprint,expected);assert.equal(r.preservedDataSets,69);});
test('wrong target, missing rehearsal, schema drift and failed journaling prevent SQL submission',async()=>{
 for(const override of [{allowProjectRef:'production'},{mode:'apply'},{catalog:async()=>({fingerprint:'0'.repeat(32)})},{persistJournal:async()=>{throw Error('disk unavailable');}}]){const f=fixture();await assert.rejects(releaseInvestment({...args,...f,...override}));assert.equal(f.sent,0);}
});
test('missing response or changed sources never report a verified rehearsal or retry',async()=>{for(const config of [{missingReceipt:true},{changedSources:true}]){const f=fixture(config);const r=await releaseInvestment({...args,...f});assert.equal(f.sent,1);assert.equal(r.state,'requires_inspection');}});
test('apply requires the exact rehearsed fingerprint and confirms committed state',async()=>{
 let sent=0,journal=false;
 const r=await releaseInvestment({mode:'apply',allowProjectRef:TEST_PROJECT,token,rehearsal:{state:'rehearsed_rolled_back',sourceSha256:INVESTMENT_RELEASE_SHA,projectRef:TEST_PROJECT,expectedFingerprint:expected},persistJournal:async()=>{journal=true;},catalog:async()=>({fingerprint:sent?expected:prior}),query:async(_token,sql,options)=>{if(options?.readOnly===false){assert.ok(journal);assert.match(sql,/commit;\n$/);sent++;return [];}return preserved;}});
 assert.equal(sent,1);assert.equal(r.state,'installed_needs_signed_in_acceptance');
});
