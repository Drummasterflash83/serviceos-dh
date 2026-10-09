import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateScorecard,
  measureDeskTime,
  pooledRate,
  validateScorecardPolicy,
  type ScorecardPolicy,
  type PerformanceMeasurement,
} from "./learn-scorecards.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-09T12:00:00Z");
const subject = { kind: "member", id: id(2) } as const;
const period = { start: "2026-10-01T00:00:00Z", end: "2026-10-08T23:59:59Z" };
const evidence = [{ table: "interactions", id: id(90) }];
function policy(): ScorecardPolicy {
  return {
    tenantId: id(1),
    id: id(3),
    name: "Service team",
    version: 1,
    status: "published",
    publication: {id: id(99), effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null},
    subjectKind: "member",
    scaleMax: 100,
    metrics: [
      {
        key: "response.within_target",
        label: "Responses within target",
        unit: "percent",
        weight: 60,
        zeroAt: 0,
        fullAt: 100,
        minSamples: 5,
        minCoverage: 0.95,
        maxAgeHours: 24,
        sourceSystems: ["communications"],
      },
      {
        key: "work.desk_minutes",
        label: "Time on desk",
        unit: "minutes",
        weight: 40,
        zeroAt: 120,
        fullAt: 0,
        minSamples: 5,
        minCoverage: 0.95,
        maxAgeHours: 24,
        sourceSystems: ["commusoft"],
      },
    ],
  };
}
function measurements(): PerformanceMeasurement[] {
  return policy().metrics.map((r, i) => ({
    id: id(10 + i),
    tenantId: id(1),
    subject,
    metricKey: r.key,
    policyId: id(3),
    policyVersion: 1,
    period,
    value: i === 0 ? 80 : 30,
    unit: r.unit,
    sampleCount: 20,
    coveredCount: 20,
    eligibleCount: 20,
    observedAt: "2026-10-09T11:00:00Z",
    sourceThrough: period.end,
    sourceSystem: r.sourceSystems[0],
    review: "confirmed",
    evidence,
    exclusions: [],
  }));
}
const run = (p = policy(), m = measurements()) => evaluateScorecard(p, subject, period, m, now);

