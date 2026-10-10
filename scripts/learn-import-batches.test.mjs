import test from 'node:test';import assert from 'node:assert/strict';
import {harness,importId,profileId,tenant} from './learn-import-handler-harness.mjs';
const csv=n=>'external_id,record_kind,display_name\n'+Array.from({length:n},(_,i)=>`row-${i},person,SYNTHETIC Customer ${i}`).join('\n');
const preview=text=>({action:'preview',entity_type:'customers',source_system:'commusoft',profile_id:profileId,csv_text:text});
const apply=text=>({action:'apply',import_id:importId,csv_text:text});
test('5000-row preview uses 50 bounded calls and preserves sealed review',async()=>{
 const text=csv(5000),h=harness({csv:text}),r=await h.request(preview(text),{batched:true});assert.equal(r.status,200);assert.equal(r.body.preview.will_create,5000);assert.equal(r.body.preview.sample.length,8);
 const calls=h.calls.filter(c=>c.rpc==='learn_import_match_batch');assert.equal(calls.length,50);assert.ok(calls.every(c=>c.args.p_rows.length===100&&c.args.p_tenant===tenant));assert.ok(!h.calls.some(c=>c.rpc==='import_match_customer'));assert.ok(h.writes.every(w=>['data_imports','audit_logs'].includes(w.table)));
});
test('apply batches valid and invalid rows while retaining per-row error classification',async()=>{
 const text=csv(205)+'\ninvalid,,',h=harness({csv:text,import:{row_count:206},batchReply:(rows,n)=>n===2?rows.map((r,i)=>i===0?{...r,result:{error_code:'23505'}}:r):rows});
 const r=await h.request(apply(text),{batched:true});assert.equal(r.status,200);const calls=h.calls.filter(c=>c.rpc==='learn_import_apply_batch');assert.deepEqual(calls.map(c=>c.args.p_rows.length),[100,100,6]);assert.equal(calls[2].args.p_rows[5].invalid_fields[0],'record_kind');
 const failed=h.calls.find(c=>c.rpc==='import_row_outcome');assert.equal(failed.args.p_row_number,102);assert.match(failed.args.p_reason,/deterministic.*23505/);assert.ok(!h.calls.some(c=>c.rpc==='import_customer_row'));
});
test('lost or malformed batch replies stop without re-sending or finalising',async()=>{
 for(const options of [{batchErrorAt:2},{batchErrorAt:2,rpcCode:'42501'},{batchReply:(rows,n)=>n===2?rows.slice(1):rows},{batchReply:rows=>rows.map(r=>({...r,row_number:2}))},{batchReply:rows=>rows.map(r=>({...r,result:{action:'surprise'}}))}]){
  const text=csv(250),h=harness({...options,csv:text,import:{row_count:250}}),r=await h.request(apply(text),{batched:true});assert.ok([403,503].includes(r.status));assert.ok(h.calls.filter(c=>c.rpc==='learn_import_apply_batch').length<=2);assert.ok(!h.calls.some(c=>c.rpc==='import_run_finalize'));assert.doesNotMatch(JSON.stringify(r),/PRIVATE DATABASE/);
 }
 const h=harness({batchErrorAt:2});assert.equal((await h.request(preview(csv(250)),{batched:true})).status,503);assert.deepEqual(h.writes,[]);
});
test('legacy handler path stays on original single-row functions',async()=>{
 const h=harness();assert.equal((await h.request()).status,200);assert.ok(h.calls.some(c=>c.rpc==='import_match_customer'));assert.ok(!h.calls.some(c=>c.rpc?.startsWith('learn_import_')));
});
