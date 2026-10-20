import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, exactSource, releaseSql } from './new-dawn-open-identity-release.mjs';

test('release pins the audited read-only queue and checks the migration ledger', () => {
  const { source } = exactSource();
  assert.match(source, /new_dawn_open_identity_review_page/);
  const sql = releaseSql();
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /open_identity_release_state_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(sql, /https?:\/\/|update public\.jobs|insert into public\.jobs|update public\.provider_connections/i);
});

test('release refuses partial installation, missing flag and widened grants', () => {
  const before = {
    ledger_count: 0, ledger: null, function_present: false,
    helper_present: true, review_flag_on: 1, connections: 1,
    authenticated_execute: null, anon_execute: null, service_execute: null,
  };
  assert.equal(assess(before, false).state, 'ready_exact_open_identity_rpc');
  assert.throws(() => assess({ ...before, function_present: true }, false));
  assert.throws(() => assess({ ...before, review_flag_on: 0 }, false));
  assert.throws(() => assess({ ...before, connections: 2 }, false));
  const after = { ...before, ledger_count: 1, function_present: true,
    ledger: { name: 'new_dawn_open_identity_priority',
      source_sha256: '6194386a46ea8402d996123cb95665b17a3cf60fd0109fffd6e4a4e28cb27bcd' },
    authenticated_execute: true, anon_execute: false, service_execute: false };
  assert.equal(assess(after, true).state, 'open_identity_rpc_installed');
  assert.throws(() => assess({ ...after, service_execute: true }, true));
  assert.throws(() => assess({ ...after, ledger: { ...after.ledger,
    source_sha256: '0'.repeat(64) } }, true));
});
