import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assess, exactSource, releaseSql } from './new-dawn-customer-work-descriptions-release.mjs';

const base = () => ({
  stage_1_count: 1,
  stage_1_hash: 'd1a2c9e754b285d6a8360427d5e75db1d7359a969871b53fb09365981e1ef46c',
  stage_2_count: 1,
  stage_2_hash: '2c19c89b0c24cd896655702c1095614400db7d36c4ca14be10a437815ae7fa49',
  cache_present: true, trigger_present: true,
  auth_execute: true, anon_execute: false, service_execute: false,
  ledger_count: 0, ledger_name: null, ledger_hash: null,
  function_hash: 'a2f5916d204014e3affced8136308a74e67d6c0d42ea7856cdf27d7276f813c0',
});

test('exact source and release use one guarded transaction with a ledger insert', () => {
  assert.match(exactSource().body, /customer_work_description_candidate_changed/);
  const sql = releaseSql();
  assert.match(sql, /^begin;/);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.match(sql, /commit;$/);
});

test('only the exact post-dependency catalog can advance', () => {
  assert.equal(assess(base()).state, 'ready_exact');
  const installed = { ...base(), ledger_count: 1,
    ledger_name: 'new_dawn_customer_work_descriptions',
    ledger_hash: '6af7397766541cea5c8c6e5f9e704d5f70344beb00c23272aeb8c11985d7dcd8',
    function_hash: '99c5e202c99aec449c20cc89b4f87923a97fef79dbd8804e9c9e0fa2fae16eea' };
  assert.equal(assess(installed).state, 'installed');
  assert.throws(() => assess({ ...base(), stage_2_hash: 'changed' }));
  assert.throws(() => assess({ ...base(), ledger_count: 1 }));
  assert.throws(() => assess({ ...installed, function_hash: base().function_hash }));
  assert.throws(() => assess({ ...base(), anon_execute: true }));
});
