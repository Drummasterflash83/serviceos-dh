import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assess, exactSource, releaseSql } from './new-dawn-open-job-page-current-source-release.mjs';

const sourceHash = 'fd9c2495d6942b6a013ada5aa546d0cb63cefd1eae0faefb277781580e975994';
const priorHash = '408a51b873f52f48ee5acad60d932b8d2c7ee4d1ba20fb0c8e698a6cb26307f8';
const candidateHash = '92e1e37fcd0b20a333b209dfb6223c6206121a65e20cd716426faa048aec2e26';
const base = {
  projection_count: 1,
  projection_hash: 'd1a2c9e754b285d6a8360427d5e75db1d7359a969871b53fb09365981e1ef46c',
  summary_count: 1,
  summary_hash: '2c19c89b0c24cd896655702c1095614400db7d36c4ca14be10a437815ae7fa49',
  cache_present: true, auth_execute: false, anon_execute: false,
  service_execute: false, ledger_count: 0, ledger_name: null,
  ledger_hash: null, function_hash: priorHash,
};

test('preflight only accepts the exact source and prior function', () => {
  assert.equal(assess(base).state, 'ready_exact');
  assert.throws(() => assess({ ...base, function_hash: candidateHash }));
  assert.throws(() => assess({ ...base, projection_count: 0 }));
  assert.throws(() => assess({ ...base, auth_execute: true }));
});

test('installed readback requires exact ledger source and candidate', () => {
  assert.equal(assess({ ...base, ledger_count: 1,
    ledger_name: 'new_dawn_open_job_page_current_source',
    ledger_hash: sourceHash, function_hash: candidateHash }).state, 'installed');
  assert.throws(() => assess({ ...base, ledger_count: 1,
    ledger_name: 'new_dawn_open_job_page_current_source',
    ledger_hash: priorHash, function_hash: candidateHash }));
});

test('release wraps the one exact migration in a guarded transaction', () => {
  assert.match(exactSource().source, /current_at_anchor as materialized/);
  const sql = releaseSql();
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /page_current_source_release_state_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.ok(sql.endsWith('commit;'));
});
