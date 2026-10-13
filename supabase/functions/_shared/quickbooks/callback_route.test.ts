import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quickBooksCallbackRoute} from './callback_route.ts';
import {handleQuickBooksCallback} from './oauth_http.ts';
const project='https://abcdefghijklmnopqrst.supabase.co';
const target=project+'/functions/v1/quickbooks-oauth-callback';
const internal='http://abcdefghijklmnopqrst.supabase.co/quickbooks-oauth-callback';
const functionsHost='https://abcdefghijklmnopqrst.functions.supabase.co/quickbooks-oauth-callback';
test('only the same configured project gateway route maps to its registered public callback',()=>{
  const query='?state=synthetic&code=a%2Bb&realmId=123&state=duplicate';
  assert.deepEqual(quickBooksCallbackRoute(internal+query,project),{url:target+query,route:'gateway'});
  assert.deepEqual(quickBooksCallbackRoute(functionsHost+query,project),{url:target+query,route:'functions'});
  assert.deepEqual(quickBooksCallbackRoute(target+query,project),{url:target+query,route:'public'});
  for(const url of [internal.replace('abcdefghijklmnopqrst','zzzzzzzzzzzzzzzzzzzz'),functionsHost.replace('https:','http:'),internal+':extra',internal+'/other',internal+'#private',internal.replace('http://','http://user@'),target.replace('/functions/v1/','/'),internal.replace('.co/','.co:8443/'),internal.replace('.co/','.co.evil.invalid/')]) assert.throws(()=>quickBooksCallbackRoute(url,project));
  for(const config of ['http://localhost:54321',project+'/other',project+'?x=y','https://foreign.invalid']) assert.throws(()=>quickBooksCallbackRoute(internal,config));
});
test('gateway-normalised callback exchanges once using the registered public redirect and persists company',async()=>{
  const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const now=Date.now(), realm='9130357990011111';let exchanges=0,saved=0;
  const route=quickBooksCallbackRoute(`${internal}?state=${'a'.repeat(43)}&code=synthetic-code&realmId=${realm}`,project);
  const response=await handleQuickBooksCallback(new Request(route.url),{
    siteOrigin:'https://test.example.invalid',minorVersion:75,userRpc:async()=>null,
    serviceRpc:async(name)=>{
      if(name==='learn_quickbooks_claim')return {error:null,data:{requestId:id(5),claimId:id(6),claimUntil:new Date(now+120000).toISOString(),tenantId:id(1),connectionId:id(2),actorId:id(3),expectedRealmId:null,createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+599000).toISOString(),clientSecret:'synthetic-secret',app:{registrationId:id(4),clientId:'synthetic-client',environment:'sandbox',redirectUri:target}}};
      if(name==='learn_quickbooks_claim_current')return {error:null,data:true};
      assert.equal(name,'learn_quickbooks_finish');saved++;return {error:null,data:{state:'saved',connectionId:id(2)}};
    },
    fetcher:async(_url,options)=>{
      if(options?.method==='POST'){exchanges++;assert.equal(new URLSearchParams(String(options.body)).get('redirect_uri'),target);return Response.json({token_type:'bearer',access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,x_refresh_token_expires_in:8640000});}
      return Response.json({CompanyInfo:{Id:'1',CompanyName:'Synthetic Company'}});
    },
  });
  assert.equal(response.status,303);assert.match(response.headers.get('location')!,/result=review#$/);assert.equal(exchanges,1);assert.equal(saved,1);
});
