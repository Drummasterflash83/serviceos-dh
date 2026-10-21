import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, releaseSql, sources } from './new-dawn-current-job-source-release.mjs';

const [projection, summary] = sources();
const baseline = '1a373342368cc703a09860bc6162c0a98a8116cebd104719d212449fb9603f9a';
const candidate = '9219b20578e4213f927785ffd4c0714066cdb5972997b7b02e9024ef0fff4e23';

function stageRow(stage) {
  return {
    ledger_1_count: stage >= 1 ? 1 : 0,
    ledger_1_sha: stage >= 1 ? projection.sha : null,
    ledger_2_count: stage >= 2 ? 1 : 0,
    ledger_2_sha: stage >= 2 ? summary.sha : null,
    cache_present: stage >= 1,
    trigger_present: stage >= 1,
    summary_sha: stage >= 2 ? candidate : baseline,
    auth_execute: true, anon_execute: false, service_execute: false,
  };
}

test('only exact source files and coherent release stages pass', () => {
  assert.equal(projection.version, '20261113000000');
  assert.equal(summary.version, '20261113010000');
  for (const stage of [0, 1, 2]) {
    assert.equal(assess(stageRow(stage), stage).stage, stage);
    const changed = { ...stageRow(stage), trigger_present: !stageRow(stage).trigger_present };
    assert.throws(() => assess(changed, stage), /stage_changed/);
  }
  assert.throws(() => assess({ ...stageRow(2), anon_execute: true }, 2), /stage_changed/);
  assert.throws(() => assess({ ...stageRow(2), ledger_1_sha: null }, 2), /stage_changed/);
});

test('each stage is exact, guarded, ledgered and distinct', () => {
  const first = releaseSql(1);
  const second = releaseSql(2);
  for (const sql of [first, second]) {
    assert.match(sql, /^begin;\n/);
    assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
    assert.match(sql, /current_job_source_release_state_changed/);
    assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
    assert.match(sql, /trigger_present|tgname='new_dawn_commusoft_current_job_source_observe'/);
    assert.match(sql, /commit;$/);
  }
  assert.match(first, /create table public\.new_dawn_commusoft_current_job_source/);
  assert.doesNotMatch(first, /open_job_summary_candidate_changed/);
  assert.match(second, /open_job_summary_candidate_changed/);
  assert.match(second, new RegExp(projection.sha));
  assert.throws(() => releaseSql(3), /stage_invalid/);
});
