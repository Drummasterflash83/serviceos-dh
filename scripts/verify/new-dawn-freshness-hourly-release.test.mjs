import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, exactSource, releaseSql } from './new-dawn-freshness-hourly-release.mjs';

const oldHash = 'ac033ade3ed10ea707e67e3885c60654561c967e455e58ae6bf46606d509ed27';
const sourceHash = '937601c61992f1c6d6a5d27ab1bf5e4edfa82d33503f0849b81ffbb00e0ab472';
const common = {
  service_execute: true, authenticated_execute: false, anon_execute: false,
  enabled_count: 1,
};

test('hourly source is pinned and preserves one-hour cooldown and service-role boundary', () => {
  const { source, body } = exactSource();
  assert.match(source, /run_number>=26/);
  assert.match(source, /interval '1 hour'/);
  assert.match(source, /auth\.role\(\) is distinct from 'service_role'/);
  assert.doesNotMatch(source, /saved_id is not distinct from latest_id/);
  assert.doesNotMatch(body, /\b(?:begin|commit);/i);
});

test('LIVE preflight requires exact old function, cap, grants, flag and empty ledger', () => {
  const row = { ...common, definition_sha256: oldHash,
    run_cap: 'CHECK (((run_number >= 1) AND (run_number <= 8)))',
    ledger_count: 0, ledger_name: null, statement_count: null, ledger_hash: null,
    unchanged_skip_in_function: true, hourly_cap_in_function: false };
  assert.equal(assess(row, false).state, 'ready_exact_release');
  for (const changed of [
    { definition_sha256: 'changed' }, { enabled_count: 0 },
    { authenticated_execute: true }, { ledger_count: 1 },
    { run_cap: 'CHECK (((run_number >= 1) AND (run_number <= 26)))' },
  ]) assert.throws(() => assess({ ...row, ...changed }, false), /hourly_live_stage_changed/);
});

test('LIVE readback requires the exact installed source receipt', () => {
  const row = { ...common, definition_sha256: 'new-function-hash',
    run_cap: 'CHECK (((run_number >= 1) AND (run_number <= 26)))',
    ledger_count: 1, ledger_name: 'new_dawn_hourly_commusoft_freshness',
    statement_count: 1, ledger_hash: sourceHash,
    unchanged_skip_in_function: false, hourly_cap_in_function: true };
  assert.equal(assess(row, true).state, 'installed_hourly');
  assert.throws(() => assess({ ...row, ledger_hash: 'wrong-source' }, true));
});

test('release is one atomic, drift-checked migration and starts no provider request', () => {
  const sql = releaseSql();
  assert.match(sql, /^begin;/);
  assert.match(sql, /hourly_release_state_changed/);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length, 1);
  assert.match(sql, /select '20261110230000' installed_version;\ncommit;$/);
  assert.doesNotMatch(sql, /https?:\/\/|net\.http|pg_cron|update public\.feature_flags/i);
});
