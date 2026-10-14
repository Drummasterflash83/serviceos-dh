import { test } from "node:test";
import assert from "node:assert/strict";
import { quickBooksLeaseBudget } from "./lease_deadline.ts";
import { refreshQuickBooksConnection } from "./oauth_flow.ts";
const now=Date.parse("2026-10-13T20:00:00Z");
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
test("small database clock lead is accepted without extending the worker budget",()=>{
 assert.equal(quickBooksLeaseBudget(new Date(now+120080).toISOString(),now),115000);
 assert.equal(quickBooksLeaseBudget(new Date(now+100000).toISOString(),now),95000);
 for(const delta of [-1,0,5000,125001,999999]) assert.equal(quickBooksLeaseBudget(new Date(now+delta).toISOString(),now),null);
 assert.equal(quickBooksLeaseBudget("invalid",now),null);
 assert.equal(quickBooksLeaseBudget(new Date(now).toISOString(),NaN),null);
});
test("refresh with real-world clock skew exchanges once and persists through the lease RPC",async()=>{
 let sent=0, saved=0;
 const result=await refreshQuickBooksConnection(id(1),id(2),{
 clock:()=>now,
 rpc:async(name,args)=>{
  if(name==="learn_quickbooks_refresh_acquire")return {error:null,data:{state:"ready",leaseId:id(3),leaseUntil:new Date(now+120080).toISOString(),revision:6,generation:1,clientId:"synthetic",clientSecret:"synthetic",refreshToken:"synthetic"}};
  assert.equal(name,"learn_quickbooks_refresh_finish");assert.equal(args.p_lease,id(3));assert.equal(args.p_generation,1);saved++;return {error:null,data:null};
 },fetcher:async()=>{sent++;return Response.json({token_type:"bearer",access_token:"synthetic",refresh_token:"synthetic",expires_in:3600,x_refresh_token_expires_in:8640000});}
 });
 assert.equal(result,"refreshed");assert.equal(sent,1);assert.equal(saved,1);
});
