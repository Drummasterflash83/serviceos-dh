import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, exactSources } from './new-dawn-identity-review-count-readback.mjs';

const base = {
 server_version: '17.6',
 function_md5: 'fcf76cac657c2245b432cd1199dd48e6',
 service_execute: true, anon_execute: false, authenticated_execute: false,
 index_migration_count: 0, function_migration_count: 0,
 index_count: 0, index_exact: false, raw_review_count: 105367,
};

test('exact migration bytes and baseline are recognised', () => {
 assert.equal(exactSources().length, 2);
 assert.equal(assess(base).stage, 'baseline');
});

test('valid concurrent index is a distinct release stage', () => {
 assert.equal(assess({ ...base, index_count: 1, index_exact: true }).stage, 'index_ready');
 assert.throws(() => assess({ ...base, index_count: 1, index_exact: false }),
  /identity_review_index_stage_changed/);
});

test('exact installed function and grants are required', () => {
 const installed = { ...base, index_count: 1, index_exact: true,
  index_migration_count: 1, function_migration_count: 1,
  function_md5: '424e42ecd066f3e6dd7ac553b11f1156' };
 assert.equal(assess(installed).stage, 'installed');
 assert.throws(() => assess({ ...installed, function_md5: 'other' }),
  /identity_review_install_unconfirmed/);
 assert.throws(() => assess({ ...installed, authenticated_execute: true }),
  /identity_review_live_state_changed/);
});
