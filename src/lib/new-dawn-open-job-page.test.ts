import assert from "node:assert/strict";
import test from "node:test";
import { openJobNextStep, openJobPageFlagName, openJobStatusEvidence, readOpenJobPage, readOpenJobStatusSummary } from "./new-dawn-open-job-page.ts";
import type { OpenJobRow } from "./new-dawn-open-job-page.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const connection = "33333333-3333-4333-8333-333333333333";
const version = "44444444-4444-4444-8444-444444444444";
const audit = "55555555-5555-4555-8555-555555555555";
const now = new Date().toISOString();
const row: OpenJobRow = {
  connection_id: connection, external_id: "13001", source_version_id: version,
  source_observed_at: now, status_first_saved_at: now,
  status_evidence: "timing_unknown", status: "on_hold", title: "Boiler repair",
  source_customer: "Example customer", source_site: "1 Example Road",
  source_postcode: "AB1 2CD", property_external_id: "789",
  customer_external_id: "123", context_state: "source_customer_and_property",
  identity_state: "awaiting_review",
};
const page = () => ({
  version: "new-dawn-open-job-page/2", tenant_id: tenant, actor_id: actor,
  audit_id: audit, observed_at: now, snapshot_at: now,
  status_filter: null, rows: [row], next_cursor: "Y3Vyc29y", has_more: true,
});

test("full source page validates tenant, actor, status, audit and paging", () => {
  const parsed = readOpenJobPage(page(), tenant, actor, null);
  assert.equal(parsed.rows[0].external_id, "13001");
  assert.equal(parsed.nextCursor, "Y3Vyc29y");
  assert.throws(() => readOpenJobPage(page(), actor, actor, null));
  assert.throws(() => readOpenJobPage(page(), tenant, tenant, null));
  assert.throws(() => readOpenJobPage(page(), tenant, actor, "pending"));
  assert.throws(() => readOpenJobPage({ ...page(), next_cursor: null }, tenant, actor, null));
});

test("source-only row is retained with explicit identity review; private payload extras fail closed", () => {
  assert.equal(readOpenJobPage(page(), tenant, actor, null).rows[0].identity_state, "awaiting_review");
  assert.throws(() => readOpenJobPage({ ...page(), rows: [{ ...row, raw_payload: { email: "private" } }] }, tenant, actor, null));
  assert.throws(() => readOpenJobPage({ ...page(), rows: [row, row] }, tenant, actor, null));
  assert.throws(() => readOpenJobPage({ ...page(), rows: [{ ...row, status: "closed" }] }, tenant, actor, null));
});

test("operator and client flags remain distinct; actions do not imply assignment", () => {
  assert.equal(openJobPageFlagName(true), "new_dawn.open_job_page.operator_preview");
  assert.equal(openJobPageFlagName(false), "new_dawn.open_job_page");
  assert.match(openJobNextStep("open"), /Confirm/);
  assert.match(openJobNextStep("on_hold"), /Check/);
});

test("status age is shown only for repeated saved checks spanning a day", () => {
  const format = (value: string) => value.slice(0, 10);
  assert.match(openJobStatusEvidence(row, format), /timing unknown/i);
  const repeat = { ...row, status_first_saved_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    status_evidence: "repeat_saved_checks" } as const;
  assert.match(openJobStatusEvidence(repeat, format), /saved checks since at least/);
  assert.equal(readOpenJobPage({ ...page(), rows: [repeat] }, tenant, actor, null).rows[0].status_evidence,
    "repeat_saved_checks");
  assert.throws(() => readOpenJobPage({ ...page(), rows: [{ ...row,
    status_evidence: "repeat_saved_checks" }] }, tenant, actor, null));
  assert.throws(() => readOpenJobPage({ ...page(), rows: [{ ...row,
    status_first_saved_at: new Date(Date.now() + 100_000).toISOString() }] }, tenant, actor, null));
});

test("whole-workload counts require fresh, audited and internally consistent scope", () => {
  const summary = {
    version: "new-dawn-open-job-status-summary/1", tenant_id: tenant,
    actor_id: actor, audit_id: audit, observed_at: now, snapshot_at: now,
    counts: { on_hold: 3, pending: 2, open: 4, total: 9 },
  };
  assert.equal(readOpenJobStatusSummary(summary, tenant, actor).counts.total, 9);
  assert.throws(() => readOpenJobStatusSummary(summary, actor, actor));
  assert.throws(() => readOpenJobStatusSummary(summary, tenant, tenant));
  assert.throws(() => readOpenJobStatusSummary({ ...summary, counts: { ...summary.counts, total: 8 } }, tenant, actor));
  assert.throws(() => readOpenJobStatusSummary({ ...summary, counts: { ...summary.counts, private: 1 } }, tenant, actor));
});
