import test from "node:test";
import assert from "node:assert/strict";
import { assessLastSuccess, checkDailyBackupSuccess } from "./check-daily-backup-success.mjs";

const now = Date.parse("2026-10-16T12:00:00Z");
const run = (hours, overrides = {}) => ({
  event: "schedule", status: "completed", conclusion: "success",
  name: "ServiceOS independent database backup", head_branch: "main",
  created_at: new Date(now - hours * 3_600_000 - 60_000).toISOString(),
  updated_at: new Date(now - hours * 3_600_000).toISOString(),
  ...overrides,
});

test("scheduled success age excludes manual rescue and wrong-branch runs", () => {
  assert.equal(assessLastSuccess([run(26)], now).state, "database_daily_scheduled_success_current");
  assert.equal(assessLastSuccess([run(26.01)], now).state,
    "database_daily_scheduled_success_overdue");
  assert.equal(assessLastSuccess([run(30), run(2)], now).lastSuccessAt, run(2).updated_at);
  assert.equal(assessLastSuccess([], now).state, "database_daily_scheduled_success_missing");
  assert.equal(assessLastSuccess([run(1, { head_branch: "untrusted" })], now).state,
    "database_daily_scheduled_success_missing");
  assert.equal(assessLastSuccess([run(1, { event: "workflow_dispatch" })], now).state,
    "database_daily_scheduled_success_missing");
});

test("first scheduled run has a bounded bootstrap grace, without claiming success", () => {
  const due = Date.parse("2026-10-16T03:15:00Z");
  assert.equal(assessLastSuccess([run(1, { event: "workflow_dispatch" })], due).state,
    "database_first_scheduled_run_pending");
  assert.equal(assessLastSuccess([], due + 2 * 3_600_000).state,
    "database_first_scheduled_run_pending");
  assert.equal(assessLastSuccess([], due + 2 * 3_600_000 + 1).state,
    "database_daily_scheduled_success_missing");
});

test("latest scheduled failure and in-progress run cannot masquerade as success", () => {
  const yesterday = run(24);
  assert.equal(assessLastSuccess([run(1, { conclusion: "failure" })], now).state,
    "database_daily_scheduled_run_failed");
  assert.equal(assessLastSuccess([yesterday, run(1, { conclusion: "failure" })], now).state,
    "database_daily_scheduled_run_failed");
  assert.equal(assessLastSuccess([run(1, { status: "in_progress", conclusion: null })], now).state,
    "database_daily_scheduled_run_in_progress");
  assert.equal(assessLastSuccess([run(6, { status: "in_progress", conclusion: null })], now).state,
    "database_daily_scheduled_run_overdue");
});

test("hosted check includes all outcomes and rejects other branches", async () => {
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
        assert.doesNotMatch(url, /[?&]status=success(?:&|$)/);
        requested = true;
        return { ok: true, json: async () => ({ workflow_runs: [run(1, { head_branch: "other" })] }) };
      },
    });
    assert.equal(requested, true);
    assert.equal(result.state, "database_daily_scheduled_success_missing");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
