import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, triageRelease } from './new-dawn-open-identity-triage-readback.mjs';
import { exactSource, installLive, releaseSql } from './new-dawn-open-identity-triage-release.mjs';

const base = {
  ledger_count: 0, ledger_name: null, ledger_source_sha256: null,
  function_sha256: triageRelease.baseline,
  authenticated_execute: true, anon_execute: false, service_execute: false,
  source_projection_present: true, review_flag_on: 1,
};
const installed = {
  ...base, ledger_count: 1, ledger_name: triageRelease.name,
  ledger_source_sha256: triageRelease.sourceHash,
  function_sha256: triageRelease.candidate,
};
const response = rows => ({ ok: true, arrayBuffer: async () =>
  Buffer.from(JSON.stringify(rows)) });

test('pins one migration and refuses changed grants or ledger', () => {
  const { source, body } = exactSource();
  assert.ok(source.includes(body));
  const sql = releaseSql();
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /identity_triage_release_state_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.equal(assess(base).state, 'triage_reader_ready');
  assert.equal(assess(installed).state, 'triage_reader_installed');
  assert.throws(() => assess({ ...base, anon_execute: true }));
  assert.throws(() => assess({ ...installed, ledger_source_sha256: 'changed' }));
});

test('uncertain write acknowledgement is resolved by readback without replay', async () => {
  let reads = 0; let writes = 0;
  const fetcher = async (url, options) => {
    assert.match(url, /api\.supabase\.com\/v1\/projects\/tgbnakbxwcqjeimygroz\/database\/query/);
    assert.equal(options.method, 'POST');
    if (url.endsWith('/read-only')) return response([reads++ === 0 ? base : installed]);
    writes++;
    throw Error('simulated response lost after commit');
  };
  const result = await installLive('synthetic-token', fetcher);
  assert.equal(result.state, 'triage_reader_installed');
  assert.equal(result.acknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});

test('an already installed release cannot send another write', async () => {
  let writes = 0;
  const fetcher = async url => {
    if (url.endsWith('/read-only')) return response([installed]);
    writes++; return response([]);
  };
  await assert.rejects(() => installLive('synthetic-token', fetcher),
    /identity_triage_already_installed/);
  assert.equal(writes, 0);
});
