import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductionSqlAdapter,productionSqlTransport,SQL_OBSERVATIONS } from './learn-production-sql-adapter.mjs';
import { openReleaseJournal } from './learn-production-release-journal.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root='supabase/release/learn-production/';
const project='tgbnakbxwcqjeimygroz';

function fixture({allowWrite=true}={}) {
  const bytes=readFileSync(root+'runtime-candidate.manifest.json'),candidate={...JSON.parse(bytes),manifestSha256:sha(bytes)};
  const operations=JSON.parse(readFileSync(root+'release-operations.manifest.json'));
  const scheduleBaseline=JSON.parse(readFileSync(root+'scheduled-callers.manifest.json'));
  const schedules=[...structuredClone(scheduleBaseline.schedules),{jobid:999,jobname:'unrelated',active:true,schedule:'* * * * *',command_hash:'a'.repeat(32)}];
  const ledger=[],submitted=[];let lost=false,changed=false;
  async function query(sql,{readOnly}) {
    if(readOnly) {
      if(sql===SQL_OBSERVATIONS.ledger)return [{ledger_present:ledger.length>0}];
      if(sql===SQL_OBSERVATIONS.receipts)return structuredClone(ledger);
      if(sql===SQL_OBSERVATIONS.schedules)return structuredClone(schedules);
      throw Error('Unrecognised observation');
    }
    submitted.push(sql);
    if(sql.includes('set serviceos.release_schedule_action=')) {
      const active=sql.includes("release_schedule_action='restore'");
      for(const row of schedules.filter(r=>r.jobid!==999))row.active=active;
    } else {
      const name=/insert into of_learn_deploy\.migrations\s+values\s*\(\s*'([a-z0-9_]+)'/.exec(sql)[1];
      const hash=/set serviceos.release_source_sha256='([a-f0-9]+)'/.exec(sql)[1];
      ledger.push({migration_name:name,source_sha256:hash,project_ref:project});
    }
    if(lost)throw Error('Synthetic commit response lost');
    return [];
  }
  const adapter=createProductionSqlAdapter({candidate,operations,scheduleBaseline,query,allowWrite,
    read:p=>changed?Buffer.concat([readFileSync(p),Buffer.from('\n-- changed')]):readFileSync(p),
    assertApprovedRelease:async step=>({projectRef:project,stepPinSha256:step.pinSha256,approvalEvidenceSha256:'a'.repeat(64)})});
  const steps=operations.operations.filter(o=>['database','schedule'].includes(o.kind)).map(({id,kind,pinSha256})=>({id,kind,pinSha256}));
  return {adapter,steps,ledger,schedules,submitted,loseResponse:()=>{lost=true;},changeBytes:()=>{changed=true;}};
}

test('23 database packages and pause/restoration execute in order without touching unrelated schedule',async()=>{
  const f=fixture(),unrelated=structuredClone(f.schedules.at(-1));
  for(const step of f.steps) {
    assert.equal((await f.adapter.observe(step)).state,'ready');await f.adapter.apply(step);
    assert.equal((await f.adapter.observe(step)).state,'applied');
  }
  assert.equal(f.submitted.length,25);assert.equal(f.ledger.length,23);
  assert.deepEqual(f.schedules.at(-1),unrelated);assert.ok(f.schedules.every(s=>s.active));
  assert.equal((await f.adapter.inspect()).receiptPrefixValid,true);
});

test('out-of-order and duplicate SQL packages are not submitted',async()=>{
  const f=fixture(),db=f.steps.filter(s=>s.kind==='database');
  await assert.rejects(f.adapter.apply(db[1]),/precondition/);assert.equal(f.submitted.length,0);
  await f.adapter.apply(db[0]);await assert.rejects(f.adapter.apply(db[0]),/precondition/);assert.equal(f.submitted.length,1);
});

test('wrong receipt hash, duplicate receipt or extra release receipt blocks the next package',async()=>{
  for(const change of ['hash','duplicate','extra']) {
    const f=fixture(),db=f.steps.filter(s=>s.kind==='database');await f.adapter.apply(db[0]);
    if(change==='hash')f.ledger[0].source_sha256='f'.repeat(64);
    else f.ledger.push(change==='duplicate'?{...f.ledger[0]}:{migration_name:'unexpected',source_sha256:'f'.repeat(64),project_ref:project});
    await assert.rejects(f.adapter.apply(db[1]),/precondition/);assert.equal(f.submitted.length,1);
  }
});

test('changed schedule, missing schedule and changed immutable SQL fail before submission',async()=>{
  for(const change of ['command','missing','active','bytes']) {
    const f=fixture();
    if(change==='command')f.schedules[0].command_hash='f'.repeat(32);
    if(change==='missing')f.schedules.shift();
    if(change==='active')f.schedules[0].active=false;
    if(change==='bytes')f.changeBytes();
    await assert.rejects(f.adapter.apply(f.steps[0]),/precondition|bytes changed/);assert.equal(f.submitted.length,0);
  }
});

test('lost database and schedule commit responses reconcile without resubmission',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'learn-sql-journal-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  for(const kind of ['database','schedule']) {
    const f=fixture(),step=f.steps.find(s=>s.kind===kind);f.loseResponse();
    const journal=openReleaseJournal(join(temp,kind),{version:'learn-production-release-sequence/1',projectRef:project,
      candidateSha256:'f'.repeat(64),steps:[step]},{create:true});
    const ports={observe:f.adapter.observe,apply:f.adapter.apply,authorize:async()=>'a'.repeat(64)};
    try {
      assert.equal((await journal.next(ports)).state,'unknown_outcome');assert.equal(f.submitted.length,1);
      assert.equal((await journal.next(ports)).state,'sequence_verified');assert.equal(f.submitted.length,1);
    } finally {journal.close();}
  }
});

test('read-only adapter and transport reject writes and arbitrary read SQL',async()=>{
  const f=fixture({allowWrite:false});await assert.rejects(f.adapter.apply(f.steps[0]),/read-only/);assert.equal(f.submitted.length,0);
  const requests=[];
  const fetcher=async(url,init)=>{requests.push({url,init});return new Response('[]',{status:201});};
  const query=productionSqlTransport('synthetic-token-'.repeat(3),{fetcher});
  await query(SQL_OBSERVATIONS.ledger,{readOnly:true});
  await assert.rejects(query('select * from auth.users',{readOnly:true}),/allowlist/);
  await assert.rejects(query(f.adapter.writeStatements[0],{readOnly:false}),/allowlist/);
  assert.equal(requests.length,1);assert.equal(requests[0].init.redirect,'error');
  const writer=productionSqlTransport('synthetic-token-'.repeat(3),{fetcher,allowWrite:true,writeStatements:f.adapter.writeStatements});
  await assert.rejects(writer(f.adapter.writeStatements[0]+'\n',{readOnly:false}),/allowlist/);
  await writer(f.adapter.writeStatements[0],{readOnly:false});assert.equal(requests.length,2);
});
