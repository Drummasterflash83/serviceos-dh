import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyStatKeys, readDailyStats } from "./new-dawn-learn-daily-stats.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const actor = "00000000-0000-0000-0000-000000000002";
const response = () => ({
  version: "new-dawn-learn-daily-stats/1", tenant_id: tenant, actor_id: actor,
  observed_at: "2026-10-20T10:00:00Z", day_start: "2026-10-19T23:00:00Z",
  timezone: "Europe/London", scope: "retained_saved_rows",
  counts: Object.fromEntries(dailyStatKeys.map(key => [key, { today: 2, total: 20 }])),
  latest_saved_job: { number: "001", saved_at: "2026-10-20T09:00:00Z" },
  provider_newest_job: null, provider_newest_state: "not_checked",
  audit_id: "00000000-0000-0000-0000-000000000003",
});

test("preserves string job numbers and distinguishes saved from provider state", () => {
  const value = readDailyStats(response(), tenant, actor);
  assert.equal(value.latestSavedJob?.number, "001");
  assert.deepEqual(value.counts.jobs, { today: 2, total: 20 });
});

test("rejects cross-tenant/actor, impossible totals and claimed provider freshness", () => {
  assert.throws(() => readDailyStats(response(), "00000000-0000-0000-0000-000000000004", actor));
  assert.throws(() => readDailyStats(response(), tenant, "00000000-0000-0000-0000-000000000004"));
  const malformed = response();
  malformed.counts.jobs.today = 21;
  assert.throws(() => readDailyStats(malformed, tenant, actor));
  const claim = response();
  (claim as Record<string, unknown>).provider_newest_job = "999";
  assert.throws(() => readDailyStats(claim, tenant, actor));
});
