import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPerformanceMeasurements } from "./learn-performance-measurements.ts";
import { evaluateScorecard, type ScorecardPolicy } from "./learn-scorecards.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const period = { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" };
const subject = { kind: "member", id: id(3) } as const;
const policy: ScorecardPolicy = {
  id: id(2),
  tenantId: id(1),
  version: 1,
  name: "Response",
  status: "draft",
  subjectKind: "member",
  scaleMax: 50,
  metrics: [
    {
      key: "response.minutes",
      label: "Response time",
      unit: "minutes",
      weight: 1,
      zeroAt: 60,
      fullAt: 0,
      minSamples: 5,
      minCoverage: 1,
      maxAgeHours: 72,
      sourceSystems: ["communications"],
    },
  ],
};
const row = {
  id: id(4),
  tenant_id: id(1),
  policy_id: id(2),
  policy_revision: 1,
  subject_kind: "member",
  subject_id: id(3),
  metric_key: "response.minutes",
  value: 30,
  unit: "minutes",
  window_start: period.start,
  window_end: period.end,
  measured_at: "2026-01-03T00:00:00Z",
  source: "communications",
  source_through: period.end,
  sample_count: 10,
  covered_count: 10,
  eligible_count: 10,
  review_state: "inferred",
  evidence: [{ table: "interactions", id: id(90) }],
  exclusions: [],
  supersedes: null,
  group_ids: [],
};
function db(
  data: any[],
  count: number | null = data.length,
  error: any = null,
  reviews: any[] = [],
  corrections: any[] = [],
) {
  const filters: any[] = [];
  let selection: any;
  const q: any = {
    select: (...args: any[]) => {
      selection = args;
      return q;
    },
    eq: (...args: any[]) => {
      filters.push(args);
      return q;
    },
    order: () => q,
    limit: () => q,
    then: (resolve: any) => Promise.resolve({ data, count, error }).then(resolve),
  };
  return {
    from: (table: string) => {
      if (["learn_performance_reviews", "learn_performance_corrections"].includes(table)) {
        const records = table === "learn_performance_reviews" ? reviews : corrections;
        const r: any = {
          select: () => r,
          eq: () => r,
          in: () => r,
          order: () => r,
          limit: () => r,
          then: (resolve: any) =>
            Promise.resolve({ data: records, count: records.length, error: null }).then(resolve),
        };
        return r;
      }
      assert.equal(table, "measurements");
      return q;
    },
    filters,
    selection: () => selection,
  };
}
test("exact subject/period/version query maps observations without confirming them", async () => {
  const c = db([row]);
  const result = await loadPerformanceMeasurements(c, policy, subject, period);
  for (const [key, value] of [
    ["tenant_id", id(1)],
    ["policy_id", id(2)],
    ["policy_revision", 1],
    ["subject_kind", "member"],
    ["subject_id", id(3)],
    ["window_start", new Date(period.start).toISOString()],
    ["window_end", new Date(period.end).toISOString()],
  ])
    assert.ok(c.filters.some(([k, v]) => k === key && v === value));
  assert.deepEqual(c.selection()[1], { count: "exact" });
  assert.equal(result[0].review, "inferred");
  const score = evaluateScorecard(policy, subject, period, result, Date.parse("2026-01-04"));
  assert.equal(score.previewScore, null);
  assert.ok(score.metrics[0].reasons.includes("Evidence needs confirmation"));
});
test("empty, missing, truncated and excessive histories remain distinct", async () => {
  assert.deepEqual(await loadPerformanceMeasurements(db([]), policy, subject, period), []);
  for (const c of [
    db([], null),
    db([], 1),
    db([row], 2),
    db([row], 501),
    db([], 0, { code: "denied" }),
  ])
    await assert.rejects(
      loadPerformanceMeasurements(c, policy, subject, period),
      /Complete measurement history/,
    );
});
test("foreign scope, malformed evidence and duplicate rows reject the entire read", async () => {
  for (const changed of [
    { tenant_id: id(99) },
    { subject_id: id(99) },
    { subject_kind: "team" },
    { policy_id: id(99) },
    { policy_revision: 2 },
    { window_start: "2025-01-01" },
    { metric_key: "unknown" },
    { unit: "seconds" },
    { source: "other" },
    { value: Infinity },
    { sample_count: 1.5 },
    { eligible_count: 9 },
    { source_through: "2099-01-01" },
    { measured_at: "invalid" },
    { review_state: "unreviewed" },
    { evidence: [] },
    { evidence: [{ table: "profiles", id: id(90) }] },
    { exclusions: [{ count: 1, reason: "", evidence: row.evidence }] },
    { group_ids: ["bad"] },
  ])
    await assert.rejects(
      loadPerformanceMeasurements(db([{ ...row, ...changed }]), policy, subject, period),
      /validation/,
    );
  await assert.rejects(
    loadPerformanceMeasurements(db([row, row]), policy, subject, period),
    /validation/,
  );
  await assert.rejects(
    loadPerformanceMeasurements(db([row]), { ...policy, groupId: id(20) }, subject, period),
    /validation/,
  );
});
test("correction history stays linked and only a reviewed leaf can support a draft simulation", async () => {
  const corrected = {
    ...row,
    id: id(5),
    value: 15,
    review_state: "confirmed",
    measured_at: "2026-01-04T00:00:00Z",
    supersedes: row.id,
  };
  const result = await loadPerformanceMeasurements(
    db([row, corrected], 2, null, [
      {
        id: id(50),
        tenant_id: id(1),
        measurement_id: id(5),
        revision: 1,
        decision: "confirmed",
        reviewed_by: id(60),
        reason: "Checked source calculation",
        created_at: "2026-01-05T00:00:00Z",
      },
    ]),
    policy,
    subject,
    period,
  );
  assert.equal(result.length, 2);
  assert.equal(result[1].supersedes, row.id);
  const score = evaluateScorecard(policy, subject, period, result, Date.parse("2026-01-05"));
  assert.equal(score.score, null);
  assert.equal(score.previewScore, 37.5);
  assert.equal(score.metrics[0].measurementId, id(5));
});

