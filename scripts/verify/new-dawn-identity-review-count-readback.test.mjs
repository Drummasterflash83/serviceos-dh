import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, exactSources } from './new-dawn-identity-review-count-readback.mjs';

const base = {
 server_version: '17.6',
 function_md5: 'fcf76cac657c2245b432cd1199dd48e6',
 service_execute: true, anon_execute: false, authenticated_execute: false,
 index_migration_count: 0, function_migration_count: 0,
 index_ledger: null, function_ledger: null,
 index_count: 0, index_exact: false, raw_review_count: 105367,
};

test('exact migration bytes and baseline are recognised', () => {
 assert.equal(exactSources().length, 2);
 assert.equal(assess(base).stage, 'baseline');
});

test('valid concurrent index is a distinct release stage', () => {
 assert.equal(assess({ ...base, index_count: 1, index_exact: true }).stage,
  'index_ready_unrecorded');
 assert.throws(() => assess({ ...base, index_count: 1, index_exact: false }),
  /identity_review_index_stage_changed/);
 const recorded = { ...base, index_count: 1, index_exact: true,
  index_migration_count: 1,
  index_ledger: { name: 'new_dawn_identity_review_gmail_draft_index',
   sha256: '98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa' } };
 assert.equal(assess(recorded).stage, 'index_recorded');
 assert.throws(() => assess({ ...recorded, index_ledger: { ...recorded.index_ledger,
  sha256: 'wrong' } }), /identity_review_index_ledger_changed/);
});

test('exact installed function and grants are required', () => {
 const installed = { ...base, index_count: 1, index_exact: true,
  index_migration_count: 1, function_migration_count: 1,
  index_ledger: { name: 'new_dawn_identity_review_gmail_draft_index',
   sha256: '98823b2aca835b6c828f298389ca3d5865caf95059ddc3f0ed9cad42a7c2caaa' },
  function_ledger: { name: 'new_dawn_identity_review_count_indexed',
   sha256: 'a48b888c2fb1eaaac59f29c2aabdb489f005dce534bcac9aceb378a59a82dcf7' },
  function_md5: '424e42ecd066f3e6dd7ac553b11f1156' };
 assert.equal(assess(installed).stage, 'installed');
 assert.throws(() => assess({ ...installed, function_md5: 'other' }),
  /identity_review_install_unconfirmed/);
 assert.throws(() => assess({ ...installed, authenticated_execute: true }),
  /identity_review_live_state_changed/);
});
