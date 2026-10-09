import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadPerformanceReviews,
  reviewPerformanceMeasurement,
  type ReviewRequest,
} from "./learn-performance-reviews.ts";
import { loadPerformanceEvidence } from "./learn-performance-evidence.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = {
  id: id(1),
  tenant_id: id(2),
  measurement_id: id(3),
  revision: 1,
  decision: "confirmed",
  reviewed_by: id(4),
  reason: "Checked source",
  created_at: "2026-01-05T00:00:00Z",
};
function db(data: any[], count: number | null = data.length, error: any = null) {
  const filters: any[] = [];
  let columns = "";
  const q: any = {
    select: (s: string) => {
      columns = s;
      return q;
    },
    eq: (...a: any[]) => {
      filters.push(a);
      return q;
    },
    in: (...a: any[]) => {
      filters.push(a);
      return q;
    },
    order: () => q,
    limit: () => q,
    then: (f: any) => Promise.resolve({ data, count, error }).then(f),
  };
  return { from: () => q, filters, columns: () => columns };
}
test("review history is tenant-scoped, complete, contiguous and keeps reversals", async () => {
  const c = db([
    row,
    { ...row, id: id(5), revision: 2, decision: "disputed", reason: "Coverage questioned" },
  ]);
  const result = await loadPerformanceReviews(c, id(2), [id(3)]);
  assert.equal(result.get(id(3))?.at(-1)?.decision, "disputed");
  assert.ok(c.filters.some(([k, v]) => k === "tenant_id" && v === id(2)));
  for (const client of [
    db([row], null),
    db([row], 2),
    db([row], 1001),
    db([{ ...row, tenant_id: id(99) }]),
    db([{ ...row, measurement_id: id(99) }]),
    db([{ ...row, revision: 2 }]),
    db([row, row]),
    db([{ ...row, reviewed_by: "unknown" }]),
    db([], 0, { code: "denied" }),
  ])
    await assert.rejects(loadPerformanceReviews(client, id(2), [id(3)]));
});
test("review writes retain request identity and compare revision/decision receipts", async () => {
  const request: ReviewRequest = {
    tenantId: id(2),
    measurementId: id(3),
    requestId: id(7),
    expectedRevision: 1,
    decision: "disputed",
    reason: "Coverage questioned",
  };
  const calls: any[] = [];
  const good = {
    reviewId: id(7),
    measurementId: id(3),
    revision: 2,
    decision: "disputed",
    reused: false,
  };
  const client = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_performance_review");
      calls.push(args);
      return { data: good, error: null };
    },
  };
  await reviewPerformanceMeasurement(client, request);
  await reviewPerformanceMeasurement(client, request);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].p_expected_revision, 1);
  for (const changed of [
    { reviewId: id(99) },
    { measurementId: id(99) },
    { revision: 1 },
    { decision: "confirmed" },
    { reused: null },
  ])
    await assert.rejects(
      reviewPerformanceMeasurement(
        { rpc: async () => ({ data: { ...good, ...changed }, error: null }) },
        request,
      ),
      /verified/,
    );
  await assert.rejects(
    reviewPerformanceMeasurement(
      { rpc: async () => ({ data: null, error: { code: "40001" } }) },
      request,
    ),
    /Reload/,
  );
  await assert.rejects(reviewPerformanceMeasurement(client, { ...request, reason: "" }));
  assert.equal(calls.length, 2);
});
test("evidence reads only allowed fields for the selected tenant and source", async () => {
  const c = db([{ id: id(3), tenant_id: id(2), subject: "A subject", snippet: "Source excerpt" }]);
  const result = await loadPerformanceEvidence(c, id(2), { table: "email_messages", id: id(3) });
  assert.equal(result[1].value, "Source excerpt");
  assert.ok(c.filters.some(([k, v]) => k === "tenant_id" && v === id(2)));
  assert.ok(!c.columns().includes("body_html") && !c.columns().includes("raw_payload"));
  await assert.rejects(loadPerformanceEvidence(c, id(2), { table: "profiles", id: id(3) }));
  await assert.rejects(
    loadPerformanceEvidence(db([{ id: id(3), tenant_id: id(99) }]), id(2), {
      table: "email_messages",
      id: id(3),
    }),
  );
  await assert.rejects(
    loadPerformanceEvidence(db([]), id(2), { table: "phone_recordings", id: id(3) }),
  );
});
