import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDailyMoneyStatus } from './new-dawn-daily-money-readback.mjs';

const row = () => ({ policy_count: 1, enabled_count: 1,
  latest_complete_day: '2026-10-20', latest_run_day: '2026-10-20',
  latest_run_state: 'complete' });

test('readback reports only policy and run state, never report contents', () => {
  assert.deepEqual(parseDailyMoneyStatus([row()]), {
    policyPresent: true, enabled: true, latestCompleteDay: '2026-10-20',
    latestRunDay: '2026-10-20', latestRunState: 'complete',
  });
  assert.deepEqual(parseDailyMoneyStatus([{
    ...row(), policy_count: 0, enabled_count: 0,
    latest_complete_day: null, latest_run_day: null, latest_run_state: null,
  }]), {
    policyPresent: false, enabled: false, latestCompleteDay: null,
    latestRunDay: null, latestRunState: null,
  });
});

test('readback refuses contradictory or malformed state', () => {
  for (const patch of [
    { policy_count: 0 }, { enabled_count: 2 },
    { latest_run_day: null }, { latest_run_state: 'succeeded' },
    { latest_complete_day: '20 October' },
    { latest_complete_day: '2026-02-30' },
    { latest_complete_day: '2026-10-21' },
    { latest_run_state: 'complete', latest_complete_day: null },
  ]) assert.throws(() => parseDailyMoneyStatus([{ ...row(), ...patch }]));
  assert.throws(() => parseDailyMoneyStatus([]));
});
