import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, exactSource, installLive, releaseSql } from './new-dawn-daily-status-completed-streak-release.mjs';

const sourceSha = '0542ab1e768a735ede4238d3bf270e184019fd1431a5b4958e8d750339045ce6';
const baselineSha = '6615ee9a3846a07fc882cbae5ffda8087a72718fc1ec6809608fa848d965763f';
const functionSha = '2215e373d11f125f9df8aedb12068a4174ecdbdfc6edf326d3ee513accf73e4c';
const before = () => ({ server_version: '17.6', baseline_count: 1,
  baseline: { name: 'new_dawn_daily_status_coverage_home', source_sha256: baselineSha },
  target_count: 0, target: null, function_present: true, function_sha: functionSha,
  has_completed_streak_guard: false, operator_flag_on: 1,
  authenticated_execute: true, anon_execute: false, service_execute: false });
const after = () => ({ ...before(), target_count: 1,
  target: { name: 'new_dawn_daily_status_completed_streak', source_sha256: sourceSha },
  function_sha: 'a'.repeat(64), has_completed_streak_guard: true });

test('release pins one exact replacement, baseline fingerprint and ledger transaction', () => {
  const { source } = exactSource();
  assert.match(source, /create or replace function public\.new_dawn_daily_status_coverage/);
  const sql = releaseSql();
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /completed_streak_release_state_changed/);
  assert.match(sql, /pg_get_functiondef/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.match(sql, /20261111190000/);
  assert.doesNotMatch(sql, /https?:\/\/|provider_connections.*update|new_dawn_job_status_daily.*insert/i);
});

test('preflight and readback reject changed source, grants, or function', () => {
  assert.equal(assess(before(), false).state, 'ready_exact_completed_streak');
  assert.equal(assess(after(), true).state, 'completed_streak_installed');
  assert.throws(() => assess({ ...before(), baseline: {
    ...before().baseline, source_sha256: '0'.repeat(64) } }, false));
  assert.throws(() => assess({ ...before(), function_sha: '0'.repeat(64) }, false));
  assert.throws(() => assess({ ...before(), anon_execute: true }, false));
  assert.throws(() => assess({ ...before(), target_count: 1 }, false));
  assert.throws(() => assess({ ...after(), has_completed_streak_guard: false }, true));
  assert.throws(() => assess({ ...after(), target: {
    ...after().target, source_sha256: '0'.repeat(64) } }, true));
});

test('a changed LIVE preflight never sends an install query', async () => {
  let writes = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith('/database/query')) writes++;
    const value = url.endsWith('/database/query/read-only')
      ? [{ ...before(), function_sha: '0'.repeat(64) }]
      : { id: 'tgbnakbxwcqjeimygroz', status: 'ACTIVE_HEALTHY' };
    return new Response(JSON.stringify(value), { status: 200 });
  };
  await assert.rejects(installLive('synthetic-only', fetcher), /completed_streak_live_state_changed/);
  assert.equal(writes, 0);
});
