import test from "node:test";
import assert from "node:assert/strict";
import {
  publishScorecard,
  loadPublishedScorecard,
  loadRevisionPublication,
} from "./learn-scorecard-publication.ts";
import {
  evaluateScorecard,
  validateScorecardPolicy,
  type ScorecardPolicy,
} from "./learn-scorecards.ts";
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const draft: ScorecardPolicy = {
  id: id(1),
  tenantId: id(2),
  version: 3,
  status: "draft",
  subjectKind: "member",
  name: "Saved rules",
  scaleMax: 50,
  metrics: [
    {
      key: "work.recorded_handoffs",
      label: "Recorded handoffs",
      unit: "handoffs",
      weight: 1,
      zeroAt: 0,
      fullAt: 5,
      minSamples: 1,
      minCoverage: 1,
      maxAgeHours: 24,
      sourceSystems: ["serviceos.work.handoffs@1"],
    },
  ],
};
const published: ScorecardPolicy = {
  ...draft,
  status: "published",
  publication: {
    id: id(4),
    effectiveFrom: "2026-10-01T12:00:00Z",
    effectiveUntil: "2026-10-04T12:00:00Z",
  },
};
const period = { start: "2026-10-02T00:00:00Z", end: "2026-10-03T00:00:00Z" };
const receipt = {
  publicationId: id(5),
  policyId: id(1),
  revision: 3,
  effectiveFrom: "2026-10-09T00:00:00Z",
  reused: false,
};
const db = (data: any, error: any = null): any => ({
  from: () => null,
  rpc: async () => ({ data, error }),
});
test("publication submits a saved identity and reason; definition and backdating are server-owned", async () => {
  let sent: any;
  const client = {
    ...db(receipt),
    rpc: async (name: string, args: any) => {
      sent = { name, args };
      return { data: receipt, error: null };
    },
  };
  assert.deepEqual(
    await publishScorecard(client, {
      policy: draft,
      requestId: id(5),
      reason: " Reviewed requirements ",
    }),
    receipt,
  );
  assert.equal(sent.name, "learn_scorecard_publish");
  assert.deepEqual(sent.args, {
    p_tenant: id(2),
    p_policy: id(1),
    p_revision: 3,
    p_request: id(5),
    p_reason: "Reviewed requirements",
  });
  await assert.rejects(
    () =>
      publishScorecard(db({ ...receipt, revision: 2 }), {
        policy: draft,
        requestId: id(5),
        reason: "Reason",
      }),
    /receipt/,
  );
  await assert.rejects(
    () =>
      publishScorecard(db(null, { code: "40001" }), {
        policy: draft,
        requestId: id(5),
        reason: "Reason",
      }),
    /Reload/,
  );
  await assert.rejects(() =>
    publishScorecard(db(receipt), { policy: published, requestId: id(5), reason: "Reason" }),
  );
});
test("published reads bind exact scope and refuse drafts, foreign rules or boundary crossings", async () => {
  assert.deepEqual(
    await loadPublishedScorecard(db(published), id(2), "member", null, period),
    published,
  );
  assert.equal(await loadPublishedScorecard(db(null), id(2), "member", null, period), null);
  for (const p of [
    draft,
    { ...published, tenantId: id(99) },
    { ...published, groupId: id(88) },
    { ...published, publication: undefined },
    { ...published, publication: { ...published.publication, effectiveFrom: period.end } },
  ])
    await assert.rejects(() => loadPublishedScorecard(db(p), id(2), "member", null, period));
  await assert.rejects(
    () => loadPublishedScorecard(db(null, { code: "22023" }), id(2), "member", null, period),
    /rule change/,
  );
});
test("scorer rejects a published label without a verified interval and enforces both boundaries", () => {
  const subject = { kind: "member", id: id(3) } as const;
  assert.ok(validateScorecardPolicy({ ...published, publication: undefined }).length);
  assert.throws(
    () =>
      evaluateScorecard(published, subject, { start: "2026-10-01T00:00:00Z", end: period.end }, []),
    /interval/,
  );
  assert.throws(
    () =>
      evaluateScorecard(
        published,
        subject,
        { start: period.start, end: "2026-10-05T00:00:00Z" },
        [],
      ),
    /interval/,
  );
  assert.equal(
    evaluateScorecard(
      published,
      subject,
      { start: period.start, end: published.publication!.effectiveUntil! },
      [],
    ).state,
    "incomplete",
  );
});
test("saved revision publication metadata is tenant/revision checked", async () => {
  const record = {
    id: id(5),
    tenant_id: id(2),
    policy_id: id(1),
    revision: 3,
    effective_from: receipt.effectiveFrom,
  };
  const client = (rows: any[]): any => ({
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        then: (f: any) => Promise.resolve({ data: rows, error: null }).then(f),
      };
      return q;
    },
  });
  assert.equal(await loadRevisionPublication(client([record]), draft), receipt.effectiveFrom);
  assert.equal(await loadRevisionPublication(client([]), draft), null);
  await assert.rejects(() => loadRevisionPublication(client([{ ...record, revision: 2 }]), draft));
  await assert.rejects(() => loadRevisionPublication(client([record, record]), draft));
});
