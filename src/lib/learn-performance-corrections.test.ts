import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachPerformanceCorrections,
  correctPerformanceMeasurement,
  type PerformanceCorrection,
} from "./learn-performance-corrections.ts";
import type { PerformanceMeasurement } from "./learn-scorecards.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const parent: PerformanceMeasurement = {
  id: id(1),
  tenantId: id(2),
  policyId: id(3),
  policyVersion: 1,
  subject: { kind: "member", id: id(4) },
  period: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
  metricKey: "response.minutes",
  unit: "minutes",
  value: 30,
  sourceSystem: "communications",
  sourceThrough: "2026-01-02T00:00:00Z",
  sampleCount: 10,
  coveredCount: 10,
  eligibleCount: 10,
  observedAt: "2026-01-03T00:00:00Z",
  review: "inferred",
  evidence: [{ table: "interactions", id: id(90) }],
  exclusions: [],
};
const child = {
  ...parent,
  id: id(5),
  value: 20,
  supersedes: parent.id,
  observedAt: "2026-02-01T00:00:00Z",
};
const ledger: PerformanceCorrection = {
  id: child.id,
  tenant_id: parent.tenantId,
  predecessor_id: parent.id,
  previous_value: 30,
  corrected_value: 20,
  source_observed_at: parent.observedAt,
  expected_review_revision: 0,
  corrected_by: id(6),
  reason: "Checked calculation",
  created_at: child.observedAt,
};
function db(rows: any[], count: number | null = rows.length, error: any = null) {
  const q: any = {
    select: () => q,
    eq: (key: string, value: any) => {
      assert.equal(key, "tenant_id");
      assert.equal(value, parent.tenantId);
      return q;
    },
    in: () => q,
    limit: () => q,
    then: (resolve: any) => Promise.resolve({ data: rows, count, error }).then(resolve),
  };
  return {
    from: (table: string) => {
      assert.equal(table, "learn_performance_corrections");
      return q;
    },
  };
}
const markers = new Map([[child.id, child.id]]);
test("manual corrections retain source freshness through multiple corrections and explicit withholding", async () => {
  const grandchild = {
    ...child,
    id: id(7),
    supersedes: child.id,
    value: null,
    observedAt: "2026-02-02T00:00:00Z",
  };
  const next = {
    ...ledger,
    id: grandchild.id,
    predecessor_id: child.id,
    previous_value: 20,
    corrected_value: null,
    created_at: grandchild.observedAt,
  };
  const result = await attachPerformanceCorrections(
    db([ledger, next]),
    parent.tenantId,
    [grandchild, child, parent],
    new Map([...markers, [grandchild.id, grandchild.id]]),
  );
  assert.equal(result[0].sourceObservedAt, parent.observedAt);
  assert.equal(result[0].value, null);
  assert.equal(result[1].review, "inferred");
  assert.deepEqual(result[1].evidence, parent.evidence);
  assert.deepEqual(result[2], parent);
});
test("ordinary observations do not require a manual correction ledger", async () => {
  assert.deepEqual(
    await attachPerformanceCorrections(
      {
        from: () => {
          throw Error("unexpected read");
        },
      },
      parent.tenantId,
      [parent],
      new Map(),
    ),
    [parent],
  );
});
test("missing, foreign, malformed or truncated correction ledgers fail closed", async () => {
  for (const c of [
    db([]),
    db([ledger], null),
    db([ledger], 2),
    db([ledger], 1, { code: "denied" }),
    db([ledger, ledger]),
    db([{ ...ledger, tenant_id: id(8) }]),
    db([{ ...ledger, source_observed_at: "invalid" }]),
    db([{ ...ledger, reason: " " }]),
    db([{ ...ledger, corrected_value: Infinity }]),
  ])
    await assert.rejects(
      attachPerformanceCorrections(c, parent.tenantId, [parent, child], markers),
    );
});
test("changed coverage, source, scope, evidence, values and timestamps cannot disguise a correction", async () => {
  for (const change of [
    { coveredCount: 9 },
    { sampleCount: 9 },
    { eligibleCount: 11 },
    { sourceThrough: null },
    { subject: { kind: "member", id: id(9) } },
    { period: { ...parent.period, start: "2025-01-01" } },
    { evidence: [] },
    { exclusions: [{ reason: "omitted", count: 1, evidence: parent.evidence }] },
    { value: 21 },
    { supersedes: id(9) },
    { observedAt: "2026-02-03T00:00:00Z" },
    { sourceSystem: "other" },
  ])
    await assert.rejects(
      attachPerformanceCorrections(
        db([ledger]),
        parent.tenantId,
        [parent, { ...child, ...change } as PerformanceMeasurement],
        markers,
      ),
      /retained source/,
    );
  await assert.rejects(
    attachPerformanceCorrections(
      db([{ ...ledger, source_observed_at: child.observedAt }]),
      parent.tenantId,
      [parent, child],
      markers,
    ),
    /freshness/,
  );
  await assert.rejects(
    attachPerformanceCorrections(db([ledger]), parent.tenantId, [child], markers),
    /retained source/,
  );
  await assert.rejects(
    attachPerformanceCorrections(db([ledger]), parent.tenantId, [parent, parent, child], markers),
    /scope/,
  );
  await assert.rejects(
    attachPerformanceCorrections(db([ledger]), parent.tenantId, [parent], markers),
    /scope/,
  );
});
const request = {
  tenantId: parent.tenantId,
  measurementId: parent.id,
  requestId: child.id,
  expectedReviewRevision: 0,
  value: 20,
  reason: "  Corrected arithmetic  ",
};
test("RPC sends explicit null and stable request identity, verifies the returned receipt", async () => {
  let calls = 0;
  const client = {
    rpc: async (name: string, args: any) => {
      calls++;
      assert.equal(name, "learn_performance_correct");
      assert.deepEqual(args, {
        p_tenant: parent.tenantId,
        p_measurement: parent.id,
        p_request: child.id,
        p_expected_review_revision: 0,
        p_value: null,
        p_reason: "Corrected arithmetic",
      });
      return {
        data: { measurementId: child.id, predecessorId: parent.id, reused: calls > 1 },
        error: null,
      };
    },
  };
  assert.equal(
    (await correctPerformanceMeasurement(client, { ...request, value: null })).reused,
    false,
  );
  assert.equal(
    (await correctPerformanceMeasurement(client, { ...request, value: null })).reused,
    true,
  );
  for (const change of [
    { value: NaN },
    { value: Infinity },
    { value: undefined },
    { reason: " " },
    { reason: "x".repeat(1001) },
    { expectedReviewRevision: -1 },
    { requestId: "bad" },
  ])
    await assert.rejects(
      correctPerformanceMeasurement(client, { ...request, ...change } as any),
      /valid corrected/,
    );
  assert.equal(calls, 2);
  await assert.rejects(
    correctPerformanceMeasurement(
      {
        rpc: async () => ({
          data: { measurementId: id(8), predecessorId: parent.id, reused: false },
          error: null,
        }),
      },
      request,
    ),
    /receipt/,
  );
});
test("conflicts, role changes and uncertain replies produce actionable errors", async () => {
  for (const [code, pattern] of [
    ["PT409", /Reload/],
    ["40001", /Reload/],
    ["42501", /owner or admin/],
    ["network", /same request/],
  ] as const)
    await assert.rejects(
      correctPerformanceMeasurement(
        { rpc: async () => ({ data: null, error: { code } }) },
        request,
      ),
      pattern,
    );
});
