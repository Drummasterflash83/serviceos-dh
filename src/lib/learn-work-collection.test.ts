import test from "node:test";
import assert from "node:assert/strict";
import {
  collectWorkHandoffs,
  canCollectWorkHandoffs,
  HANDOFF_METRIC,
  HANDOFF_SOURCE,
  collectWorkEvidence,
  canCollectWork,
  RESIDENCE_METRIC,
  RESIDENCE_SOURCE,
} from "./learn-work-collection.ts";
import { loadPerformanceEvidence } from "./learn-performance-evidence.ts";
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const policy: any = {
  id: id(1),
  tenantId: id(2),
  version: 1,
  status: "draft",
  subjectKind: "member",
  groupId: null,
  name: "Handoffs",
  scaleMax: 100,
  metrics: [
    {
      key: HANDOFF_METRIC,
      label: "Recorded handoffs",
      unit: "handoffs",
      weight: 1,
      zeroAt: 0,
      fullAt: 10,
      minSamples: 1,
      minCoverage: 1,
      maxAgeHours: 72,
      sourceSystems: [HANDOFF_SOURCE],
    },
  ],
};
const input = {
  policy,
  memberId: id(3),
  requestId: id(4),
  reason: " Check evidence ",
  period: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
};
test("collector supplies only scope and intent, never browser-calculated values or confirmation", async () => {
  let call: any;
  const result = await collectWorkHandoffs(
    {
      rpc: async (name, args) => {
        call = { name, args };
        return { data: { measurementId: id(4), reused: false }, error: null };
      },
    },
    input,
  );
  assert.equal(call.name, "learn_work_handoffs_collect");
  assert.deepEqual(
    Object.keys(call.args).sort(),
    [
      "p_tenant",
      "p_member",
      "p_policy",
      "p_revision",
      "p_start",
      "p_end",
      "p_request",
      "p_reason",
    ].sort(),
  );
  assert.equal(call.args.p_tenant, id(2));
  assert.equal(call.args.p_reason, "Check evidence");
  assert.equal(result.measurementId, id(4));
});
test("foreign acknowledgements, unsupported scope, unknown metrics and invalid periods reject", async () => {
  const db = { rpc: async () => ({ data: { measurementId: id(99), reused: false }, error: null }) };
  await assert.rejects(() => collectWorkHandoffs(db, input), /acknowledgement/);
  assert.equal(canCollectWorkHandoffs({ ...policy, groupId: id(5) }), false);
  for (const bad of [
    { ...input, policy: { ...policy, groupId: id(5) } },
    { ...input, reason: "" },
    { ...input, requestId: "bad" },
    { ...input, period: { ...input.period, end: "2099-01-01T00:00:00Z" } },
  ])
    await assert.rejects(() => collectWorkHandoffs(db, bad));
});
test("retries keep the same identity and report conflicts or limits without success", async () => {
  const seen: string[] = [];
  const db = {
    rpc: async (_n: string, args: any) => {
      seen.push(args.p_request);
      return { data: { measurementId: args.p_request, reused: seen.length > 1 }, error: null };
    },
  };
  await collectWorkHandoffs(db, input);
  assert.equal((await collectWorkHandoffs(db, input)).reused, true);
  assert.deepEqual(seen, [id(4), id(4)]);
  for (const code of ["40001", "54000", "42501"])
    await assert.rejects(() =>
      collectWorkHandoffs({ rpc: async () => ({ data: null, error: { code } }) }, input),
    );
});
test("calculation evidence retains complete proof instead of silently shortening it", async () => {
  const proof = { contract: "work-handoffs@1", items: [], credited: [], extra: "x".repeat(4500) };
  const db: any = {
    from: (table: string) => {
      assert.equal(table, "learn_work_measurement_runs");
      const q: any = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        then: (f: any) =>
          Promise.resolve({
            data: [
              {
                id: id(4),
                tenant_id: id(2),
                explanation: "Missing history withholds the value",
                proof,
              },
            ],
            error: null,
          }).then(f),
      };
      return q;
    },
  };
  const rows = await loadPerformanceEvidence(db, id(2), {
    table: "learn_work_measurement_runs",
    id: id(4),
  });
  assert.equal(JSON.parse(rows.find((r) => r.label === "proof")!.value).extra.length, 4500);
  proof.contract = "work-residence@1";
  const residence = await loadPerformanceEvidence(db, id(2), {
    table: "learn_work_measurement_runs",
    id: id(4),
  });
  assert.equal(
    JSON.parse(residence.find((r) => r.label === "proof")!.value).contract,
    "work-residence@1",
  );
  proof.contract = "unknown-contract";
  await assert.rejects(
    () => loadPerformanceEvidence(db, id(2), { table: "learn_work_measurement_runs", id: id(4) }),
    /proof/,
  );
});

test("elapsed ownership uses its own exact source contract and sends no calculated duration", async () => {
  const residence = {
    ...policy,
    metrics: [
      {
        ...policy.metrics[0],
        key: RESIDENCE_METRIC,
        unit: "item_minutes",
        sourceSystems: [RESIDENCE_SOURCE],
      },
    ],
  };
  assert.equal(canCollectWork(residence, "residence"), true);
  assert.equal(canCollectWorkHandoffs(residence), false);
  assert.equal(canCollectWork(policy, "residence"), false);
  assert.equal(canCollectWork({ ...residence, groupId: id(5) }, "residence"), false);
  let name = "";
  let args: any;
  const db = {
    rpc: async (n: string, a: any) => {
      name = n;
      args = a;
      return { data: { measurementId: a.p_request, reused: false }, error: null };
    },
  };
  await collectWorkEvidence(db, { ...input, policy: residence, kind: "residence" });
  assert.equal(name, "learn_work_residence_collect");
  assert.equal(Object.keys(args).length, 8);
  assert.equal(args.p_start, "2026-01-01T00:00:00.000Z");
  for (const patch of [{ unit: "minutes" }, { sourceSystems: [HANDOFF_SOURCE] }])
    await assert.rejects(() =>
      collectWorkEvidence(db, {
        ...input,
        kind: "residence",
        policy: { ...residence, metrics: [{ ...residence.metrics[0], ...patch }] },
      }),
    );
});
