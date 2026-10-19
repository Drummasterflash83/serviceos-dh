import assert from "node:assert/strict";
import test from "node:test";
import { assessDailyRedundancy, checkDailyBackupRedundancy } from "./check-daily-backup-redundancy.mjs";

const now = Date.parse("2026-10-16T04:16:00Z");
const run = (extra = {}) => ({ id: 100, name: "ServiceOS independent database backup",
  event: "schedule", head_branch: "main", status: "completed",
  conclusion: "success", created_at: "2026-10-16T03:16:00Z",
  updated_at: "2026-10-16T03:30:00Z", ...extra });

test("second scheduled slot skips only after a completed scheduled copy that day", () => {
  assert.deepEqual(assessDailyRedundancy([run()], { now, currentRunId: 101 }),
    { skip: true, state: "earlier_scheduled_copy_succeeded_today" });
  for (const prior of [run({ event: "workflow_dispatch" }),
    run({ conclusion: "failure" }), run({ status: "in_progress", conclusion: null }),
    run({ created_at: "2026-10-15T03:16:00Z", updated_at: "2026-10-15T03:30:00Z" }),
    run({ id: 101 }), run({ head_branch: "codex/learn-v1-test" })]) {
    assert.deepEqual(assessDailyRedundancy([prior], { now, currentRunId: 101 }),
      { skip: false, state: "scheduled_copy_required" });
  }
});

test("manual rescue always runs and malformed run metadata cannot skip", () => {
  assert.deepEqual(assessDailyRedundancy([run()], { now, currentRunId: 101,
    event: "workflow_dispatch" }), { skip: false, state: "manual_copy_requested" });
  assert.deepEqual(assessDailyRedundancy([run({ updated_at: "invalid" })],
    { now, currentRunId: 101 }), { skip: false, state: "scheduled_copy_required" });
  assert.deepEqual(assessDailyRedundancy(null, { now, currentRunId: 101 }),
    { skip: false, state: "redundancy_guard_unconfirmed" });
});

test("unavailable GitHub read fails open to another backup", async () => {
  const saved = { GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_REF: process.env.GITHUB_REF, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  try {
    process.env.GITHUB_REPOSITORY = "Drummasterflash83/serviceos-dh";
    process.env.GITHUB_REF = "refs/heads/main";
    process.env.GITHUB_ACTIONS = "true";
    const result = await checkDailyBackupRedundancy({ token: "synthetic", now,
      event: "schedule", currentRunId: 101,
      request: async () => ({ ok: false }) });
    assert.deepEqual(result, { skip: false, state: "redundancy_guard_unconfirmed" });
    const confirmed = await checkDailyBackupRedundancy({ token: "synthetic", now,
      event: "schedule", currentRunId: 101,
      request: async (url, options) => {
        assert.match(url, /event=schedule/);
        assert.equal(options.redirect, "error");
        return { ok: true, json: async () => ({ workflow_runs: [run()] }) };
      } });
    assert.deepEqual(confirmed,
      { skip: true, state: "earlier_scheduled_copy_succeeded_today" });
    const manual = await checkDailyBackupRedundancy({ token: "", now,
      event: "workflow_dispatch", currentRunId: 101,
      request: async () => { throw Error("manual copy should not query runs"); } });
    assert.deepEqual(manual, { skip: false, state: "manual_copy_requested" });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
