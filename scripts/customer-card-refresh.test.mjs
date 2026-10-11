import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as calculators from '../supabase/functions/_shared/customer_card.ts';
const source=readFileSync(new URL('../supabase/functions/_shared/worker_handlers/customer_card_sync.ts',import.meta.url),'utf8');
const exports={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Set,Map,require:name=>{if(name.endsWith('/customer_card.ts'))return calculators;if(name.endsWith('/simwood.ts'))return{isUuid:v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)};throw Error('Unexpected dependency');}});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture({fail,missingPerson=false,synthetic=false,locked=false}={}){
 const cards=[1,2].map(n=>({id:id(n),tenant_id:id(100),person_id:id(n+10),company_id:id(30),title:'Retained title',status:'attention',context:{manual_note:'preserve',projection:{generated_at:'2026-01-01T00:00:00Z',business:{health:'critical'}}},locked_fields:locked?['title','status']:[]}));
 const original=structuredClone(cards),writes=[];
 const tables={customer_cards:cards,people:[1,2].filter(n=>!(missingPerson&&n===1)).map(n=>({id:id(n+10),display_name:'Person '+n,primary_email:synthetic?'test@example.invalid':`test${n}@example.org`})),companies:[{id:id(30),name:'Example company'}],graph_nodes:[{id:id(40),source_id:id(11)}],graph_edges:[],interactions:[{id:id(50),interaction_type:'email_message',direction:'inbound',occurred_at:new Date().toISOString(),source_type:'email'}],recommendations:[]};
 const db={from(table){let eqs=[],filter='',patch,cap;const q={select(){return q;},eq(k,v){eqs.push([k,v]);return q;},neq(){return q;},lt(){return q;},order(){return q;},limit(n){cap=n;return q;},in(){return q;},or(v){filter=v;return q;},update(v){patch=v;return q;},maybeSingle(){return exec(true);},then(resolve,reject){return exec(false).then(resolve,reject);}};
 async function exec(single){assert.ok(eqs.some(([k,v])=>k==='tenant_id'&&v===id(100)),'tenant scoped');const card=eqs.find(([k])=>k==='card_id')?.[1];const error=typeof fail==='function'?fail({table,filter,card,patch}):fail===table;if(error)return{data:null,error:{message:'PRIVATE DATABASE CONTENT'}};
 if(patch){const key=eqs.find(([k])=>k==='id')?.[1];writes.push({id:key,patch});Object.assign(cards.find(c=>c.id===key),structuredClone(patch));return{data:null,error:null};}
 let rows=tables[table];if(table==='customer_cards'&&eqs.some(([k])=>k==='id'))rows=rows.filter(r=>r.id===eqs.find(([k])=>k==='id')[1]);if(cap)rows=rows.slice(0,cap);return{data:single?rows[0]??null:rows,error:null};}return q;}};
 return{cards,original,writes,run:payload=>exports.handleCustomerCardSync({tenantId:id(100),supabaseAdmin:db,payload:payload??{}})};
}
test('shared identity and graph read failures preserve every prior card and redact database prose',async()=>{
 for(const table of ['customer_cards','people','companies','graph_nodes','graph_edges']){const f=fixture({fail:table});const r=await f.run();assert.equal(r.success,false,table);assert.equal(r.error.retryable,true);assert.equal(f.writes.length,0);assert.deepEqual(f.cards,f.original);assert.ok(!JSON.stringify(r).includes('PRIVATE'));}
 const f=fixture({fail:'graph_nodes'});assert.equal((await f.run({graph_node_id:id(40)})).success,false);assert.equal(f.writes.length,0);
});
test('one failed interaction or recommendation read keeps that card intact while other cards refresh',async()=>{
 for(const table of ['interactions','recommendations']){const f=fixture({fail:q=>q.table===table&&(q.filter.includes(id(11))||q.card===id(1))});const r=await f.run();assert.equal(r.success,false);assert.equal(r.result.failed,1);assert.equal(r.result.cards_projected,1);assert.deepEqual(f.cards[0],f.original[0]);assert.equal(f.writes[0].id,id(2));assert.ok(!JSON.stringify(r).includes('PRIVATE'));}
});
test('missing linked identity never replaces a saved card with unresolved zeroes',async()=>{const f=fixture({missingPerson:true});const r=await f.run();assert.equal(r.result.failed,1);assert.deepEqual(f.cards[0],f.original[0]);assert.equal(r.result.cards_projected,1);});
test('healthy reads refresh cards, preserve manual context and respect locked title/status',async()=>{const f=fixture({locked:true});const r=await f.run();assert.equal(r.success,true);assert.equal(r.recordsProcessed,2);assert.equal(f.cards[0].context.manual_note,'preserve');assert.equal(f.cards[0].title,'Retained title');assert.equal(f.cards[0].status,'attention');assert.equal(f.cards[0].context.projection.communication.interaction_count,1);});
test('unconfirmed synthetic sweep cursor writes fail without claiming a skip; successful skips are counted',async()=>{
 const bad=fixture({synthetic:true,fail:q=>q.table==='customer_cards'&&!!q.patch});const r=await bad.run();assert.equal(r.success,false);assert.equal(r.result.failed,2);assert.equal(r.result.skipped,0);assert.deepEqual(bad.cards,bad.original);
 const good=fixture({synthetic:true});const done=await good.run();assert.equal(done.success,true);assert.equal(done.result.skipped,2);assert.equal(done.recordsProcessed,0);
});
test('HTTP wrapper marks partial card refresh failed, never complete, and preserves failure counts',async()=>{
 const actual=await fixture({fail:q=>q.table==='interactions'&&q.filter.includes(id(11))}).run();
 for(const result of [actual,{success:true,recordsProcessed:2,result:{cards_projected:2,failed:0}}]){
  let handler;const calls=[];
  const code=readFileSync(new URL('../supabase/functions/customer-card-sync/index.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},Deno:{serve:fn=>handler=fn},Request,Response,require:name=>{
   if(name.endsWith('/simwood.ts'))return{corsHeaders:{},createSupabaseAdmin:()=>({}),failResponse:(code,message,status)=>Response.json({success:false,error:{code,message}},{status}),jsonResponse:d=>Response.json(d)};
   if(name.endsWith('/authz.ts'))return{requireTenantUser:async()=>({ok:true,ctx:{tenantId:id(100),userId:id(101)}}),assertSameTenant:()=>null};
   if(name.endsWith('/customer_card_sync.ts'))return{handleCustomerCardSync:async()=>result};
   if(name.endsWith('/platform_jobs.ts'))return{createPlatformJob:async()=>({id:id(102)}),startPlatformJob:async()=>{},completePlatformJob:async(...args)=>calls.push(['complete',...args]),failPlatformJob:async(...args)=>calls.push(['failed',...args])};
   throw Error('Unexpected wrapper import');
  }});
  const response=await handler(new Request('https://test.invalid',{method:'POST',body:'{}'}));
  assert.equal(response.status,result.success?200:500);assert.equal(calls.length,1);assert.equal(calls[0][0],result.success?'complete':'failed');
  if(!result.success)assert.equal(calls[0][4].failed,1);
 }
});
