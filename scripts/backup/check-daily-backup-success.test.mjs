import test from "node:test";
import assert from "node:assert/strict";
import { assessLastSuccess, checkDailyBackupSuccess } from "./check-daily-backup-success.mjs";

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

test("hosted check requests only main-branch successes and rejects other branches", async () => {
  const previous = {
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_REF: process.env.GITHUB_REF,
    GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
  };
  try {
    process.env.GITHUB_REPOSITORY = "Drummasterflash83/serviceos-dh";
    process.env.GITHUB_REF = "refs/heads/main";
    process.env.GITHUB_ACTIONS = "true";
    let requested = false;
    const result = await checkDailyBackupSuccess({
      token: "synthetic-token",
      now,
      request: async (url) => {
        assert.match(url, /[?&]branch=main(?:&|$)/);
        requested = true;
        return { ok: true, json: async () => ({ workflow_runs: [run(1, { head_branch: "other" })] }) };
      },
    });
    assert.equal(requested, true);
    assert.equal(result.state, "database_daily_success_missing");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