test("human review never refreshes source evidence and a later dispute withholds the preview", async () => {
  const reviews = [
    {
      id: id(50),
      tenant_id: id(1),
      measurement_id: row.id,
      revision: 1,
      decision: "confirmed",
      reviewed_by: id(60),
      reason: "Reviewed old source",
      created_at: "2026-02-01T00:00:00Z",
    },
  ];
  const records = await loadPerformanceMeasurements(
    db([row], 1, null, reviews),
    policy,
    subject,
    period,
  );
  assert.equal(records[0].observedAt, row.measured_at);
  assert.equal(records[0].sourceThrough, row.source_through);
  const stale = evaluateScorecard(policy, subject, period, records, Date.parse("2026-02-01"));
  assert.equal(stale.previewScore, null);
  assert.ok(stale.metrics[0].reasons.includes("Measurement freshness is not established"));
  const disputed = await loadPerformanceMeasurements(
    db([row], 1, null, [
      ...reviews,
      { ...reviews[0], id: id(51), revision: 2, decision: "disputed" },
    ]),
    policy,
    subject,
    period,
  );
  assert.equal(disputed[0].review, "disputed");
  const unsigned = await loadPerformanceMeasurements(
    db([{ ...row, review_state: "confirmed" }]),
    policy,
    subject,
    period,
  );
  assert.equal(unsigned[0].review, "inferred");
});

test("manual correction metadata is read before separate review; old source stays stale", async () => {
  const corrected = {
    ...row,
    id: id(5),
    value: 20,
    supersedes: row.id,
    measured_at: "2026-02-01T00:00:00Z",
    correction_request_id: id(5),
  };
  const correction = {
    id: id(5),
    tenant_id: id(1),
    predecessor_id: row.id,
    previous_value: 30,
    corrected_value: 20,
    source_observed_at: row.measured_at,
    expected_review_revision: 0,
    corrected_by: id(60),
    reason: "Arithmetic correction",
    created_at: corrected.measured_at,
  };
  const review = {
    id: id(50),
    tenant_id: id(1),
    measurement_id: id(5),
    revision: 1,
    decision: "confirmed",
    reviewed_by: id(60),
    reason: "Checked",
    created_at: "2026-02-01T01:00:00Z",
  };
  const records = await loadPerformanceMeasurements(
    db([row, corrected], 2, null, [review], [correction]),
    policy,
    subject,
    period,
  );
  assert.equal(records[1].sourceObservedAt, row.measured_at);
  assert.equal(records[1].review, "confirmed");
  const score = evaluateScorecard(
    policy,
    subject,
    period,
    records,
    Date.parse("2026-02-01T02:00:00Z"),
  );
  assert.equal(score.previewScore, null);
  assert.ok(score.metrics[0].reasons.includes("Measurement freshness is not established"));
  await assert.rejects(
    loadPerformanceMeasurements(db([row, corrected]), policy, subject, period),
    /correction history/,
  );
});
