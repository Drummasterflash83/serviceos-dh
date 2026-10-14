import test from "node:test";
import assert from "node:assert/strict";
import {
  customerJobBrief,
  visibleCustomerJobBrief,
  visibleJobRecordBrief,
} from "./learn-card-job-brief.ts";
import type { BusinessContextPage } from "./learn-customer-business-context.ts";
const observed = "2026-10-14T00:00:00Z";
const page = (
  statuses: Array<[unknown, boolean]>,
  total = statuses.length,
): BusinessContextPage => ({
  collection: "jobs",
  observed_at: observed,
  total,
  next_after: null,
  rows: statuses.map(([status, verified], n) => ({
    id: `job-${n}`,
    fields: {
      status,
      verified,
      title: "016. Historic description",
      job_number: "001",
      completed_date: "2026-10-01",
    },
    truncated_fields: [],
    sources: [],
  })),
});
test("a real completed-job shape supplies the missing summary without requiring a dated completion", () => {
  const p = page([
    ["completed", true],
    ["completed", true],
  ]);
  p.rows[0].fields.completed_date = null;
  const result = customerJobBrief(p);
  assert.equal(result.completed, 2);
  assert.equal(result.limited, false);
  assert.equal(p.rows[0].fields.job_number, "001");
});
test("recorded completion stays distinct from verification; closed and unknown are not completion", () => {
  const p = page([
    ["completed", false],
    ["closed", true],
    ["cancelled", true],
    [null, true],
    ["open", true],
    ["pending", true],
    ["on_hold", true],
  ]);
  const result = customerJobBrief(p);
  assert.equal(result.completed, 1);
  assert.equal(result.verificationPending, 1);
  assert.equal(result.closed, 1);
  assert.equal(result.unconfirmed, 2);
  assert.equal(result.open, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.on_hold, 1);
});
test("a bounded first page is never presented as all jobs or all provider coverage", () => {
  const result = customerJobBrief(page([["completed", true]], 28));
  assert.equal(result.completed, 1);
  assert.equal(result.shown, 1);
  assert.equal(result.total, 28);
  assert.equal(result.limited, true);
  const empty = customerJobBrief(page([]));
  assert.equal(empty.completed, 0);
  assert.throws(() => customerJobBrief({ ...page([]), collection: "sites" }));
});
test("tenant, actor, customer and refresh scope changes hide a previous job summary immediately", () => {
  const scope = "tenant:actor:customer:0";
  const value = { scope, brief: customerJobBrief(page([["completed", true]])) };
  const now = Date.parse(observed);
  assert.equal(visibleCustomerJobBrief(value, scope, now)?.completed, 1);
  for (const other of [
    "other:actor:customer:0",
    "tenant:other:customer:0",
    "tenant:actor:other:0",
    "tenant:actor:customer:1",
  ]) {
    assert.equal(visibleCustomerJobBrief(value, other, now), null);
  }
  assert.equal(visibleCustomerJobBrief(value, scope, now + 60000), null);
  assert.equal(visibleCustomerJobBrief(null, scope, now), null);
  assert.equal(visibleCustomerJobBrief(value, scope, NaN), null);
});

import { projectLearnDetail } from "./learn-cards.ts";
const ownJob = (status: unknown, verified = false) =>
  projectLearnDetail({
    tenant: "11111111-1111-4111-8111-111111111111",
    kind: "job",
    record: {
      id: "22222222-2222-4222-8222-222222222222",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      title: "012. Example job",
      job_number: "001",
      status,
      verified,
      completed_date: null,
    },
    findings: [],
    interactions: [],
    members: [],
    now: Date.parse(observed),
  });
test("own completed job remains completed with no confirmed date or verification", () => {
  const data = ownJob("completed");
  assert.deepEqual(data.jobRecord, { status: "completed", verified: false });
  const brief = visibleJobRecordBrief(data, Date.parse(observed));
  assert.equal(brief?.headline, "Job recorded complete");
  assert.equal(brief?.verification, "Job record awaits verification.");
  assert.equal(data.card.subtitle, "001");
  assert.match(brief!.qualification, /does not establish payment or a completion time/);
});
test("own status preserves open, pending, held and closed without claiming completion", () => {
  for (const [status, label] of [
    ["open", "open"],
    ["pending", "pending"],
    ["on_hold", "on hold"],
    ["closed", "closed"],
  ]) {
    assert.equal(
      visibleJobRecordBrief(ownJob(status, true), Date.parse(observed))?.headline,
      `Job recorded as ${label}`,
    );
  }
  for (const status of [null, "cancelled", "constructor", "COMPLETED", {}, 1]) {
    assert.equal(
      visibleJobRecordBrief(ownJob(status, true), Date.parse(observed))?.headline,
      "Job status needs confirmation",
    );
  }
});
test("expired, malformed and non-job reads never supply an own-job status", () => {
  const data = ownJob("completed");
  const now = Date.parse(observed);
  for (const time of [now + 60000, now - 1, NaN])
    assert.equal(visibleJobRecordBrief(data, time), null);
  assert.equal(visibleJobRecordBrief({ ...data, validUntil: "bad" }, now), null);
  assert.equal(visibleJobRecordBrief({ ...data, observedAt: "bad" }, now), null);
  assert.equal(
    visibleJobRecordBrief({ ...data, card: { ...data.card, kind: "customer" } }, now),
    null,
  );
  assert.equal(visibleJobRecordBrief({ ...data, jobRecord: undefined }, now), null);
});
