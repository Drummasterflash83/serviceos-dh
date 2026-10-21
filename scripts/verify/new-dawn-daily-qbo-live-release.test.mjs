import assert from 'node:assert/strict';
import test from 'node:test';
import { assessLiveStage, reviewedSource, SCHEMA, SCHEDULE } from './new-dawn-daily-qbo-live-release.mjs';

const before = {
  schema_ledger: 0, schema_hash: null, schedule_ledger: 0, schedule_hash: null,
  policy_table: false, claim_function: false, vault_key_count: 0,
  schedule_count: 0, schedule_valid: 0, policy_count: 0, enabled_count: 0,
  edge: null,
};
const edge = { status: 'ACTIVE', verify_jwt: false,
  ezbr_sha256: '573ee0fb0133f1e9eae766a8bad10144d7af9941cb3a4ec92c8e94302d5e005a' };

test('only the exact reviewed migration bodies are eligible for release', () => {
  const a = reviewedSource(SCHEMA), b = reviewedSource(SCHEDULE);
  assert.match(a.body, /create table public\.learn_quickbooks_daily_reports/);
  assert.match(b.body, /perform cron\.schedule\('openfolk-quickbooks-daily-reports'/);
  for (const item of [a, b]) assert.doesNotMatch(item.body, /^\s*(begin|commit);\s*$/im);
  assert.throws(() => reviewedSource([SCHEMA[0], SCHEMA[1], '0'.repeat(64)]));
});

test('release stages require exact default-off schema, worker, key and trigger', () => {
  assert.equal(assessLiveStage(before, 'before').state, 'before');
  const schema = { ...before, schema_ledger: 1, schema_hash: SCHEMA[2],
    policy_table: true, claim_function: true };
  assert.equal(assessLiveStage(schema, 'schema').state, 'schema');
  const withEdge = { ...schema, edge };
  assert.equal(assessLiveStage(withEdge, 'edge').state, 'edge');
  const withKey = { ...withEdge, vault_key_count: 1 };
  assert.equal(assessLiveStage(withKey, 'key').state, 'key');
  const withSchedule = { ...withKey, schedule_ledger: 1,
    schedule_hash: SCHEDULE[2], schedule_count: 1, schedule_valid: 1 };
  assert.equal(assessLiveStage(withSchedule, 'schedule').state, 'schedule');
  for (const change of [
    { edge: { ...edge, verify_jwt: true } }, { enabled_count: 1 },
    { schedule_valid: 0 }, { schedule_hash: null }, { vault_key_count: 0 },
  ]) assert.throws(() => assessLiveStage({ ...withSchedule, ...change }, 'schedule'));
});
