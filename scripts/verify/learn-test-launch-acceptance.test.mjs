import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixturePlan,acceptLaunch,readAcceptanceResponse } from './learn-test-launch-acceptance.mjs';
import { TEST_PROJECT,TEST_ORGANIZATION } from './learn-test-readiness.mjs';
const token='sbp_'+'a'.repeat(40);
test('synthetic plan uses fresh isolated IDs, reserved email domains and tenant-bound roles',()=>{
  const p=fixturePlan(),other=fixturePlan();
  assert.equal(p.projectRef,TEST_PROJECT);assert.notEqual(p.runId,other.runId);
  assert.equal(p.tenants.length,2);assert.equal(p.users.length,5);
  assert.ok(p.users.every(u=>u.email.endsWith('@example.invalid')&&p.tenants.some(t=>t.id===u.tenant)));
  const ids=[...p.tenants.flatMap(t=>[t.id,t.email,t.call,t.recording,t.transcript,t.sync]),...p.users.map(u=>u.id)];
  assert.equal(new Set(ids).size,17);assert.ok(ids.every(id=>/^[0-9a-f-]{36}$/.test(id)));
  assert.equal(JSON.stringify(p).includes('password'),false);
});
test('production target is rejected before key lookup, fixture creation or any request',async()=>{
  let calls=0;
  await assert.rejects(()=>acceptLaunch({allowProjectRef:'tgbnakbxwcqjeimygroz',token,fetcher:async()=>{calls++;throw Error('Unexpected');}}));
  assert.equal(calls,0);
});
test('uninstalled TEST cannot read keys or create fixtures',async()=>{
  const snapshot=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-schema-2026-10-09.json',import.meta.url)));
  const calls=[];
  await assert.rejects(()=>acceptLaunch({allowProjectRef:TEST_PROJECT,token,fetcher:async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify(calls.length===1?{id:TEST_PROJECT,organization_id:TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'}
      :calls.length===2?[{inventory:snapshot}]:[]));
  }}),/Installed TEST/);
  assert.ok(calls.every(c=>!c.url.includes('/api-keys')&&!c.url.includes('/auth/')&&!c.url.endsWith('/database/query')));
});

test('successful empty mutation responses are accepted without iterating a null body',async()=>{
 assert.deepEqual(await readAcceptanceResponse(new Response(null,{status:204})),{status:204,ok:true,data:null});
 assert.deepEqual(await readAcceptanceResponse(new Response(JSON.stringify({code:'23514'}),{status:400})),{status:400,ok:false,data:{code:'23514'}});
});
