import assert from "node:assert/strict";
import test from "node:test";
import {
  readOpportunityRetainedState,
  readOpportunitySourcePage,
  readOpportunityWait,
} from "./new-dawn-opportunity-source-review.ts";

const scope = {
  tenant: "00000000-0000-0000-0000-000000000001",
  connection: "11111111-1111-1111-1111-111111111111",
  request: "22222222-2222-2222-2222-222222222222",
};
const page = {
  version: "commusoft-opportunity-probe/1",
  requestId: scope.request,
  tenantId: scope.tenant,
  connectionId: scope.connection,
  observedAt: "2026-10-20T00:00:00Z",
  recordCount: 2,
  hasMore: true,
  pipelineCounts: [
    { pipeline: "Further Works", count: 1 },
    { pipeline: "Other", count: 1 },
  ],
  statusCounts: [{ status: "Open", count: 2 }],
};

test("a bounded receipt remains a source-label sample", () => {
  const checked = readOpportunitySourcePage(page, scope);
  assert.equal(checked.recordCount, 2);
  assert.equal(checked.hasMore, true);
  assert.deepEqual(checked.pipelineCounts, [
    { label: "Further Works", count: 1 },
    { label: "Other", count: 1 },
  ]);
  assert.equal("quoteAge" in checked, false);
  assert.equal("customer" in checked, false);
});

test("wrong tenant, connection, request, unbounded count and malformed labels fail closed", () => {
  for (const changed of [
    { tenantId: scope.connection },
    { connectionId: scope.tenant },
    { requestId: scope.tenant },
    { recordCount: 11 },
    {
      pipelineCounts: [
        { pipeline: "Further Works", count: 2 },
        { pipeline: "Other", count: 1 },
      ],
    },
    {
      pipelineCounts: [
        { pipeline: "Open", count: 1 },
        { pipeline: "Open", count: 1 },
      ],
    },
    { statusCounts: [{ status: "Open", count: 3 }] },
    { observedAt: "not-a-date" },
    { hasMore: "false" },
  ])
    assert.throws(() => readOpportunitySourcePage({ ...page, ...changed }, scope));
});

test("empty page requires empty label counts", () => {
  const empty = readOpportunitySourcePage(
    { ...page, recordCount: 0, pipelineCounts: [], statusCounts: [], hasMore: null },
    scope,
  );
  assert.equal(empty.recordCount, 0);
  assert.throws(() =>
    readOpportunitySourcePage(
      {
        ...page,
        recordCount: 0,
        pipelineCounts: [{ pipeline: "Other", count: 1 }],
        statusCounts: [],
      },
      scope,
    ),
  );
});

test("waiting request is bounded and retained outcome is tied to request", () => {
  const now = Date.parse("2026-10-20T00:00:00Z");
  assert.equal(
    readOpportunityWait(
      { state: "waiting", requestId: scope.request, retryAt: now + 30_000 },
      scope.request,
      now,
    ),
    now + 30_000,
  );
  assert.throws(() =>
    readOpportunityWait(
      { state: "waiting", requestId: scope.tenant, retryAt: now + 30_000 },
      scope.request,
      now,
    ),
  );
  assert.throws(() =>
    readOpportunityWait(
      { state: "waiting", requestId: scope.request, retryAt: now + 2 * 86_400_000 },
      scope.request,
      now,
    ),
  );
  assert.deepEqual(
    readOpportunityRetainedState(
      { requestId: scope.request, state: "failed", failureCode: "response_invalid", result: null },
      scope.request,
    ),
    { state: "failed", failureCode: "response_invalid", result: null },
  );
  assert.throws(() =>
    readOpportunityRetainedState(
      { requestId: scope.tenant, state: "complete", failureCode: null, result: page },
      scope.request,
    ),
  );
});
