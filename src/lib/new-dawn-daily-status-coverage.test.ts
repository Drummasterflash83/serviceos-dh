import assert from "node:assert/strict";
import test from "node:test";
import { dailyStatusGapState, readDailyStatusCoverage } from "./new-dawn-daily-status-coverage.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const audit = "33333333-3333-4333-8333-333333333333";
const now = new Date().toISOString();
const receipt = () => ({
  version: "new-dawn-daily-status-coverage/1", tenant_id: tenant,
  actor_id: actor, audit_id: audit, observed_at: now, snapshot_at: now,
  day: "2026-10-20", roster_count: 326, observed_count: 326,
  missing_count: 0, last_provider_check_at: now,
  qualifying_streak_days: 1, streak_start_day: "2026-10-20",
  earliest_moving_review_day: "2026-11-03",
});

test("complete daily roster is a dated coverage receipt, not a score", () => {
  const checked = readDailyStatusCoverage(receipt(), tenant, actor);
  assert.equal(checked.observedCount, 326);
  assert.equal(checked.qualifyingStreakDays, 1);
  assert.equal(checked.earliestMovingReviewDay, "2026-11-03");
  assert.equal("score" in checked, false);
});

test("99 percent allows logged gaps without claiming individual jobs are complete", () => {
  const checked = readDailyStatusCoverage({ ...receipt(), observed_count: 323,
    missing_count: 3 }, tenant, actor);
  assert.equal(checked.missingCount, 3);
  assert.throws(() => readDailyStatusCoverage({ ...receipt(), observed_count: 322,
    missing_count: 4 }, tenant, actor));
});

test("cross-tenant, stale, inconsistent, and invented dates fail closed", () => {
  assert.throws(() => readDailyStatusCoverage(receipt(), actor, actor));
  assert.throws(() => readDailyStatusCoverage({ ...receipt(), actor_id: tenant }, tenant, actor));
  assert.throws(() => readDailyStatusCoverage({ ...receipt(), observed_at:
    new Date(Date.now() - 600_000).toISOString() }, tenant, actor));
  assert.throws(() => readDailyStatusCoverage({ ...receipt(), missing_count: 1 }, tenant, actor));
  assert.throws(() => readDailyStatusCoverage({ ...receipt(), day: "2026-02-30" }, tenant, actor));
  assert.throws(() => readDailyStatusCoverage({ ...receipt(), day: "2099-01-01" }, tenant, actor));
  assert.throws(() => readDailyStatusCoverage({ ...receipt(),
    earliest_moving_review_day: "2026-11-02" }, tenant, actor));
});

test("absence of a roster stays explicit", () => {
  const empty = { ...receipt(), day: null, roster_count: null,
    observed_count: null, missing_count: null, last_provider_check_at: null,
    qualifying_streak_days: 0, streak_start_day: null,
    earliest_moving_review_day: null };
  assert.equal(readDailyStatusCoverage(empty, tenant, actor).day, null);
  assert.throws(() => readDailyStatusCoverage({ ...empty, roster_count: 0 }, tenant, actor));
});

test("a UK-day sweep in progress is not labelled as a completed-day gap", () => {
  const running = readDailyStatusCoverage({ ...receipt(), day: "2026-10-21",
    observed_count: 77, roster_count: 330, missing_count: 253,
    qualifying_streak_days: 0, streak_start_day: null,
    earliest_moving_review_day: null }, tenant, actor);
  assert.equal(dailyStatusGapState(running, new Date("2026-10-21T00:19:00Z")), "pending_today");
  assert.equal(dailyStatusGapState(running, new Date("2026-10-21T23:19:00Z")), "past_gap");
  assert.equal(dailyStatusGapState({ ...running, missingCount: 0 }, new Date("2026-10-21T00:19:00Z")), "none");
  assert.equal(dailyStatusGapState(null), "none");
});

test("today's partial sweep preserves only yesterday's completed streak", () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString().slice(0, 10);
  const review = new Date(Date.parse(`${yesterday}T00:00:00Z`) + 14 * 86_400_000)
    .toISOString().slice(0, 10);
  const running = { ...receipt(), day: today, roster_count: 330,
    observed_count: 119, missing_count: 211,
    qualifying_streak_days: 1, streak_start_day: yesterday,
    earliest_moving_review_day: review };
  const checked = readDailyStatusCoverage(running, tenant, actor);
  assert.equal(checked.qualifyingStreakDays, 1);
  assert.equal(checked.earliestMovingReviewDay, review);
  assert.equal(dailyStatusGapState(checked), "pending_today");
  assert.throws(() => readDailyStatusCoverage({ ...running,
    qualifying_streak_days: 2 }, tenant, actor));
  assert.throws(() => readDailyStatusCoverage({ ...running,
    day: yesterday }, tenant, actor));
  assert.throws(() => readDailyStatusCoverage({ ...running,
    observed_count: 327, missing_count: 3 }, tenant, actor));
});
