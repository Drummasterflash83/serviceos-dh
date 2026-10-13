import test from "node:test";
import assert from "node:assert/strict";
import { customerJobBrief, visibleCustomerJobBrief } from "./learn-card-job-brief.ts";
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
test("closed, cancelled, unknown and unverified work never become completed jobs", () => {
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
  assert.equal(result.completed, 0);
  assert.equal(result.closed, 1);
  assert.equal(result.unconfirmed, 3);
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
