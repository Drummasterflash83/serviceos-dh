import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessmentRequest,
  loadAssessmentHistory,
  loadSavedAssessment,
  parseSavedAssessment,
  saveAssessment,
} from "./learn-assessments.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const subject = { kind: "member" as const, id: id(3) },
  period = { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" };
function fixture(): any {
  const policy = {
    id: id(2),
    tenantId: id(1),
    version: 1,
    name: "Response",
    status: "published",
    subjectKind: "member",
    scaleMax: 50,
    publication: { id: id(5), effectiveFrom: period.start, effectiveUntil: null },
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
  return {
    id: id(6),
    tenant_id: id(1),
    publication_id: id(5),
    subject_kind: "member",
    subject_id: id(3),
    window_start: period.start,
    window_end: period.end,
    recorded_at: "2026-01-03T01:00:00Z",
    recorded_by: id(7),
    reason: "Source checked",
    snapshot: {
      version: "learn-assessment/1",
      engine: "learn-scorecards/1",
      policy,
      subject: { ...subject, groupIds: [] },
      period: { ...period },
      assessedAt: "2026-01-03T01:00:00Z",
      measurements: [
        {
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
          correction_request_id: null,
        },
      ],
      reviews: [
        {
          id: id(8),
          tenant_id: id(1),
          measurement_id: id(4),
          revision: 1,
          decision: "confirmed",
          reviewed_by: id(7),
          reason: "Checked",
          created_at: "2026-01-03T00:30:00Z",
        },
      ],
      corrections: [],
    },
  };
}
test("saved scoring uses its frozen time and original reviews; later dispute does not rewrite it", () => {
  const old = fixture(),
    later = structuredClone(old);
  later.id = id(9);
  later.recorded_at = later.snapshot.assessedAt = "2026-01-03T02:00:00Z";
  later.snapshot.reviews.push({
    ...later.snapshot.reviews[0],
    id: id(10),
    revision: 2,
    decision: "disputed",
    created_at: "2026-01-03T01:30:00Z",
  });
  assert.equal(parseSavedAssessment(old, id(1), subject).score.score, 25);
  assert.equal(parseSavedAssessment(later, id(1), subject).score.score, null);
  assert.equal(parseSavedAssessment(old, id(1), subject).score.score, 25);
  assert.equal(old.snapshot.reviews.length, 1);
});
test("foreign, future, incomplete, unknown-version and draft snapshots fail closed", () => {
  for (const change of [
    (r: any) => (r.tenant_id = id(20)),
    (r: any) => (r.snapshot.subject.id = id(20)),
    (r: any) => (r.snapshot.engine = "learn-scorecards/2"),
    (r: any) => (r.snapshot.policy.status = "draft"),
    (r: any) => (r.snapshot.policy.publication.id = id(20)),
    (r: any) => (r.snapshot.period.end = "2026-01-04"),
    (r: any) => (r.snapshot.assessedAt = "2026-01-04"),
    (r: any) => (r.snapshot.reviews[0].revision = 2),
    (r: any) => (r.snapshot.reviews[0].measurement_id = id(20)),
    (r: any) => (r.snapshot.reviews[0].created_at = "2026-02-01"),
    (r: any) => (r.snapshot.measurements[0].tenant_id = id(20)),
    (r: any) => (r.snapshot.measurements[0].correction_request_id = id(4)),
    (r: any) => (r.snapshot.subject.groupIds = [id(20)]),
  ]) {
    const r = fixture();
    change(r);
    assert.throws(() => parseSavedAssessment(r, id(1), subject));
  }
});
test("missing evidence remains a retained incomplete assessment without a manufactured zero", () => {
  const r = fixture();
  r.snapshot.measurements = [];
  r.snapshot.reviews = [];
  const saved = parseSavedAssessment(r, id(1), subject);
  assert.equal(saved.score.state, "incomplete");
  assert.equal(saved.score.score, null);
  assert.match(saved.score.metrics[0].reasons.join(), /No measurement/);
});
test("a frozen numerical correction requires its full ledger and retains original freshness", () => {
  const r = fixture(),
    m = r.snapshot.measurements[0];
  r.snapshot.measurements.push({
    ...m,
    id: id(11),
    value: 20,
    supersedes: m.id,
    measured_at: "2026-01-03T00:40:00Z",
    correction_request_id: id(11),
  });
  r.snapshot.corrections = [
    {
      id: id(11),
      tenant_id: id(1),
      predecessor_id: m.id,
      previous_value: 30,
      corrected_value: 20,
      source_observed_at: m.measured_at,
      expected_review_revision: 1,
      corrected_by: id(7),
      reason: "Correct arithmetic",
      created_at: "2026-01-03T00:40:00Z",
    },
  ];
  assert.equal(parseSavedAssessment(r, id(1), subject).score.score, null);
  r.snapshot.reviews.push({
    ...r.snapshot.reviews[0],
    id: id(12),
    measurement_id: id(11),
    created_at: "2026-01-03T00:50:00Z",
  });
  const saved = parseSavedAssessment(r, id(1), subject);
  assert.ok(Math.abs(saved.score.score! - 100 / 3) < 1e-9);
  assert.equal(saved.rows[1].sourceObservedAt, m.measured_at);
  r.snapshot.corrections[0].source_observed_at = "2026-01-03T00:40:00Z";
  assert.throws(() => parseSavedAssessment(r, id(1), subject), /freshness/);
});
function db(data: any[], count = data.length, error: any = null): any {
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => Promise.resolve({ data, count, error }),
  };
  return {
    from: (table: string) => {
      assert.equal(table, "learn_assessments");
      return q;
    },
  };
}
test("history readers reject truncation, duplicates and mismatched requested identities", async () => {
  const r = fixture();
  assert.equal((await loadAssessmentHistory(db([r]), id(1), subject)).total, 1);
  await assert.rejects(() => loadAssessmentHistory(db([r], 2), id(1), subject));
  await assert.rejects(() => loadAssessmentHistory(db([r, r]), id(1), subject));
  assert.equal((await loadSavedAssessment(db([r]), id(1), subject, r.id)).score.score, 25);
  await assert.rejects(() => loadSavedAssessment(db([r]), id(1), subject, id(99)));
});
test("save submits only scope and expected ledger heads; retry preserves request identity", async () => {
  const saved = parseSavedAssessment(fixture(), id(1), subject),
    request = assessmentRequest(saved.policy, subject, period, saved.rows, " Checked ", id(50)),
    calls: any[] = [];
  const client = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_assessment_save");
      calls.push(args);
      return calls.length === 1
        ? { data: null, error: { code: "network" } }
        : {
            data: { assessmentId: id(50), recordedAt: "2026-01-03T01:00:00Z", reused: true },
            error: null,
          };
    },
  };
  await assert.rejects(() => saveAssessment(client, request), /Retry the same/);
  assert.equal((await saveAssessment(client, request)).reused, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0].p_expected, [{ id: id(4), reviewRevision: 1 }]);
  assert.ok(!("score" in calls[0]));
  assert.ok(!("snapshot" in calls[0]));
  assert.throws(
    () =>
      assessmentRequest(
        { ...saved.policy, status: "draft" },
        subject,
        period,
        saved.rows,
        "x",
        id(51),
      ),
    /published/,
  );
});
