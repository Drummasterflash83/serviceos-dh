import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScorecardDraft, saveScorecardDraft } from "./learn-scorecard-settings.ts";
import type { ScorecardPolicy } from "./learn-scorecards.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const policy: ScorecardPolicy = {
  id: id(1),
  tenantId: id(2),
  version: 1,
  status: "draft",
  name: "Office",
  subjectKind: "member",
  scaleMax: 50,
  metrics: [
    {
      key: "response.rate",
      label: "Response rate",
      unit: "percent",
      weight: 1,
      zeroAt: 0,
      fullAt: 100,
      minSamples: 5,
      minCoverage: 1,
      maxAgeHours: 24,
      sourceSystems: ["communications"],
    },
  ],
};
function db(data: any[], error: any = null) {
  const filters: any[] = [];
  const q: any = {
    select: () => q,
    eq: (...args: any[]) => {
      filters.push(args);
      return q;
    },
    order: () => q,
    limit: () => q,
    then: (resolve: any) => Promise.resolve({ data, error }).then(resolve),
  };
  return { filters, from: () => q };
}
test("draft reads scope the company and team group, and reject foreign responses", async () => {
  const client = db([{ tenant_id: id(2), value: policy }]);
  assert.deepEqual(await loadScorecardDraft(client, id(2), "member", null), policy);
  assert.ok(client.filters.some((f) => f[0] === "tenant_id" && f[1] === id(2)));
  assert.ok(client.filters.some((f) => f[0] === "scope_ref" && f[1] === "member:all"));
  await assert.rejects(
    loadScorecardDraft(db([{ tenant_id: id(99), value: policy }]), id(2), "member", null),
  );
  await assert.rejects(
    loadScorecardDraft(db([{ tenant_id: id(2), value: policy }]), id(2), "member", id(90)),
  );
  await assert.rejects(loadScorecardDraft(db([], {}), id(2), "member", null));
  assert.equal(await loadScorecardDraft(db([]), id(2), "member", null), null);
});
test("draft save sends an expected revision and reason, and never grants client-supplied publishing authority", async () => {
  let args: any;
  const client = {
    from: () => null,
    rpc: async (name: string, input: any) => {
      assert.equal(name, "learn_scorecard_save_draft");
      args = input;
      return { data: { ...policy, version: 2 }, error: null };
    },
  };
  assert.equal((await saveScorecardDraft(client, policy, 1, "Reviewed weight")).version, 2);
  assert.equal(args.p_expected_version, 1);
  assert.equal(args.p_reason, "Reviewed weight");
  assert.equal(args.p_definition.status, undefined);
  assert.equal(args.p_definition.tenantId, undefined);
  await assert.rejects(
    saveScorecardDraft(
      { ...client, rpc: async () => ({ data: null, error: { code: "40001" } }) },
      policy,
      1,
      "reason",
    ),
    /Reload/,
  );
  await assert.rejects(
    saveScorecardDraft(
      {
        ...client,
        rpc: async () => ({ data: { ...policy, status: "published", version: 2 }, error: null }),
      },
      policy,
      1,
      "reason",
    ),
    /verified/,
  );
});
