import test from "node:test";import assert from "node:assert/strict";
import {readCardCommunications} from "./learn-card-communications.ts";
const tenant="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",id="33333333-3333-4333-8333-333333333333",company="44444444-4444-4444-8444-444444444444";
const row={id,tenant_id:tenant,related_company_id:company,subject:"Retained email",source_table:"email_messages",source_id:id};
const payload=(rows:any[]= [row])=>({version:"learn-card-communications/1",tenant_id:tenant,rows});
test("reader sends exact company and supporting-ID scopes without raw table access",async()=>{
 const calls:any[]=[];const db={rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:payload(),error:null};}};
 assert.deepEqual(await readCardCommunications(db,tenant,{company}),[row]);await readCardCommunications(db,tenant,{ids:[id]});
 assert.deepEqual(calls,[{name:"learn_card_communications_read",args:{p_tenant:tenant,p_person:null,p_company:company,p_job:null,p_ids:null}},{name:"learn_card_communications_read",args:{p_tenant:tenant,p_person:null,p_company:null,p_job:null,p_ids:[id]}}]);
});
test("unbounded, mixed, malformed and oversized scopes never reach the server",async()=>{
 let calls=0;const db={rpc:async()=>{calls++;return {data:payload(),error:null};}};
 for(const scope of [{},{ids:[]},{ids:[id],company},{job:id,company},{person:"x"},{ids:Array(51).fill(id)},{ids:[null]},{company,unknown:id}])await assert.rejects(()=>readCardCommunications(db,tenant,scope as any));assert.equal(calls,0);
});
test("foreign, duplicate, unrelated, removed, oversized and raw-payload responses are withheld",async()=>{
 for(const data of [{...payload(),tenant_id:other},{...payload(),version:"other"},payload([{...row,tenant_id:other}]),payload([row,row]),payload([{...row,related_company_id:other}]),payload([{...row,status:"deleted"}]),payload([{...row,raw_payload:{secret:"fixture"}}]),payload([{...row,subject:"x".repeat(4101)}]),payload(Array(52).fill(row))])await assert.rejects(()=>readCardCommunications({rpc:async()=>({data,error:null})},tenant,{company}));
 await assert.rejects(()=>readCardCommunications({rpc:async()=>({data:null,error:{message:"private diagnostic"}})},tenant,{company}),e=>e instanceof Error&&!e.message.includes("private diagnostic"));
});
test("long Unicode excerpts and explicitly empty permitted reads remain valid",async()=>{
 const unicode={...row,body_preview:"😀".repeat(4000)+"… [excerpt shortened]"};assert.deepEqual(await readCardCommunications({rpc:async()=>({data:payload([unicode]),error:null})},tenant,{company}),[unicode]);assert.deepEqual(await readCardCommunications({rpc:async()=>({data:payload([]),error:null})},tenant,{company}),[]);
});
