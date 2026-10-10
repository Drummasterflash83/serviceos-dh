import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkCollectionRequest,
  parseWorkCollectionProgress,
  beginWorkCollection,
  advanceWorkCollection,
  readWorkCollectionProgress,
  abandonWorkCollection,
  readWorkCollectionEvidence,
} from "./learn-resumable-work.ts";
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const policy: any = {
  id: id(1),
  tenantId: id(2),
  version: 1,
  name: "Workload",
  status: "draft",
  subjectKind: "team",
  groupId: null,
  scaleMax: 100,
  metrics: [
    {
      key: "work.team_owned_item_minutes",
      label: "Workload",
      unit: "item_minutes",
      weight: 1,
      zeroAt: 0,
      fullAt: 10,
      minSamples: 1,
      minCoverage: 1,
      maxAgeHours: 72,
      sourceSystems: ["serviceos.work.team-residence@1"],
    },
  ],
};
const input = {
  policy,
  actorId: id(3),
  subjectId: id(4),
  kind: "teamResidence" as const,
  period: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
  requestId: id(5),
  reason: "Check frozen history",
};
const request = createWorkCollectionRequest(input);
const status = (extra: any = {}) => ({
  contract: "work-collection@1",
  ...request,
  period: request.period,
  state: "collecting",
  population: 14500,
  processed: 0,
  eligible: 0,
  covered: 0,
  snapshotAt: "2026-01-03T00:00:00Z",
  measurementId: null,
  endReason: null,
  ...extra,
});
test("scope creation rejects unsupported, foreign-team and invalid-period requests before sending", () => {
  for (const change of [
    { actorId: "invalid" },
    { reason: "" },
    { kind: "other" },
    { period: { ...input.period, end: "2099-01-01T00:00:00Z" } },
    { policy: { ...policy, groupId: id(99) } },
    { policy: { ...policy, subjectKind: "member" } },
  ])
    assert.throws(() => createWorkCollectionRequest({ ...input, ...change } as any));
  assert.equal(createWorkCollectionRequest({ ...input, reason: "  reason  " }).reason, "reason");
});
test("begin and one-batch advance send scope and checkpoint only, never derived values", async () => {
  const calls: any[] = [];
  const db = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return {
        data: status(name.endsWith("step") ? { processed: 100, eligible: 100, covered: 100 } : {}),
        error: null,
      };
    },
  };
  const first = await beginWorkCollection(db, request);
  assert.equal(first.processed, 0);
  const next = await advanceWorkCollection(db, request, first);
  assert.equal(next.processed, 100);
  assert.deepEqual(calls[1], {
    name: "learn_work_collection_step",
    args: { p_tenant: id(2), p_request: id(5), p_after: 0 },
  });
  assert.deepEqual(
    Object.keys(calls[0].args).sort(),
    [
      "p_tenant",
      "p_kind",
      "p_subject",
      "p_policy",
      "p_revision",
      "p_start",
      "p_end",
      "p_request",
      "p_reason",
    ].sort(),
  );
  assert.equal(calls.length, 2, "Client must not silently loop or retry");
});
test("lost replies are checked using the same request; unverified acknowledgements never become completion", async () => {
  let sent = 0;
  const broken = {
    rpc: async () => {
      sent++;
      throw Error("Connection lost");
    },
  };
  await assert.rejects(beginWorkCollection(broken, request));
  assert.equal(sent, 1);
  const actual = status({ processed: 100, eligible: 100, covered: 100 });
  const db = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_work_collection_status");
      assert.equal(args.p_request, request.requestId);
      return { data: actual, error: null };
    },
  };
  assert.equal((await readWorkCollectionProgress(db, request)).processed, 100);
  for (const patch of [
    { tenantId: id(9) },
    { actorId: id(9) },
    { requestId: id(9) },
    { policyId: id(9) },
    { subjectId: id(9) },
    { kind: "residence" },
    { period: { ...request.period, end: "2026-01-02T01:00:00Z" } },
    { snapshotAt: "2025-01-01T00:00:00Z" },
    { processed: 14501 },
    { covered: 1 },
    { state: "completed", measurementId: request.requestId },
  ])
    assert.throws(() => parseWorkCollectionProgress(status(patch), request));
});
test("progress cannot shrink, switch population, change snapshot, or revert a final state", () => {
  const first = parseWorkCollectionProgress(
    status({ processed: 100, eligible: 100, covered: 99 }),
    request,
  );
  for (const patch of [
    { processed: 99 },
    { population: 14501 },
    { eligible: 99 },
    { covered: 98 },
    { snapshotAt: "2026-01-04T00:00:00Z" },
  ])
    assert.throws(() => parseWorkCollectionProgress({ ...first, ...patch }, request, first));
  const done = parseWorkCollectionProgress(
    status({
      state: "completed",
      processed: 14500,
      eligible: 14500,
      covered: 14500,
      measurementId: request.requestId,
    }),
    request,
    first,
  );
  assert.throws(() => parseWorkCollectionProgress(status(), request, done));
  assert.equal(
    parseWorkCollectionProgress(Object.fromEntries(Object.entries(done).reverse()), request, done)
      .state,
    "completed",
  );
});
test("a stopped collection needs a retained reason and never carries a measurement ID", async () => {
  const previous = parseWorkCollectionProgress(status(), request);
  const db = {
    rpc: async () => ({
      data: status({ state: "abandoned", endReason: "Owner stopped" }),
      error: null,
    }),
  };
  assert.equal(
    (await abandonWorkCollection(db, request, "Owner stopped", previous)).state,
    "abandoned",
  );
  assert.throws(() =>
    parseWorkCollectionProgress(status({ state: "abandoned", endReason: null }), request),
  );
  assert.throws(() =>
    parseWorkCollectionProgress(
      status({ state: "superseded", endReason: "Rules changed", measurementId: request.requestId }),
      request,
    ),
  );
  let calls = 0;
  await advanceWorkCollection(
    {
      rpc: async () => {
        calls++;
        return { data: null, error: null };
      },
    },
    request,
    parseWorkCollectionProgress(
      status({ state: "abandoned", endReason: "Owner stopped" }),
      request,
    ),
  );
  assert.equal(calls, 0);
});
const item = (ordinal: number) => ({
  ordinal,
  object_id: id(ordinal + 10),
  head_sequence: "9007199254740993",
  head_reconciled: true,
  result: {
    objectId: id(ordinal + 10),
    eligible: true,
    complete: true,
    knownValue: 12,
    eventIds: [id(8)],
    credited: [{ details: "x".repeat(5000) }],
  },
});
const page = (patch: any = {}) => ({
  contract: "work-collection-evidence@1",
  tenantId: id(2),
  runId: id(5),
  part: "items",
  population: 3,
  after: 0,
  next: 2,
  items: [item(1), item(2)],
  ...patch,
});
test("proof paging retains full details and 64-bit capture sequences and rejects gaps or incorrect continuation", async () => {
  let response = page();
  const db = { rpc: async () => ({ data: response, error: null }) };
  const p = await readWorkCollectionEvidence(db, id(2), id(5), "items");
  assert.equal(p.items[0].head_sequence, "9007199254740993");
  assert.equal(p.items[0].result.credited[0].details.length, 5000);
  for (const patch of [
    { tenantId: id(9) },
    { runId: id(9) },
    { after: 1 },
    { next: null },
    { next: 1 },
    { items: [] },
    { items: [item(2)] },
    { items: [{ ...item(1), result: null }] },
  ]) {
    response = page(patch);
    await assert.rejects(readWorkCollectionEvidence(db, id(2), id(5), "items"));
  }
  response = page({ after: 2, next: null, items: [item(3)] });
  assert.equal((await readWorkCollectionEvidence(db, id(2), id(5), "items", 2)).next, null);
});
test("overview and frozen identity responses bind tenant, contract and complete population", async () => {
  let response: any = {
    contract: "work-collection-evidence@1",
    tenantId: id(2),
    runId: id(5),
    part: "overview",
    sourceSystem: "serviceos.work.team-residence@1",
    metricKey: "work.team_owned_item_minutes",
    observedAt: "2026-01-03T00:00:00Z",
    explanation: "Frozen population",
    proof: {
      contract: "work-collection@1",
      runId: id(5),
      itemCount: 14500,
      populationCount: 14500,
      processed: 14500,
    },
  };
  const db = { rpc: async () => ({ data: response, error: null }) };
  await readWorkCollectionEvidence(db, id(2), id(5), "overview");
  response.proof.processed = 14499;
  await assert.rejects(readWorkCollectionEvidence(db, id(2), id(5), "overview"));
  response = {
    contract: "work-collection-evidence@1",
    tenantId: id(2),
    runId: id(5),
    part: "membership",
    snapshotAt: "2026-01-03T00:00:00Z",
    data: { contract: "member-capture@1", tenantId: id(2), members: [] },
  };
  await readWorkCollectionEvidence(db, id(2), id(5), "membership");
  response.data.tenantId = id(9);
  await assert.rejects(readWorkCollectionEvidence(db, id(2), id(5), "membership"));
});
