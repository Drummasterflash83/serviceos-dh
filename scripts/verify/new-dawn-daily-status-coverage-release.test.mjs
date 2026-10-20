import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, exactSource, releaseSql } from './new-dawn-daily-status-coverage-release.mjs';

test('release pins one exact schema-only source and guards duplicate installation', () => {
  const { source } = exactSource();
  assert.match(source, /new_dawn_daily_status_coverage/);
  const sql = releaseSql();
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /coverage_release_state_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(sql, /https?:\/\/|provider_connections.*update|new_dawn_job_status_daily.*insert/i);
});

test('release refuses partial, widened or unverified runtime grants', () => {
  const before = {
    ledger_count: 0, ledger: null, function_present: false,
    observation_table: true, seed_table: true, operator_flag_on: 1,
    authenticated_execute: null, anon_execute: null, service_execute: null,
  };
  assert.equal(assess(before, false).state, 'ready_exact_coverage_rpc');
  assert.throws(() => assess({ ...before, function_present: true }, false));
  assert.throws(() => assess({ ...before, operator_flag_on: 0 }, false));
  const after = { ...before, ledger_count: 1, function_present: true,
    ledger: { name: 'new_dawn_daily_status_coverage_home',
      source_sha256: '6615ee9a3846a07fc882cbae5ffda8087a72718fc1ec6809608fa848d965763f' },
    authenticated_execute: true, anon_execute: false, service_execute: false };
  assert.equal(assess(after, true).state, 'coverage_rpc_installed');
  assert.throws(() => assess({ ...after, anon_execute: true }, true));
  assert.throws(() => assess({ ...after, ledger: { ...after.ledger,
    source_sha256: '0'.repeat(64) } }, true));
});
