import test from "node:test";
import assert from "node:assert/strict";
import { schedulerOutcome, schedulerStatusLabels } from "./scheduler-outcome.ts";

const now = Date.parse("2026-10-11T14:00:00Z");
const row = { started_at: new Date(now - 1000).toISOString(), status: "success" };
const result = (value: Record<string, unknown> | null) =>
  schedulerOutcome(value, "started_at", 300, now).status;
test("fresh failed work never looks healthy; a later confirmed success clears it", () => {
  for (const status of ["failed", "dead_letter", "retrying"])
    assert.equal(result({ ...row, status }), "failed");
  assert.equal(result({ ...row, enqueue_unconfirmed: 1 }), "failed");
  assert.equal(result({ ...row, inventory_unavailable: true }), "failed");
  assert.equal(result(row), "healthy");
  assert.equal(schedulerStatusLabels.failed, "Needs attention");
});
test("paused, stale, absent and invalid observations remain distinct", () => {
  assert.equal(result({ ...row, capture_paused: 1 }), "paused");
  assert.equal(
    result({ ...row, capture_paused: 1, started_at: new Date(now - 1_201_000).toISOString() }),
    "stale",
  );
  assert.equal(result(null), "never");
  for (const started_at of [null, "invalid", new Date(now + 61_000).toISOString()])
    assert.equal(result({ ...row, started_at }), "unknown");
  assert.equal(result({ ...row, status: "something-new" }), "unknown");
});
test("fresh queued or running jobs mean scheduling observed, never completed capture", () => {
  for (const status of ["queued", "running", "succeeded"])
    assert.equal(result({ ...row, status }), "healthy");
  assert.equal(schedulerStatusLabels.healthy, "On schedule");
});
