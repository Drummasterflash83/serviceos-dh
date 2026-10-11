import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import ts from 'typescript';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('HTTP wrapper marks partial identity delivery failed, never complete, and preserves failure counts',async()=>{
 const actual={success:false,recordsProcessed:1,result:{failed:1,cards_enriched:1},error:{code:'identity_delivery_unconfirmed',message:'Retained inputs need retry'}};
 for(const result of [actual,{success:true,recordsProcessed:2,result:{cards_projected:2,failed:0}}]){
  let handler;const calls=[];
  const code=readFileSync(new URL('../supabase/functions/identity-resolve/index.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},Deno:{serve:fn=>handler=fn},Request,Response,require:name=>{
   if(name.endsWith('/simwood.ts'))return{corsHeaders:{},createSupabaseAdmin:()=>({}),failResponse:(code,message,status)=>Response.json({success:false,error:{code,message}},{status}),jsonResponse:d=>Response.json(d)};
   if(name.endsWith('/authz.ts'))return{requireTenantUser:async()=>({ok:true,ctx:{tenantId:id(100),userId:id(101)}}),assertSameTenant:()=>null};
   if(name.endsWith('/identity_resolve.ts'))return{handleIdentityResolve:async()=>result};
   if(name.endsWith('/platform_jobs.ts'))return{createPlatformJob:async()=>({id:id(102)}),startPlatformJob:async()=>{},completePlatformJob:async(...args)=>calls.push(['complete',...args]),failPlatformJob:async(...args)=>calls.push(['failed',...args])};
   throw Error('Unexpected wrapper import');
  }});
  const response=await handler(new Request('https://test.invalid',{method:'POST',body:'{}'}));
  assert.equal(response.status,result.success?200:500);assert.equal(calls.length,1);assert.equal(calls[0][0],result.success?'complete':'failed');
  if(!result.success)assert.equal(calls[0][4].failed,1);
 }
});
