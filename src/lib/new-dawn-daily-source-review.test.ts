import assert from "node:assert/strict";
import test from "node:test";
import { dailySourceReview } from "./new-dawn-daily-source-review.ts";
import type { RecentUnlinkedJob } from "./new-dawn-recent-unlinked-jobs.ts";

const row: RecentUnlinkedJob = {
  external_id: "13164",
  version_id: "11111111-1111-1111-1111-111111111111",
  source_observed_at: "2026-10-19T18:33:03Z",
  source_status: "pending",
  relationship_state: "site_customer_source_retained",
  customer_identity_state: "unreviewed",
};

test("unlinked recent jobs keep source relationships and demand human identity review", () => {
  const review = dailySourceReview(row);
  assert.match(review.relationship, /Site and customer source records available/);
  assert.match(review.identity, /not yet classified/);
  assert.match(review.nextAction, /before confirming a job link/);
  assert.doesNotMatch(review.nextAction, /assign|technician|current progress/i);
});

test("reviewed customer still requires exact job-link review, and conflict wins", () => {
  assert.match(
    dailySourceReview({ ...row, customer_identity_state: "reviewed" }).nextAction,
    /Verify the job link/,
  );
  assert.match(
    dailySourceReview({ ...row, version_id: null, customer_identity_state: "reviewed" }).nextAction,
    /conflicting source/,
  );
});
