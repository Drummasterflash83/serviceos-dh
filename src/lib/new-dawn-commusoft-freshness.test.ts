import { test } from "node:test";
import assert from "node:assert/strict";
import { readCommusoftFreshness } from "./new-dawn-commusoft-freshness.ts";

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
});

test("rejects stale, partial and cross-tenant results that claim exact counts", () => {
  assert.throws(() => readCommusoftFreshness(result(), actor, actor));
  for (const state of ["stale", "partial", "saved_advanced", "collecting"]) {
    assert.throws(() => readCommusoftFreshness({ ...result(), state }, tenant, actor));
  }
});
