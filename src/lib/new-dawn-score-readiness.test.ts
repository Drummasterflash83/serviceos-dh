import assert from "node:assert/strict";
import test from "node:test";
import { canShowScoreReadiness, summarizeScoreReadiness } from "./new-dawn-score-readiness.ts";
import type { SourceHomePage, SourceHomeJob } from "./new-dawn-source-job-home.ts";

const now = Date.parse("2026-10-20T12:00:00Z");
const job = (state: SourceHomeJob["source_state"], observed: string, customer: string | null): SourceHomeJob => ({
  id: "00000000-0000-0000-0000-000000000001",
  source_state: state,
  source_observed_at: observed,
  fields: { address: null, customer, job_number: "001", postcode: null,
    status: "open", title: "Saved job", updated_at: observed, verified: true },
});
const page = (jobs: SourceHomeJob[]): SourceHomePage => ({
  tenantId: "00000000-0000-0000-0000-000000000002",
  actorId: "00000000-0000-0000-0000-000000000003",
  auditId: "00000000-0000-0000-0000-000000000004",
  observedAt: "2026-10-20T12:00:00Z",
  reviewedJobCount: 1005,
  jobs,
});

test("readiness counts only the bounded audited selection, not all reviewed jobs", () => {
  const result = summarizeScoreReadiness(page([
    job("reviewed_latest", "2026-10-20T11:00:00Z", "Customer A"),
    job("reviewed_latest", "2026-10-13T11:00:00Z", "Customer B"),
    job("source_changed", "2026-10-20T11:00:00Z", null),
  ]), now);
  assert.deepEqual(result, {
    selected: 3, reviewedLinked: 1005, recent: 1, aged: 1, linkReview: 1,
    namedCustomerRows: 2, readAt: "2026-10-20T12:00:00Z",
  });
  assert.equal("score" in result, false);
  assert.equal("team" in result, false);
});

test("future observations and an empty selection never look recently captured", () => {
  assert.equal(summarizeScoreReadiness(page([
    job("reviewed_latest", "2026-10-21T11:00:00Z", "Customer A"),
  ]), now).aged, 1);
  assert.deepEqual(summarizeScoreReadiness(page([]), now), {
    selected: 0, reviewedLinked: 1005, recent: 0, aged: 0, linkReview: 0,
    namedCustomerRows: 0, readAt: "2026-10-20T12:00:00Z",
  });
});

test("readiness stays operator-only, flag-gated and bound to the audited tenant and actor", () => {
  const audited = page([]);
  assert.equal(canShowScoreReadiness(true, audited.tenantId, audited.actorId, audited, true), true);
  assert.equal(canShowScoreReadiness(false, audited.tenantId, audited.actorId, audited, true), false);
  assert.equal(canShowScoreReadiness(true, audited.tenantId, audited.actorId, audited, false), false);
  assert.equal(canShowScoreReadiness(true, audited.actorId, audited.actorId, audited, true), false);
  assert.equal(canShowScoreReadiness(true, audited.tenantId, audited.tenantId, audited, true), false);
  assert.equal(canShowScoreReadiness(true, audited.tenantId, audited.actorId, null, true), false);
});
