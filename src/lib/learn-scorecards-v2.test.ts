import assert from "node:assert/strict";
import test from "node:test";
import { evaluateScorecardV1 } from "./learn-scorecards.ts";
import {
  evaluateScorecardV2,
  validateScorecardPolicyV2,
  type ScorecardPolicyV2,
} from "./learn-scorecards-v2.ts";
import type { PerformanceMeasurement } from "./learn-scorecards.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-20T12:00:00Z");
const subject = { kind: "job", id: id(2) } as const;
const period = { start: "2026-10-18T00:00:00Z", end: "2026-10-19T23:00:00Z" };
function policy(): ScorecardPolicyV2 {
  return {
    engine: "learn-scorecards/2",
    tenantId: id(1),
    id: id(3),
    version: 2,
    name: "Synthetic job policy",
    status: "published",
    subjectKind: "job",
    scaleMax: 100,
    publication: { id: id(4), effectiveFrom: "2026-10-01T00:00:00Z", effectiveUntil: null },
    minimumAssessedWeightPercent: 60,
    minimumAssessedMetricCount: 1,
    requiredMetricKeys: [],
    metrics: [
      {
        key: "job.stage",
        label: "Stage",
        unit: "percent",
        weight: 60,
        zeroAt: 0,
        fullAt: 100,
        minSamples: 1,
        minCoverage: 0.95,
        maxAgeHours: 24,
        sourceSystems: ["verified-stage"],
      },
      {
        key: "job.owner",
        label: "Owner",
        unit: "percent",
        weight: 40,
        zeroAt: 0,
        fullAt: 100,
        minSamples: 1,
        minCoverage: 1,
        maxAgeHours: 24,
        sourceSystems: ["confirmed-owner"],
      },
    ],
  };
}
function measurements(): PerformanceMeasurement[] {
  return policy().metrics.map((rule, i) => ({
    id: id(10 + i),
    tenantId: id(1),
    subject,
    metricKey: rule.key,
    policyId: id(3),
    policyVersion: 2,
    period,
    value: i === 0 ? 80 : 50,
    unit: rule.unit,
    sampleCount: 1,
    coveredCount: 1,
    eligibleCount: 1,
    observedAt: "2026-10-20T11:00:00Z",
    sourceObservedAt: "2026-10-20T10:00:00Z",
    sourceThrough: period.end,
    sourceSystem: rule.sourceSystems[0],
    review: "confirmed",
    evidence: [{ table: "jobs", id: id(30 + i) }],
    exclusions: [],
  }));
}
const run = (p = policy(), m = measurements()) => evaluateScorecardV2(p, subject, period, m, now);

test("V2 rescales a confirmed partial score using only assessed policy weight", () => {
  const result = run(policy(), measurements().slice(0, 1));
  assert.equal(result.engine, "learn-scorecards/2");
  assert.equal(result.state, "ready");
  assert.equal(result.score, 80);
  assert.equal(result.assessedWeight, 60);
  assert.equal(result.assessedWeightPercent, 60);
  assert.equal(result.rescaledDenominator, 60);
  assert.equal(result.assessedMetricCount, 1);
  assert.deepEqual(result.omittedMetrics, [
    { key: "job.owner", weight: 40, reasons: ["No measurement for this subject and period"] },
  ]);
  assert.equal(
    evaluateScorecardV1(policy(), subject, period, measurements().slice(0, 1), now).score,
    null,
    "retained V1 assessments keep the all-measures-required result",
  );
});

test("a published V2 score is held below either explicit policy floor", () => {
  const single = measurements().slice(0, 1);
  const highWeight = run({ ...policy(), minimumAssessedWeightPercent: 70 }, single);
  assert.equal(highWeight.state, "incomplete");
  assert.equal(highWeight.score, null);
  assert.match(highWeight.gateReasons.join(), /weight/);
  const twoMeasures = run({ ...policy(), minimumAssessedMetricCount: 2 }, single);
  assert.equal(twoMeasures.score, null);
  assert.match(twoMeasures.gateReasons.join(), /count/);
  const empty = run(policy(), []);
  assert.equal(empty.score, null);
  assert.equal(empty.rescaledDenominator, 0);
  assert.equal(empty.assessedWeightPercent, 0);
});

test("disputed, inferred, stale, weak-coverage and incomplete-source facts are omitted", () => {
  const changes: Array<Partial<PerformanceMeasurement>> = [
    { review: "disputed" },
    { review: "inferred" },
    { sourceObservedAt: "2026-10-18T00:00:00Z" },
    { coveredCount: 0 },
    { eligibleCount: null },
    { sourceThrough: "2026-10-19T00:00:00Z" },
    { evidence: [] },
    { sampleCount: 0 },
  ];
  for (const change of changes) {
    const [first, second] = measurements();
    const result = run({ ...policy(), minimumAssessedWeightPercent: 40 }, [
      { ...first, ...change },
      second,
    ]);
    assert.equal(result.score, 50, JSON.stringify(change));
    assert.equal(result.rescaledDenominator, 40);
    assert.equal(result.omittedMetrics[0].key, "job.stage");
    assert.ok(result.omittedMetrics[0].reasons.length);
  }
});

test("a required critical measure holds the score if its evidence is stale or disputed", () => {
  const [first, second] = measurements();
  for (const change of [
    { sourceObservedAt: "2026-10-18T00:00:00Z" },
    { review: "disputed" as const },
  ]) {
    const result = run(
      { ...policy(), minimumAssessedWeightPercent: 40, requiredMetricKeys: ["job.stage"] },
      [{ ...first, ...change }, second],
    );
    assert.equal(result.score, null);
    assert.match(result.gateReasons.join(), /Required measures/);
  }
});

test("draft V2 only previews and a complete V2 agrees with V1 weighting", () => {
  const published = run();
  assert.equal(published.score, 68);
  assert.equal(published.omittedMetrics.length, 0);
  const draft = run({ ...policy(), status: "draft" });
  assert.equal(draft.state, "draft");
  assert.equal(draft.score, null);
  assert.equal(draft.previewScore, 68);
});

test("a disputed correction cannot revive its formerly confirmed measure", () => {
  const [first] = measurements();
  const result = run(policy(), [
    first,
    {
      ...first,
      id: id(50),
      supersedes: first.id,
      value: 100,
      observedAt: "2026-10-20T11:30:00Z",
      review: "disputed",
    },
  ]);
  assert.equal(result.score, null);
  assert.equal(result.assessedWeight, 0);
  assert.match(result.omittedMetrics[0].reasons.join(), /disputed/);
});

test("V2 rejects invented thresholds, wrong engine/revision and foreign measurements", () => {
  for (const changed of [
    { engine: "learn-scorecards/1" },
    { version: 1 },
    { minimumAssessedWeightPercent: 0 },
    { minimumAssessedWeightPercent: 101 },
    { minimumAssessedMetricCount: 0 },
    { minimumAssessedMetricCount: 3 },
    { requiredMetricKeys: ["not-in-policy"] },
    { requiredMetricKeys: ["job.stage", "job.stage"] },
  ]) {
    const invalid = { ...policy(), ...changed } as ScorecardPolicyV2;
    assert.ok(validateScorecardPolicyV2(invalid).length);
    assert.throws(() => run(invalid));
  }
  const first = measurements()[0];
  for (const changed of [
    { tenantId: id(99) },
    { policyVersion: 1 },
    { metricKey: "not-in-policy" },
    { subject: { kind: "customer" as const, id: subject.id } },
    { period: { ...period, start: "2026-10-17T00:00:00Z" } },
  ])
    assert.throws(() => run(policy(), [{ ...first, ...changed }]));
});
