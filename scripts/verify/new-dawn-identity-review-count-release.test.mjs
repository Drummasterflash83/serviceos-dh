import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { exactReleaseSources, indexSql, indexLedgerSql, functionReleaseSql,
 nextStep, resolveUncertainAcknowledgement, installStandaloneIndex,
 recordIndexLedger, installFunction } from './new-dawn-identity-review-count-release.mjs';

const base = {
 server_version: '17.6', function_md5: 'fcf76cac657c2245b432cd1199dd48e6',
 service_execute: true, anon_execute: false, authenticated_execute: false,
 index_migration_count: 0, index_ledger: null,
 function_migration_count: 0, function_ledger: null,
 index_count: 0, index_exact: false, raw_review_count: 105367,
};
const indexLedger = { name: 'new_dawn_identity_review_gmail_draft_index',
 sha256: '98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa' };
const functionLedger = { name: 'new_dawn_identity_review_count_indexed',
 sha256: 'a48b888c2fb1eaaac59f29c2aabdb489f005dce534bcac9aceb378a59a82dcf7' };

test('concurrent index is exactly one standalone statement', () => {
 const sources = exactReleaseSources();
 assert.equal(indexSql(), sources.index);
 assert.match(indexSql(), /create index concurrently learn_email_gmail_draft_review_idx/i);
 assert.doesNotMatch(indexSql(), /\bbegin\s*;|\bcommit\s*;/i);
 assert.equal((indexSql().match(/;(?=\s*$)/g) || []).length, 1);
});

test('index ledger only records an exact valid index after a transactional guard', () => {
 const sql = indexLedgerSql();
 assert.match(sql, /^begin;\n/);
 assert.match(sql, /x\.indisvalid and x\.indisready/);
 assert.match(sql, /fcf76cac657c2245b432cd1199dd48e6/);
 assert.match(sql, /index_ledger_state_changed/);
 assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
 assert.match(sql, /\ncommit;$/);
});

test('function stage requires exact first ledger, index, old function, then records second ledger', () => {
 const sql = functionReleaseSql();
 assert.match(sql, /^begin;\n/);
 assert.match(sql, /98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa/);
 assert.match(sql, /identity_review_function_release_state_changed/);
 assert.match(sql, /create or replace function public\.learn_identity_review_count/);
 assert.match(sql, /values\('20261112193100','new_dawn_identity_review_count_indexed'/);
 assert.match(sql, /\ncommit;$/);
});

test('unknown acknowledgement is resolved only by exact readback, never replayed', () => {
 const indexReady = { ...base, index_count: 1, index_exact: true };
 assert.equal(nextStep(indexReady).next, 'record_exact_index_migration');
 assert.equal(resolveUncertainAcknowledgement(indexReady,'index_ready_unrecorded').replayAllowed,false);
 assert.throws(() => resolveUncertainAcknowledgement(base,'index_ready_unrecorded'),
  /identity_review_uncertain_ack:baseline/);
 const installed = { ...indexReady, index_migration_count: 1,
  index_ledger: indexLedger, function_migration_count: 1,
  function_ledger: functionLedger, function_md5: '424e42ecd066f3e6dd7ac553b11f1156' };
 assert.equal(resolveUncertainAcknowledgement(installed,'installed').next,
  'observe_worker_without_manual_retry');
});

test('LIVE write flags require the exact project and both source hashes', () => {
 const path = fileURLToPath(new URL('./new-dawn-identity-review-count-release.mjs',import.meta.url));
 const run = spawnSync(process.execPath,[path,'--live-index-exact'],{encoding:'utf8',
  env: { ...process.env, NEW_DAWN_IDENTITY_REVIEW_PROJECT: '' }});
 assert.equal(run.status,1);
 assert.match(run.stderr,/identity_review_exact_release_pin_required/);
});

test('standalone index performs one exact write then verifies after lost acknowledgement',async () => {
 let reads=0,writes=0;
 const fetcher=async (url,options) => {
  if(url.endsWith('/database/query/read-only')) {
   reads++;
   return new Response(JSON.stringify([reads===1?base:
    {...base,index_count:1,index_exact:true}]),{status:200});
  }
  writes++;
  assert.equal(url,'https://api.supabase.com/v1/projects/tgbnakbxwcqjeimygroz/database/query');
  assert.equal(JSON.parse(options.body).query,indexSql());
  throw Error('lost acknowledgement');
 };
 const result=await installStandaloneIndex('synthetic-token',fetcher);
 assert.equal(result.stage,'index_ready_unrecorded');
 assert.equal(result.acknowledged,false);
 assert.equal(result.replayAllowed,false);
 assert.equal(reads,2);assert.equal(writes,1);
});

test('ledger and function stages each require and verify their own exact state',async () => {
 const indexReady={...base,index_count:1,index_exact:true};
 const indexRecorded={...indexReady,index_migration_count:1,index_ledger:indexLedger};
 const installed={...indexRecorded,function_migration_count:1,
  function_ledger:functionLedger,function_md5:'424e42ecd066f3e6dd7ac553b11f1156'};
 for(const [run,before,after,expectedSql] of [
  [recordIndexLedger,indexReady,indexRecorded,indexLedgerSql()],
  [installFunction,indexRecorded,installed,functionReleaseSql()],
 ]) {
  let reads=0,writes=0;
  const fetcher=async (url,options) => {
   if(url.endsWith('/database/query/read-only')) {
    reads++;
    return new Response(JSON.stringify([reads===1?before:after]),{status:200});
   }
   writes++;
   assert.equal(JSON.parse(options.body).query,expectedSql);
   return new Response(JSON.stringify([{state:'acknowledged'}]),{status:200});
  };
  const result=await run('synthetic-token',fetcher);
  assert.equal(result.stage,after===installed?'installed':'index_recorded');
  assert.equal(result.acknowledged,true);
  assert.equal(result.replayAllowed,false);
  assert.equal(reads,2);assert.equal(writes,1);
 }
});
