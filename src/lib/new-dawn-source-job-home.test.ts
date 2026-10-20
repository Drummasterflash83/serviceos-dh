import assert from "node:assert/strict";
import test from "node:test";
import { filterSourceHomeJobs, groupSourceHomeJobs, readSourceHomePage, scopedOperatorSourcePage, sourceHomeFlagName, sourceJobAsHomeJob, sourceJobClientAttention, sourceJobLabel, sourceJobReviewCue } from "./new-dawn-source-job-home.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const actor = "00000000-0000-0000-0000-000000000002";
const job = "00000000-0000-0000-0000-000000000003";
const audit = "00000000-0000-0000-0000-000000000004";
const row = {
  id: job,
  fields: {
    address: "Site", customer: "Customer", job_number: "001", postcode: null,
    status: "pending", title: "Repair", updated_at: "2026-10-16T07:57:49Z", verified: true,
  },
  source_observed_at: "2026-10-19T08:00:00Z",
  source_state: "source_changed" as const,
};
const envelope = () => ({
  version: "new-dawn-source-job-home/1", tenant_id: tenant, actor_id: actor,
  audit_id: audit, observed_at: new Date().toISOString(), reviewed_job_count: 42,
  rows: [row],
});

test("reads a bounded, audited tenant page without treating capture as current provider state", () => {
  const page = readSourceHomePage(envelope(), tenant, actor);
  assert.equal(page.tenantId, tenant);
  assert.equal(page.actorId, actor);
  assert.equal(page.auditId, audit);
  assert.ok(Number.isFinite(Date.parse(page.observedAt)));
  assert.equal(page.reviewedJobCount, 42);
  assert.equal(page.jobs[0].fields.job_number, "001");
  assert.equal(sourceJobLabel(page.jobs[0]), "Source changed since this card was reviewed");
  assert.deepEqual(sourceJobAsHomeJob(page.jobs[0], tenant), {
    id: job, tenant_id: tenant, job_number: "001", title: "Repair", status: "pending",
    verified: true, updated_at: "2026-10-16T07:57:49Z", customer: "Customer", site: "Site",
  });
});

test("rejects wrong tenant, actor, duplicates, excess rows and invented source states", () => {
  assert.throws(() => readSourceHomePage(envelope(), actor, actor));
  assert.throws(() => readSourceHomePage(envelope(), tenant, tenant));
  assert.throws(() => readSourceHomePage({ ...envelope(), rows: [row, row] }, tenant, actor));
  assert.throws(() => readSourceHomePage({ ...envelope(), rows: Array(25).fill(row) }, tenant, actor));
  assert.throws(() => readSourceHomePage({ ...envelope(), rows: [{ ...row, source_state: "live" }] }, tenant, actor));
  assert.throws(() => readSourceHomePage({ ...envelope(), reviewed_job_count: 0 }, tenant, actor));
});

test("MD preview keeps a previously audited page bound to its client and OpenFolk actor", () => {
  const page = readSourceHomePage(envelope(), tenant, actor);
  assert.equal(scopedOperatorSourcePage(page, tenant, actor), page);
  assert.equal(scopedOperatorSourcePage(page, actor, actor), null);
  assert.equal(scopedOperatorSourcePage(page, tenant, tenant), null);
  assert.equal(scopedOperatorSourcePage(page, tenant, undefined), null);
});

test("operator preview and ordinary client use separate release flags", () => {
  assert.equal(sourceHomeFlagName(true), "new_dawn.source_job_home.operator_preview");
  assert.equal(sourceHomeFlagName(false), "new_dawn.source_job_home");
});

test("source review cues distinguish changed links, older captures and recent saved evidence", () => {
  const now = Date.parse("2026-10-19T09:00:00Z");
  const current = { ...row, source_state: "reviewed_latest" as const };
  assert.equal(sourceJobReviewCue(row, now).kind, "link_review");
  assert.equal(sourceJobReviewCue({ ...current, source_observed_at: "2026-10-18T08:59:59Z" }, now).kind, "aged_observation");
  assert.equal(sourceJobReviewCue({ ...current, source_observed_at: "2026-10-19T08:00:00Z" }, now).kind, "recent_observation");
  assert.equal(sourceJobReviewCue({ ...current, source_observed_at: "2026-10-19T09:02:00Z" }, now).kind, "aged_observation");
  assert.match(sourceJobReviewCue(current, now).label, /progress unverified/);
});

test("client attention names the next check without exposing operator source-link language", () => {
  const now = Date.parse("2026-10-19T09:00:00Z");
  const current = { ...row, source_state: "reviewed_latest" as const };
  const changed = sourceJobClientAttention(row, now);
  assert.equal(changed.label, "Job details need checking");
  assert.match(changed.nextStep, /Ask OpenFolk to confirm this job record/);
  assert.deepEqual(sourceJobClientAttention({ ...row, source_state: "source_ambiguous" }, now), changed);
  const older = sourceJobClientAttention({ ...current, source_observed_at: "2026-10-18T08:59:59Z" }, now);
  assert.equal(older.label, "Current progress needs checking");
  assert.match(older.nextStep, /Confirm current progress/);
  const recent = sourceJobClientAttention(current, now);
  assert.equal(recent.label, "Recorded progress needs confirming");
  assert.equal(recent.nextStep, "Check what is holding this job");
});

test("owner presentation keeps old and changed records out of the recent-work section", () => {
  const now = Date.parse("2026-10-19T09:00:00Z");
  const current = { ...row, source_state: "reviewed_latest" as const };
  const recent = { ...current, source_observed_at: "2026-10-19T08:00:00Z" };
  const old = { ...current, source_observed_at: "2026-10-18T08:59:59Z" };
  const groups = groupSourceHomeJobs([row, old, recent], now);
  assert.deepEqual(groups.recentlySaved, [recent]);
  assert.deepEqual(groups.needsOpenFolkCheck, [row, old]);
});

test("owner job search stays inside the audited selection and preserves leading-zero job codes", () => {
  const other = { ...row, id: "00000000-0000-0000-0000-000000000005", fields: {
    ...row.fields, job_number: "008", customer: "Another customer", address: "Other site",
  } };
  assert.deepEqual(filterSourceHomeJobs([row, other], " 001 "), [row]);
  assert.deepEqual(filterSourceHomeJobs([row, other], "another CUSTOMER"), [other]);
  assert.deepEqual(filterSourceHomeJobs([row, other], "missing"), []);
  assert.deepEqual(filterSourceHomeJobs([row, other], ""), [row, other]);
  const sameCodeDifferentJob = { ...other, fields: { ...other.fields, job_number: "001" } };
  assert.deepEqual(filterSourceHomeJobs([row, sameCodeDifferentJob], "001").map((match) => match.id),
    [row.id, sameCodeDifferentJob.id]);
});
