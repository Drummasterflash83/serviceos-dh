import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, exactSource, releaseSql } from './new-dawn-learn-source-totals-release.mjs';

const base = {
  ledger_count: 0, ledger: null, function_present: true, security_definer: true,
  timeout_20s: false, operator_flag_on: 1,
  authenticated_execute: true, anon_execute: false, service_execute: false,
};

test('pins exact source and wraps it once in a guarded ledger transaction', () => {
  assert.match(exactSource().source, /p_part = 'calls'/);
  const sql = releaseSql();
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /learn_source_totals_release_state_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.match(sql, /select 'learn_source_totals_installed' state;\ncommit;$/);
});

test('preflight requires existing protected function and an absent exact ledger', () => {
  assert.equal(assess(base, false).state, 'ready_exact_learn_source_totals');
  assert.throws(() => assess({ ...base, anon_execute: true }, false));
  assert.throws(() => assess({ ...base, ledger_count: 1 }, false));
  assert.throws(() => assess({ ...base, timeout_20s: true }, false));
});

test('installed readback requires exact ledger SHA, grants and function timeout', () => {
  const installed = {
    ...base, ledger_count: 1,
    ledger: { name: 'new_dawn_learn_source_totals_reliability',
      source_sha256: 'ce75d19dc06fac899ae5581a7dad4031a003b306fa3c29fb36f278c6264d005e' },
    timeout_20s: true,
  };
  assert.equal(assess(installed, true).state, 'learn_source_totals_installed');
  assert.throws(() => assess({ ...installed, timeout_20s: false }, true));
  assert.throws(() => assess({ ...installed, ledger: { ...installed.ledger,
    source_sha256: 'wrong' } }, true));
});
