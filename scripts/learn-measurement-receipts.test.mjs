import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMeasurementReceipts } from "../src/lib/learn-measurement-receipts.ts";
import { loadPerformanceMeasurements } from "../src/lib/learn-performance-measurements.ts";
import { fixture, fixtures, id } from "./verify/learn-measurement-receipts-fixture.mjs";
function db(records, { change = (x) => x, missingCount = false, readError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      let ids = [],
        tenant,
        cols;
      const q = {
        select(c) {
          cols = c;
          return q;
        },
        eq(k, v) {
          assert.equal(k, "tenant_id");
          tenant = v;
          return q;
        },
        in(k, v) {
          assert.equal(k, "id");
          ids = v;
          return q;
        },
        limit() {
          return q;
        },
        then(resolve) {
          calls.push({ table, ids, tenant, cols });
          const data = records
            .filter((x) => x.table === table && ids.includes(x.r.id))
            .map((x) => x.r);
          return Promise.resolve({
            data: change(data),
            count: missingCount ? null : data.length,
            error: readError,
          }).then(resolve);
        },
      };
      return q;
    },
  };
}
test("all eight legacy/resumable collector shapes bind without reading full proofs", async () => {
  const c = db(fixtures);
  await verifyMeasurementReceipts(
    c,
    id(1),
    fixtures.map((f) => f.m),
  );
  assert.equal(c.calls.length, 3);
  for (const call of c.calls) {
    assert.equal(call.tenant, id(1));
    assert.ok(!call.cols.split(",").includes("proof"));
    assert.ok(!call.cols.includes("roster"));
  }
});
test("scope, value, counts, microseconds and completion mismatches withhold assessment", async () => {
  for (const f of fixtures) {
    const mutations = {
      tenant_id: id(99),
      subject_id: id(99),
      policy_id: id(99),
      policy_revision: 2,
      source_system: "wrong",
      metric_key: "wrong",
      window_start: "2026-10-01T00:00:00.000002Z",
      window_end: "2026-10-02T00:00:00.000002Z",
      observed_at: "2026-10-03T00:00:01.000457Z",
      receipt_value: 21,
      receipt_covered: 1,
      receipt_eligible: 3,
      receipt_contract: "wrong",
      ...(f.table === "learn_work_collection_runs"
        ? {
            state: "collecting",
            kind: "unknown",
            unit: "wrong",
            subject_kind: "job",
            snapshot_at: "2026-10-03T00:00:00.000124Z",
            population: 4,
            processed: 2,
            receipt_run_id: id(99),
            receipt_items: 2,
            receipt_kind: "wrong",
            receipt_population: 2,
            receipt_processed: 2,
          }
        : { request_subject: id(99) }),
    };
    for (const [key, value] of Object.entries(mutations))
      await assert.rejects(
        verifyMeasurementReceipts(db([{ ...f, r: { ...f.r, [key]: value } }]), id(1), [f.m]),
        /No score/,
        `${f.table}:${key}`,
      );
  }
  const f = fixture();
  await verifyMeasurementReceipts(
    db([{ ...f, r: { ...f.r, window_start: "2026-10-01T01:00:00.000001+01:00" } }]),
    id(1),
    [f.m],
  );
});
test("missing, duplicated, denied, count-less and truncated receipt reads fail", async () => {
  const f = fixture();
  for (const opts of [
    { change: () => [] },
    { change: (r) => [...r, ...r] },
    { missingCount: true },
    { readError: { message: "denied" } },
  ])
    await assert.rejects(verifyMeasurementReceipts(db([f], opts), id(1), [f.m]), /No score/);
  await assert.rejects(verifyMeasurementReceipts(db([]), id(1), [f.m]), /No score/);
});
test("wrong reference IDs, tables and forged work source combinations fail before reading", async () => {
  const f = fixture();
  for (const patch of [
    { evidence: [{ table: f.table, id: id(90) }] },
    { evidence: [] },
    { evidence: [...f.m.evidence, ...f.m.evidence] },
    { sourceSystem: "communications" },
    { unit: "wrong" },
    { metricKey: "wrong" },
    { subject: { kind: "job", id: id(3) } },
    { exclusions: [{ reason: "unsupported", count: 1, evidence: f.m.evidence }] },
  ])
    await assert.rejects(
      verifyMeasurementReceipts(db([f]), id(1), [{ ...f.m, ...patch }]),
      /No score/,
    );
  const working = fixture("workingTime");
  await assert.rejects(
    verifyMeasurementReceipts(db([]), id(1), [
      { ...working.m, evidence: [{ table: "learn_work_measurement_runs", id: working.m.id }] },
    ]),
    /No score/,
  );
  const c = db([]);
  await verifyMeasurementReceipts(c, id(1), [
    { ...f.m, sourceSystem: "communications", evidence: [{ table: "interactions", id: id(90) }] },
  ]);
  assert.equal(c.calls.length, 0);
});
test("validated numerical correction chains retain original receipt and original value", async () => {
  const f = fixture();
  const child = {
    ...f.m,
    id: id(40),
    value: 17,
    supersedes: f.m.id,
    correction: { predecessor_id: f.m.id },
    observedAt: "2026-10-04T00:00:00Z",
  };
  const last = {
    ...child,
    id: id(41),
    value: 16,
    supersedes: child.id,
    correction: { predecessor_id: child.id },
  };
  const c = db([f]);
  await verifyMeasurementReceipts(c, id(1), [f.m, child, last]);
  assert.deepEqual(c.calls[0].ids, [f.m.id]);
  await assert.rejects(verifyMeasurementReceipts(db([f]), id(1), [last]), /No score/);
  await assert.rejects(
    verifyMeasurementReceipts(db([f]), id(1), [
      { ...child, supersedes: child.id, correction: { predecessor_id: child.id } },
    ]),
    /No score/,
  );
});
test("unknown values remain unknown; known zero remains supported", async () => {
  for (const value of [null, 0]) {
    const f = fixture("workingTime");
    f.m.value = value;
    f.r.receipt_value = value;
    if (value === null) f.m.sourceThrough = null;
    await verifyMeasurementReceipts(db([f]), id(1), [f.m]);
  }
});
test("500 observations use bounded batches and reject a silently capped response", async () => {
  const fs = Array.from({ length: 500 }, (_, n) => fixture("residence", false, 100 + n));
  const c = db(fs);
  await verifyMeasurementReceipts(
    c,
    id(1),
    fs.map((f) => f.m),
  );
  assert.equal(c.calls.length, 5);
  assert.ok(c.calls.every((c) => c.ids.length === 100));
  await assert.rejects(
    verifyMeasurementReceipts(
      db(fs, { change: (r) => r.slice(0, 37) }),
      id(1),
      fs.map((f) => f.m),
    ),
    /No score/,
  );
});
test("actual performance reader stops on receipt mismatch before reading review confirmation", async () => {
  const f = fixture();
  const policy = {
    tenantId: id(1),
    id: id(2),
    version: 1,
    name: "Handoffs",
    status: "draft",
    subjectKind: "member",
    scaleMax: 100,
    metrics: [
      {
        key: f.m.metricKey,
        label: "Handoffs",
        unit: f.m.unit,
        weight: 1,
        zeroAt: 0,
        fullAt: 20,
        minSamples: 1,
        minCoverage: 1,
        maxAgeHours: 72,
        sourceSystems: [f.m.sourceSystem],
      },
    ],
  };
  const row = {
    id: f.m.id,
    tenant_id: id(1),
    policy_id: id(2),
    policy_revision: 1,
    subject_kind: "member",
    subject_id: id(3),
    metric_key: f.m.metricKey,
    value: 20,
    unit: f.m.unit,
    window_start: f.m.period.start,
    window_end: f.m.period.end,
    measured_at: f.m.observedAt,
    source: f.m.sourceSystem,
    source_through: f.m.sourceThrough,
    sample_count: 2,
    covered_count: 2,
    eligible_count: 2,
    review_state: "confirmed",
    evidence: f.m.evidence,
    exclusions: [],
    supersedes: null,
    group_ids: [],
  };
  const c = db([{ ...f, r: { ...f.r, subject_id: id(90) } }]);
  const client = {
    from(table) {
      if (table === "measurements") {
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          limit: () => q,
          then: (resolve) => Promise.resolve({ data: [row], count: 1, error: null }).then(resolve),
        };
        return q;
      }
      assert.notEqual(table, "learn_performance_reviews");
      return c.from(table);
    },
  };
  await assert.rejects(
    loadPerformanceMeasurements(client, policy, f.m.subject, f.m.period),
    /No score/,
  );
});

test("work collectors cannot disguise absent population coverage as unknown counts", async () => {
  const f = fixture("residence", true);
  await assert.rejects(
    verifyMeasurementReceipts(
      db([{ ...f, r: { ...f.r, receipt_value: null, receipt_eligible: null } }]),
      id(1),
      [{ ...f.m, value: null, eligibleCount: null, sourceThrough: null }],
    ),
    /No score/,
  );
});
