import test from 'node:test';import assert from 'node:assert/strict';
import {harness,importId,tenant} from './learn-import-handler-harness.mjs';
const outcomes=Array.from({length:5000},(_,i)=>({row_number:i+2,outcome:i%2?'created':'invalid',reason:null,fields:[],attempt:1,created_at:'2026-10-10T00:00:00Z'}));
const page=(after_row=1,page_size=100,extra={})=>({action:'row_results',import_id:importId,after_row,page_size,...extra});
test('all 5000 outcomes are reachable exactly once through bounded cursors',async()=>{
 const h=harness({outcomes}),seen=[];let cursor=1,n=0;
 do{const r=await h.request(page(cursor),{paginatedOutcomes:true});assert.equal(r.status,200);assert.equal(r.body.tenant_id,tenant);assert.equal(r.body.import_id,importId);assert.equal(r.body.after_row,cursor);assert.ok(r.body.rows.length<=100);seen.push(...r.body.rows.map(x=>x.row_number));cursor=r.body.next_after_row;n++;assert.ok(n<=50);}while(cursor!==null);
 assert.equal(n,50);assert.deepEqual(seen,Array.from({length:5000},(_,i)=>i+2));assert.deepEqual(h.writes,[]);
});
test('sparse filtered pages use CSV row numbers; exact final pages have no phantom continuation',async()=>{
 const h=harness({outcomes:outcomes.slice(0,400)}),first=await h.request(page(1,200,{outcomes:['invalid']}),{paginatedOutcomes:true});assert.equal(first.body.rows.length,200);assert.equal(first.body.rows.at(-1).row_number,400);assert.equal(first.body.truncated,false);assert.equal(first.body.next_after_row,null);
 const empty=await h.request(page(5001),{paginatedOutcomes:true});assert.deepEqual(empty.body.rows,[]);assert.equal(empty.body.next_after_row,null);
});
test('invalid cursors, changed scope, read failures and legacy pagination are refused',async()=>{
 for(const [cursor,size]of [[null,100],['1',100],[0,100],[5002,100],[1.5,100],[1,null],[1,201],[1,0],[1,'100']]){const h=harness({outcomes});assert.equal((await h.request(page(cursor,size),{paginatedOutcomes:true})).status,400);assert.deepEqual(h.writes,[]);}
 for(const o of [{role:'viewer'},{role:'ops'},{service:true}]){const h=harness(o);assert.equal((await h.request(page(),{paginatedOutcomes:true})).status,403);}
 const foreign=harness();assert.equal((await foreign.request(page(1,100,{tenant_id:'foreign'}),{paginatedOutcomes:true})).status,403);
 const missing=harness({failTable:'import_row_results'});assert.equal((await missing.request(page(),{paginatedOutcomes:true})).status,500);
 const legacy=harness({outcomes});assert.equal((await legacy.request(page())).status,400);const r=await legacy.request({action:'row_results',import_id:importId});assert.equal(r.body.rows.length,1000);assert.equal(r.body.truncated,true);
});
