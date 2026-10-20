import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, exactSources, releaseSql } from './new-dawn-m2-identity-live-release.mjs';

const before = {
  ledger_count: 0, ledger_rows: null, batch_table: false, item_table: false,
  register_function: false, apply_function: false, reverse_function: false,
  current_links_view_sha256: '4a82874423af1e28d27c0d5aa19158dbc82165ed39dda04b429672fae2f62082',
  card_search_sha256: '6ac809b881991048b1cb6f22664ad536cfef925008cd4dc97b7b58b9905a634e',
  direct_reversal_visible: false, search_guard_visible: false,
  apply_enabled: 0, batch_count: 0, item_count: 0,
  people_count: 11, company_count: 12, site_count: 13,
  job_count: 14, link_count: 15,
};

test('pins all five exact migration sources and assembles an inert schema release', () => {
  assert.equal(exactSources().length, 5);
  assert.equal(assess(before, false).state, 'ready_exact_schema_release');
  const sql = releaseSql(before);
  assert.equal((sql.match(/insert into supabase_migrations\.schema_migrations/g) ?? []).length, 5);
  assert.match(sql, /identity_release_state_changed/);
  assert.match(sql, /identity_release_data_changed/);
  assert.doesNotMatch(sql, /new_dawn\.m2_staged_batch_apply[^\n]*'true'::jsonb[^\n]*update/i);
});

test('stops on partial schema, enabled apply flag or an unexpected ledger', () => {
  for (const changed of [
    { batch_table: true }, { apply_enabled: 1 }, { ledger_count: 1 },
    { batch_count: 1 }, { item_count: 1 },
  ]) assert.throws(() => assess({ ...before, ...changed }, false));
  assert.throws(() => releaseSql({ ...before, people_count: 'unknown' }));
});
