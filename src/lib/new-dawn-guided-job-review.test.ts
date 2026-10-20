import test from "node:test";
import assert from "node:assert/strict";
import { exactSiteWasLinked, planGuidedJobReview } from "./new-dawn-guided-job-review.ts";
import type { SourceJob } from "./learn-commusoft-source-jobs.ts";
import type { RecentUnlinkedJob } from "./new-dawn-recent-unlinked-jobs.ts";
import type { WorkDraft, WorkReceipt, WorkSource } from "./learn-commusoft-work.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const recent: RecentUnlinkedJob = {
  external_id: "13002", version_id: id(1), source_observed_at: "2026-10-20T00:10:05Z",
  source_status: "Open", relationship_state: "site_customer_source_retained",
  customer_identity_state: "unreviewed",
};
const source: SourceJob = {
  external_id: "13002", version_id: id(1), observed_at: recent.source_observed_at,
  title: "Recorded service job", source_status: "Open", business_unit: null,
  property_reference: "877", customer_reference: "521", company_name: null,
  contact_name: null, relationship_state: recent.relationship_state,
  customer_identity_state: "unreviewed", reviewed_job_id: null,
};

test("recent source routes through exact customer, site and job without choosing an identity", () => {
  assert.deepEqual(planGuidedJobReview(id(2), recent, source), {
    connection: id(2), job: "13002", jobVersion: id(1), customer: "521", site: "877",
  });
  assert.deepEqual(planGuidedJobReview(id(2),
    { ...recent, relationship_state: "customer_source_retained" },
    { ...source, relationship_state: "customer_source_retained", property_reference: "521" }), {
      connection: id(2), job: "13002", jobVersion: id(1), customer: "521", site: null,
    });
});

test("changed or incomplete saved source stops the guided review", () => {
  for (const altered of [
    { ...source, external_id: "13003" }, { ...source, version_id: id(9) },
    { ...source, relationship_state: "customer_source_retained" as const },
    { ...source, customer_reference: null }, { ...source, property_reference: null },
    { ...source, reviewed_job_id: id(8) },
  ]) assert.throws(() => planGuidedJobReview(id(2), recent, altered));
});

test("only an exact single linked site receipt advances to job review", () => {
  const site = { connection: id(2), external: "877" };
  const workSource: WorkSource = {
    external_id: "877", version_id: id(3), title: "Recorded site", property_reference: "877",
    customer_name: "Reviewed customer", relationship_reason: null, source_status: null,
    linked_version_id: null, last_result: null, selectable: true,
  };
  const draft: WorkDraft = {
    version: 1, scope: { backend: "https://example.invalid", tenantId: id(4), actorId: id(5) },
    id: id(6), connection: id(2), kind: "site", items: [{ version_id: id(3), target_id: null }],
    reason: "Checked the exact retained site and customer relationship",
  };
  const receipt: WorkReceipt = {
    batch_id: id(6), tenant_id: id(4), actor_id: id(5), connection_id: id(2),
    kind: "site", state: "recorded", linked: 1, held: 0,
    items: [{ version_id: id(3), outcome: { state: "linked", entity_id: id(7),
      entity_kind: "site", link_id: id(8), already: false } }],
  };
  assert.equal(exactSiteWasLinked(site, workSource, draft, receipt), true);
  assert.equal(exactSiteWasLinked(site, workSource, { ...draft, items: [{ version_id: id(9), target_id: null }] }, receipt), false);
  assert.equal(exactSiteWasLinked(site, workSource, draft, { ...receipt, linked: 0, held: 1 }), false);
  assert.equal(exactSiteWasLinked(site, workSource, draft, { ...receipt, kind: "job" }), false);
  assert.equal(exactSiteWasLinked(site, { ...workSource, version_id: id(9) }, draft, receipt), false);
});
