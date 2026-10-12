import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProductionRuntimeAdapter, productionManagementTransport } from './learn-production-runtime-adapter.mjs';
import { openReleaseJournal } from './learn-production-release-journal.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const project='tgbnakbxwcqjeimygroz';
const read=p=>JSON.parse(readFileSync('supabase/release/learn-production/'+p));

function fixture({allowWrite=true,dbReady=true}={}) {
  const candidate=read('runtime-candidate.manifest.json'),operations=read('release-operations.manifest.json'),bodies=new Map();
  for(const o of operations.operations.filter(o=>o.kind==='runtime'&&o.id!=='publish-runtime-metadata')) {
    const body=Buffer.from('EZBRsynthetic-runtime-fixture:'+o.contract.name);bodies.set(o.contract.request.bodyFile,body);
    o.contract.ezbrSha256=sha(body);
    const url=new URL('https://api.supabase.com'+o.contract.request.path);url.searchParams.set('ezbr_sha256',sha(body));
    o.contract.request.path=url.pathname+url.search;o.pinSha256=sha(JSON.stringify(o.contract));
  }
  const bulk=operations.operations.find(o=>o.id==='publish-runtime-metadata');
  for(const target of bulk.contract.targets)target.ezbrSha256=operations.operations.find(o=>o.id==='runtime-'+target.name).contract.ezbrSha256;
  bulk.pinSha256=sha(JSON.stringify(bulk.contract));
  const runtime=operations.operations.filter(o=>o.kind==='runtime');
  const rows=[...candidate.endpoints.flatMap(e=>e.beforeProduction?[e.beforeProduction]:[]),...candidate.productionEndpointsOutsideCandidate]
    .map(r=>({slug:r.name,name:r.name,id:r.id,version:r.version,ezbr_sha256:r.hash,verify_jwt:r.jwt,status:r.status}));
  const requests=[];let lostResponse=false;
  async function api(r) {
    requests.push(r);
    if(r.method==='GET')return structuredClone(rows);
    if(r.readOnly) {
      if(r.json.query.includes('to_regclass'))return [{ledger_present:dbReady}];
      return candidate.database.map((d,i)=>({migration_name:'fixture-'+i,source_sha256:d.sha256,project_ref:project}));
    }
    if(r.method==='PUT')return {functions:structuredClone(r.json)};
    const url=new URL('https://api.supabase.com'+r.path),name=url.searchParams.get('slug')??url.pathname.split('/').at(-1);
    const current=rows.find(row=>row.slug===name);
    const changed={slug:name,name,id:current?.id??'synthetic-'+name,version:(current?.version??0)+1,
      ezbr_sha256:url.searchParams.get('ezbr_sha256'),verify_jwt:url.searchParams.get('verify_jwt')==='true',status:'ACTIVE',
      entrypoint_path:url.searchParams.get('entrypoint_path'),import_map:false,import_map_path:null,created_at:1};
    if(current)Object.assign(current,changed);else rows.push(changed);
    if(lostResponse)throw Error('Synthetic lost response');
    return changed;
  }
  const adapter=createProductionRuntimeAdapter({candidate,operations,readBody:n=>bodies.get(n),api,allowWrite,
    assertApprovedAndDrained:async step=>({projectRef:project,stepPinSha256:step.pinSha256,approvalEvidenceSha256:'a'.repeat(64)})});
  const steps=runtime.map(({id,kind,pinSha256})=>({id,kind,pinSha256}));
  return {adapter,candidate,operations,rows,requests,bodies,steps,setLost:()=>{lostResponse=true;}};
}
const writes=f=>f.requests.filter(r=>!r.readOnly&&r.method!=='GET');

test('all 37 exact-scoped uploads precede the 37-entry publication payload',async()=>{
  const f=fixture();
  const bulk=f.steps.at(-1);
  assert.equal((await f.adapter.observe(bulk)).state,'drift');
  await assert.rejects(f.adapter.apply(bulk),/precondition/);assert.equal(writes(f).length,0);
  for(const step of f.steps.slice(0,-1)) {
    assert.equal((await f.adapter.observe(step)).state,'ready');await f.adapter.apply(step);
    assert.equal((await f.adapter.observe(step,'after')).state,'applied');
  }
  await f.adapter.apply(bulk);
  assert.equal((await f.adapter.observe(bulk,'after')).state,'applied');
  assert.equal(writes(f).length,38);
  assert.equal(writes(f).filter(r=>r.method==='PATCH').length,28);
  assert.equal(writes(f).filter(r=>r.method==='POST').length,9);
  const publication=writes(f).at(-1);assert.equal(publication.method,'PUT');assert.equal(publication.json.length,37);
  assert.deepEqual(publication.json.map(r=>r.slug),f.candidate.endpoints.map(e=>e.name));
});

