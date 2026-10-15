import test from "node:test";
import assert from "node:assert/strict";
import { assessLastSuccess } from "./check-daily-backup-success.mjs";

const now = Date.parse("2026-10-16T12:00:00Z");
const run = (hours, overrides = {}) => ({
  conclusion: "success", name: "ServiceOS independent database backup",
  head_branch: "main", updated_at: new Date(now - hours * 3_600_000).toISOString(),
  ...overrides,
});

test("missed daily success is based on the latest verified workflow completion", () => {
  assert.equal(assessLastSuccess([run(26)], now).state, "database_daily_success_current");
  assert.equal(assessLastSuccess([run(26.01)], now).state, "database_daily_success_overdue");
  assert.equal(assessLastSuccess([run(30), run(2)], now).lastSuccessAt, run(2).updated_at);
  assert.equal(assessLastSuccess([], now).state, "database_daily_success_missing");
  assert.equal(assessLastSuccess([run(1, { head_branch: "untrusted" })], now).state,
    "database_daily_success_missing");
  assert.equal(assessLastSuccess([run(1, { conclusion: "failure" })], now).state,
    "database_daily_success_missing");
});