test("tenant-selected weights combine raw outcomes; 0–50 and 0–100 scales preserve the same proportions", () => {
  const result = run();
  assert.equal(result.score, 78);
  assert.deepEqual(
    result.metrics.map((m) => m.score),
    [80, 75],
  );
  assert.equal(run({ ...policy(), scaleMax: 50 }).score, 39);
  assert.equal(run({ ...policy(), scaleMax: 200 }).score, 156);
  assert.equal(result.use, "advisory_review");
});
test("missing sources leave total unassessed, never zero or silently reweighted", () => {
  const result = run(policy(), measurements().slice(0, 1));
  assert.equal(result.state, "incomplete");
  assert.equal(result.score, null);
  assert.equal(result.assessedWeight, 60);
  assert.equal(result.totalWeight, 100);
  assert.equal(result.metrics[1].score, null);
});
test("draft rules can simulate but never publish a person's assessed score", () => {
  const result = run({ ...policy(), status: "draft" });
  assert.equal(result.state, "draft");
  assert.equal(result.score, null);
  assert.equal(result.previewScore, 78);
});
test("stale, disputed, inferred, wrong-unit, weak-sample and incomplete-source data all withhold scoring", () => {
  const mutations: Partial<PerformanceMeasurement>[] = [
    { observedAt: "2026-10-07T00:00:00Z" },
    { observedAt: "2027-01-01T00:00:00Z" },
    { review: "disputed" },
    { review: "inferred" },
    { unit: "hours" },
    { sampleCount: 1 },
    { coveredCount: 10 },
    { eligibleCount: null },
    { sourceThrough: "2026-10-07T00:00:00Z" },
    { sourceThrough: null },
    { value: NaN },
    { sourceSystem: "unapproved" },
    { evidence: [] },
    { exclusions: [{ reason: "", count: 1, evidence: [] }] },
  ];
  for (const change of mutations) {
    const m = measurements();
    Object.assign(m[0], change);
    const result = run(policy(), m);
    assert.equal(result.score, null, JSON.stringify(change));
    assert.ok(result.metrics[0].reasons.length);
  }
});
test("tenant, person, team, assessment period and definition version cannot be mixed", () => {
  for (const change of [
    { tenantId: id(99) },
    { subject: { kind: "member", id: id(99) } },
    { subject: { kind: "team", id: subject.id } },
    { policyVersion: 2 },
    { period: { ...period, start: "2026-09-01T00:00:00Z" } },
  ]) {
    const m = measurements();
    Object.assign(m[0], change);
    assert.throws(() => run(policy(), m));
  }
  assert.throws(() =>
    evaluateScorecard(policy(), subject, { ...period, end: "2027-01-01T00:00:00Z" }, [], now),
  );
});
test("replayed facts deduplicate; multiple independent facts do not secretly pick the newest", () => {
  const m = measurements();
  assert.equal(run(policy(), [...m, m[0]]).score, 78);
  assert.throws(() => run(policy(), [...m, { ...m[0], value: 99 }]));
  const conflict = run(policy(), [...m, { ...m[0], id: id(30), value: 99 }]);
  assert.equal(conflict.score, null);
  assert.match(conflict.metrics[0].reasons.join(), /correction history/);
});
test("an explicit append-only correction replaces its predecessor and remains reviewable", () => {
  const m = measurements();
  const correction = {
    ...m[0],
    id: id(30),
    value: 100,
    observedAt: "2026-10-09T11:30:00Z",
    supersedes: m[0].id,
  };
  const result = run(policy(), [...m, correction]);
  assert.equal(result.score, 90);
  assert.equal(result.metrics[0].measurementId, id(30));
  assert.equal(
    run(policy(), [m[1], correction]).score,
    null,
    "missing predecessor cannot erase audit history",
  );
  assert.equal(
    run(policy(), [...m, { ...correction, review: "disputed" }]).score,
    null,
    "disputed correction cannot revive old score",
  );
});
test("invalid or invented configuration cannot produce scores", () => {
  const p = policy();
  p.metrics[0].fullAt = p.metrics[0].zeroAt;
  assert.ok(validateScorecardPolicy(p).length);
  assert.throws(() => run(p));
  const duplicate = policy();
  duplicate.metrics.push(duplicate.metrics[0]);
  assert.throws(() => run(duplicate));
  const noWeight = policy();
  noWeight.metrics.forEach((r) => (r.weight = 0));
  assert.throws(() => run(noWeight));
});
test("scores clamp at scale boundaries and zero-weight measures do not affect the total", () => {
  const m = measurements();
  m[0].value = 150;
  m[1].value = -10;
  assert.equal(run(policy(), m).score, 100);
  m[0].value = -10;
  m[1].value = 150;
  assert.equal(run(policy(), m).score, 0);
  const p = policy();
  p.metrics[1].weight = 0;
  assert.equal(run(p, [measurements()[0]]).score, 80);
});
test("team rates pool eligible jobs instead of averaging employee percentages", () => {
  assert.deepEqual(
    pooledRate([
      { numerator: 1, denominator: 1 },
      { numerator: 50, denominator: 100 },
    ]),
    { numerator: 51, denominator: 101, value: 51 / 101 },
  );
  assert.equal(pooledRate([]).value, null);
  assert.throws(() => pooledRate([{ numerator: 2, denominator: 1 }]));
});
test("desk time excludes off-hours and approved blockers without double-counting overlapping evidence", () => {
  const w = (start: string, end: string) => ({
    start: `2026-10-08T${start}:00Z`,
    end: `2026-10-08T${end}:00Z`,
  });
  const result = measureDeskTime({
    period: w("00:00", "23:59"),
    ownership: [w("07:00", "13:00"), w("12:00", "19:00")],
    businessHours: [w("09:00", "12:00"), w("13:00", "17:00")],
    approvedExclusions: [w("10:00", "11:00"), w("10:30", "11:30"), w("18:00", "19:00")],
  });
  assert.deepEqual(result, {
    elapsedOwnedMinutes: 720,
    businessMinutes: 420,
    excludedMinutes: 90,
    assessedMinutes: 330,
  });
});
test("invalid work-time intervals are rejected rather than becoming negative performance", () => {
  assert.throws(() =>
    measureDeskTime({
      period: { start: "bad", end: "bad" },
      ownership: [],
      businessHours: [],
      approvedExclusions: [],
    }),
  );
});

test("group-specific rules cannot rate people outside the selected team", () => {
  const p = { ...policy(), groupId: id(70) };
  assert.throws(() => run(p), /team group/);
  const member = { ...subject, groupIds: [id(70)] };
  assert.equal(evaluateScorecard(p, member, period, measurements(), now).score, 78);
});