test('missing database receipts, read-only mode and changed step pins prevent writes',async()=>{
  const missing=fixture({dbReady:false});await assert.rejects(missing.adapter.apply(missing.steps[0]),/precondition/);
  assert.equal(writes(missing).length,0);
  const readonly=fixture({allowWrite:false});await assert.rejects(readonly.adapter.apply(readonly.steps[0]),/read-only/);
  assert.equal(readonly.requests.length,0);
  const changed=fixture();await assert.rejects(changed.adapter.apply({...changed.steps[0],pinSha256:'f'.repeat(64)}),/pin differs/);
  assert.equal(writes(changed).length,0);
});

test('changed runtime metadata or upload bytes block submission',async()=>{
  const f=fixture();f.rows[0].version++;await assert.rejects(f.adapter.apply(f.steps[0]),/precondition/);assert.equal(writes(f).length,0);
  const g=fixture();g.bodies.set(g.operations.operations.find(o=>o.id===g.steps[0].id).contract.request.bodyFile,Buffer.from('EZBRchanged'));
  await assert.rejects(g.adapter.apply(g.steps[0]),/bytes changed/);assert.equal(writes(g).length,0);
  const h=fixture(),unrelated=h.rows.find(r=>!h.candidate.endpoints.some(e=>e.name===r.slug));
  assert.ok(unrelated);unrelated.version++;
  await assert.rejects(h.adapter.apply(h.steps[0]),/precondition/);assert.equal(writes(h).length,0);
  const receipt=fixture();receipt.candidate.database[0].sha256='f'.repeat(64);
  await assert.rejects(receipt.adapter.apply(receipt.steps[0]),/precondition/);assert.equal(writes(receipt).length,0);
});

test('lost upload response is reconciled by the durable journal without a second upload',async t=>{
  const f=fixture();f.setLost();const step=f.steps[0];
  const root=mkdtempSync(join(tmpdir(),'learn-runtime-journal-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const journal=openReleaseJournal(join(root,'journal'),{version:'learn-production-release-sequence/1',projectRef:project,
    candidateSha256:'f'.repeat(64),steps:[step]},{create:true});
  const ports={observe:f.adapter.observe,apply:f.adapter.apply,authorize:async()=>'a'.repeat(64)};
  try {
    assert.equal((await journal.next(ports)).state,'unknown_outcome');assert.equal(writes(f).length,1);
    assert.equal((await journal.next(ports)).state,'sequence_verified');assert.equal(writes(f).length,1);
  } finally {journal.close();}
});

test('wrong after-version, entrypoint or gateway flag cannot be accepted',async()=>{
  for(const key of ['version','entrypoint_path','verify_jwt']) {
    const f=fixture(),step=f.steps[0];await f.adapter.apply(step);
    const row=f.rows.find(r=>'runtime-'+r.slug===step.id);
    row[key]=key==='version'?row.version+1:key==='verify_jwt'?!row.verify_jwt:'file:///wrong.ts';
    assert.equal((await f.adapter.observe(step,'after')).state,'drift');
  }
});

test('transport permits only fixed-origin read-only queries by default and accepts query HTTP 201',async()=>{
  const seen=[];
  const api=productionManagementTransport('synthetic-token-'.repeat(3),{fetcher:async(url,init)=>{
    seen.push({url,init});return new Response('[{"ledger_present":false}]',{status:201,headers:{'Content-Type':'application/json'}});
  }});
  const path=`/v1/projects/${project}/database/query`;
  const result=await api({method:'POST',path,readOnly:true,json:{query:"begin transaction read only;select to_regclass('of_learn_deploy.migrations') is not null as ledger_present;commit;"}});
  assert.equal(result[0].ledger_present,false);assert.equal(seen[0].init.redirect,'error');
  await assert.rejects(api({method:'POST',path,readOnly:true,json:{query:'delete from public.email_messages'}}),/outside/);
  await assert.rejects(api({method:'PATCH',path:`/v1/projects/${project}/functions/example?x=1`,body:Buffer.from('EZBR')}),/outside/);
  await assert.rejects(api({method:'GET',path:'https://example.invalid/'}),/outside/);assert.equal(seen.length,1);
});
