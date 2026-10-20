import { test } from "node:test";
import assert from "node:assert/strict";
import { commusoftFreshnessSummary, readCommusoftFreshness } from "./new-dawn-commusoft-freshness.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const actor = "00000000-0000-0000-0000-000000000002";
const result = () => ({
  version: "new-dawn-commusoft-freshness/1", tenant_id: tenant, actor_id: actor,
  observed_at: "2026-10-20T10:00:00Z", state: "complete",
  saved_job_id: "13435", provider_newest_job_id: "13437",
  provider_checked_at: "2026-10-20T09:59:00Z", jobs_behind: 1,
  at_least_behind: null, scope: "provider_jobs_created_descending",
});

test("accepts a provider-counted gap without subtracting IDs", () => {
  const value = readCommusoftFreshness(result(), tenant, actor);
  assert.equal(value.jobsBehind, 1);
  assert.equal(value.providerNewestJobId, "13437");
  assert.equal(commusoftFreshnessSummary(value),
    "1 job behind at last check · newest Commusoft job 13437");
});

test("only a complete, matching newest-job check says up to date", () => {
  const matched = readCommusoftFreshness({ ...result(), saved_job_id: "13437", jobs_behind: 0 }, tenant, actor);
  assert.equal(commusoftFreshnessSummary(matched), "Up to date to job 13437 at last check");
  assert.equal(commusoftFreshnessSummary({ ...matched, state: "saved_advanced" }),
    "Saved jobs changed since the last provider check; comparison pending");
  assert.equal(commusoftFreshnessSummary({ ...matched, state: "stale" }),
    "No current-day provider comparison");
});

test("rejects stale, partial and cross-tenant results that claim exact counts", () => {
  assert.throws(() => readCommusoftFreshness(result(), actor, actor));
  for (const state of ["stale", "partial", "saved_advanced", "collecting"]) {
    assert.throws(() => readCommusoftFreshness({ ...result(), state }, tenant, actor));
  }
});
