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
function db(data: unknown, error: any = null) {
  const calls: any[] = [];
  return { calls, from: () => { throw Error("Draft reader must use revision RPC"); },
    rpc: async (name: string, args: unknown) => { calls.push({name,args}); return {data,error}; } };
}
test("draft reads use the authoritative revision reader and reject foreign or non-draft responses", async () => {
  const client = db(policy);
  assert.deepEqual(await loadScorecardDraft(client, id(2), "member", null), policy);
  assert.deepEqual(client.calls, [{name:"learn_scorecard_read_draft",args:{p_tenant:id(2),p_kind:"member",p_group:null}}]);
  await assert.rejects(loadScorecardDraft(db({...policy,tenantId:id(99)}), id(2), "member", null));
  await assert.rejects(loadScorecardDraft(db(policy), id(2), "member", id(90)));
  await assert.rejects(loadScorecardDraft(db({...policy,status:"published"}), id(2), "member", null));
  await assert.rejects(loadScorecardDraft(db(null, {}), id(2), "member", null));
  assert.equal(await loadScorecardDraft(db(null), id(2), "member", null), null);
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
  await assert.rejects(
    saveScorecardDraft(
      { ...client, rpc: async () => ({ data: { ...policy, id: id(99), version: 2 }, error: null }) },
      policy,
      1,
      "reason",
    ),
    /verified/,
  );
  // Initial creation may replace the temporary local ID with the server's ID.
  assert.equal(
    (await saveScorecardDraft(
      { ...client, rpc: async () => ({ data: { ...policy, id: id(99) }, error: null }) },
      policy,
      0,
      "Initial creation",
    )).id,
    id(99),
  );
});
