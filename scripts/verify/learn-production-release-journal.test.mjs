import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openReleaseJournal } from './learn-production-release-journal.mjs';

const approved='a'.repeat(64), before='b'.repeat(64), after='c'.repeat(64);
const full=JSON.parse(readFileSync('supabase/release/learn-production/release-sequence.plan.json'));
const small={...full,steps:full.steps.slice(0,2)};
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'learn-release-journal-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return join(root,'private-journal');
}
const observed=(state,evidenceSha256=before)=>({state,evidenceSha256});
function ports(applied) {
  return {authorize:async()=>approved,
    observe:async step=>observed(applied.has(step.id)?'applied':'ready',applied.has(step.id)?after:before),
    apply:async step=>{applied.add(step.id);}};
}

test('all 65 pinned steps execute in order with durable intent before each operation',async t=>{
  const dir=fixture(t), journal=openReleaseJournal(dir,full,{create:true}), applied=new Set(), p=ports(applied);
  const seen=[];
  p.apply=async step=>{
    const files=readdirSync(dir).filter(x=>x.endsWith('.json')).sort();
    const latest=JSON.parse(readFileSync(join(dir,files.at(-1))));
    assert.equal(latest.type,'intent'); assert.equal(latest.step,step.id);
    assert.equal(lstatSync(join(dir,files.at(-1))).mode&0o777,0o600);
    seen.push(step.id);applied.add(step.id);
  };
  try {
    for(const step of full.steps) await journal.next(p);
    assert.deepEqual(seen,full.steps.map(x=>x.id));
    assert.equal(journal.status().state,'sequence_verified');
    await journal.next(p);assert.equal(seen.length,65);
  } finally {journal.close();}
  const reopened=openReleaseJournal(dir,full);
  assert.equal(reopened.status().completed,65);reopened.close();
});

test('lost successful response reconciles read-only after reopen and never replays the write',async t=>{
  const dir=fixture(t), applied=new Set(), p=ports(applied);let submits=0;
  p.apply=async step=>{submits++;applied.add(step.id);throw Error('synthetic-secret-must-not-be-retained');};
  let journal=openReleaseJournal(dir,small,{create:true});
  assert.equal((await journal.next(p)).state,'unknown_outcome');journal.close();
  const bytes=readdirSync(dir).map(f=>readFileSync(join(dir,f),'utf8')).join('');
  assert.equal(bytes.includes('synthetic-secret'),false);
  journal=openReleaseJournal(dir,small);
  assert.equal((await journal.next(p)).completed,1);assert.equal(submits,1);journal.close();
});

test('before-state after an uncertain request cannot trigger an automatic retry',async t=>{
  const journal=openReleaseJournal(fixture(t),small,{create:true});let submits=0;
  const p={authorize:async()=>approved,observe:async()=>observed('ready'),apply:async()=>{submits++;throw Error('timeout');}};
  try {
    await journal.next(p);
    for(let i=0;i<3;i++) assert.equal((await journal.next(p)).state,'unknown_outcome');
    assert.equal(submits,1);assert.equal(journal.status().completed,0);
  } finally {journal.close();}
});

test('HTTP success without exact after-state remains unknown and blocks later steps',async t=>{
  const journal=openReleaseJournal(fixture(t),small,{create:true});let submits=0;
  try {
    const status=await journal.next({authorize:async()=>approved,observe:async(_,phase)=>observed(phase==='before'?'ready':'drift'),
      apply:async()=>{submits++;return {status:200};}});
    assert.equal(status.state,'unknown_outcome');assert.equal(status.completed,0);assert.equal(submits,1);
  } finally {journal.close();}
});

test('missing approval and drift fail before intent or submission',async t=>{
  const dir=fixture(t), journal=openReleaseJournal(dir,small,{create:true});let submits=0;
  const p={authorize:async()=>null,observe:async()=>observed('ready'),apply:async()=>{submits++;}};
  try {
    await assert.rejects(journal.next(p),/approval/);
    p.authorize=async()=>approved;p.observe=async()=>observed('drift');
    await assert.rejects(journal.next(p),/precondition/);
    assert.equal(submits,0);assert.deepEqual(readdirSync(dir).sort(),['0000.json','writer.lock']);
  } finally {journal.close();}
});

test('journal persistence failure prevents submission and poisons the current writer',async t=>{
  const dir=fixture(t), journal=openReleaseJournal(dir,small,{create:true});let submits=0;
  writeFileSync(join(dir,'0001.json'),'partial',{mode:0o600});
  const p={...ports(new Set()),apply:async()=>{submits++;}};
  try {
    await assert.rejects(journal.next(p),/journal write unconfirmed/);
    await assert.rejects(journal.next(p),/uncertain/);assert.equal(submits,0);
  } finally {journal.close();}
  assert.throws(()=>openReleaseJournal(dir,small));
});

test('changed plan, modified event and missing event are rejected on reopen',async t=>{
  const dir=fixture(t), journal=openReleaseJournal(dir,small,{create:true});
  await journal.next(ports(new Set()));journal.close();
  assert.throws(()=>openReleaseJournal(dir,{...small,candidateSha256:'d'.repeat(64)}),/chain or plan/);
  const path=join(dir,'0001.json'), original=readFileSync(path);
  const row=JSON.parse(original);row.approvalEvidenceSha256='e'.repeat(64);
  writeFileSync(path,JSON.stringify(row));
  assert.throws(()=>openReleaseJournal(dir,small),/chain or plan/);
  writeFileSync(path,original);rmSync(path);
  assert.throws(()=>openReleaseJournal(dir,small),/missing sequence/);
});

test('exclusive writer and in-process operation lock prevent concurrent submissions',async t=>{
  const dir=fixture(t), journal=openReleaseJournal(dir,small,{create:true}), applied=new Set();
  assert.throws(()=>openReleaseJournal(dir,small),/EEXIST/);
  let started,finish;const startedPromise=new Promise(r=>{started=r;});const hold=new Promise(r=>{finish=r;});
  const p=ports(applied);p.apply=async step=>{started();await hold;applied.add(step.id);};
  const first=journal.next(p);await startedPromise;
  await assert.rejects(journal.next(p),/already in progress/);
  assert.throws(()=>journal.close(),/running release/);
  finish();assert.equal((await first).completed,1);journal.close();
});
