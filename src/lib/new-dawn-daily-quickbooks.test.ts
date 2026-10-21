import assert from 'node:assert/strict';
import test from 'node:test';
import { DRUMMONDS_FY27_PAIR } from './new-dawn-fy27-report-pair.ts';
import { readDailyQuickBooksStatus } from './new-dawn-daily-quickbooks.ts';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = Date.parse('2026-10-21T06:00:00Z');
const value = {
  version: 'new-dawn-daily-quickbooks-status/1',
  tenant_id: DRUMMONDS_FY27_PAIR.tenantId, actor_id: actor,
  connection_id: DRUMMONDS_FY27_PAIR.connectionId,
  audit_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', read_at: '2026-10-21T06:00:00Z',
  enabled: false, revision: 0, period_start: null,
  expected_day: '2026-10-20', overdue: false,
  latest_day: null, latest_state: null, latest_code: null,
};

test('accepts an exact initial disabled policy', () => {
  assert.equal(readDailyQuickBooksStatus(value, actor, now).revision, 0);
});
test('accepts a dated complete run without report contents', () => {
  const result = readDailyQuickBooksStatus({ ...value, enabled: true, revision: 1,
    period_start: DRUMMONDS_FY27_PAIR.periodStart, latest_day: '2026-10-20',
    latest_state: 'complete' }, actor, now);
  assert.equal(result.latestDay, '2026-10-20');
});
test('shows an overdue scheduled pair without claiming a successful read', () => {
  const result = readDailyQuickBooksStatus({ ...value, enabled: true, revision: 1,
    period_start: DRUMMONDS_FY27_PAIR.periodStart, overdue: true }, actor, now);
  assert.equal(result.overdue, true);
  assert.equal(result.latestDay, null);
});
test('rejects wrong company, actor, scope and stale status', () => {
  for (const change of [
    { tenant_id: actor }, { actor_id: DRUMMONDS_FY27_PAIR.tenantId },
    { connection_id: actor }, { period_start: '2015-01-01' },
    { read_at: '2026-10-20T06:00:00Z' },
  ]) assert.throws(() => readDailyQuickBooksStatus({ ...value, ...change }, actor, now));
});
