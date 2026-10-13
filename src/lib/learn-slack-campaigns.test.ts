import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareCampaign,
  resolveCampaign,
  readSavedCampaign,
  campaignKey,
  readCampaign,
  listCampaigns,
  type CampaignDraft,
} from "./learn-slack-campaigns.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { tenantId: id(1), actorId: id(2), backend: "https://synthetic.invalid" };
const draft: CampaignDraft = {
  version: 1,
  ...scope,
  requestId: id(3),
  operation: "start",
  input: {
    connectionId: id(4),
    connectionRevision: "2026-01-01T00:00:00Z",
    channelIds: ["CPUBLIC"],
    start: "2016-01-01T00:00:00Z",
    end: "2026-01-01T00:00:00Z",
    expiresAt: "2026-10-20T00:00:00Z",
    requestBudget: 1000,
    reason: "Historical context",
  },
};
function fixture() {
  const data = new Map<string, string>(),
    calls: any[] = [];
  let lost = false,
    access = true,
    receipt: any = { tenantId: id(1), requestId: id(3), state: "pending" };
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  const db = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "learn_slack_campaign_list")
        return {
          data: {
            version: "learn-slack-campaign-list/1",
            tenantId: id(1),
            canWrite: access,
            campaigns: [],
            next: null,
          },
          error: null,
        };
      if (args.p_mode === "apply") {
        receipt = { ...receipt, state: "recorded", campaignId: id(3), revision: 1 };
        if (lost) throw Error("PRIVATE SERVER CONTENT");
      }
      if (args.p_mode === "cancel" && receipt.state === "pending")
        receipt = { ...receipt, state: "cancelled" };
      return { data: receipt, error: null };
    },
  };
  return {
    data,
    calls,
    store,
    db,
    lose: () => {
      lost = true;
    },
    deny: () => {
      access = false;
    },
    run: (mode: "check" | "apply" | "cancel" = "apply", d = draft, allowed = () => true) =>
      resolveCampaign(db, store, async (_, f) => f(), scope, d, mode, allowed),
  };
}
test("lost acknowledgement retains immutable request and checks receipt without second apply", async () => {
  const f = fixture();
  f.lose();
  await assert.rejects(f.run(), (e) => e instanceof Error && !e.message.includes("PRIVATE"));
  assert.deepEqual(readSavedCampaign(f.store, scope), draft);
  assert.equal((await f.run("check")).state, "recorded");
  assert.equal(f.data.size, 0);
  assert.equal(f.calls.filter((c) => c.args.p_mode === "apply").length, 1);
  assert.equal(f.calls.at(-1).args.p_actor, scope.actorId);
});
test("pending cancellation prevents a subsequent same-request apply", async () => {
  const f = fixture();
  assert.equal((await f.run("cancel")).state, "cancelled");
  assert.equal((await f.run()).state, "cancelled");
  assert.equal(f.calls.filter((c) => c.args.p_mode === "apply").length, 0);
});
test("another saved request cannot replace an unresolved one", async () => {
  const f = fixture();
  await f.run("check");
  await assert.rejects(f.run("apply", { ...draft, requestId: id(8) }), /existing saved/);
  assert.equal(readSavedCampaign(f.store, scope)?.requestId, id(3));
});
test("changed actor/backend/company cannot dispatch or delete saved intent", async () => {
  const f = fixture();
  await f.run("check");
  for (const change of [
    { actorId: id(9) },
    { tenantId: id(9) },
    { backend: "https://different.invalid" },
  ])
    await assert.rejects(f.run("apply", { ...draft, ...change }), /changed/);
  assert.equal(f.calls.filter((c) => c.args.p_mode === "apply").length, 0);
  assert.ok(readSavedCampaign(f.store, scope));
});
test("server access loss and corrupt browser storage fail closed", async () => {
  const f = fixture();
  f.deny();
  await assert.rejects(f.run(), /editing access/);
  assert.equal(f.calls.length, 1);
  assert.ok(readSavedCampaign(f.store, scope));
  f.data.set(campaignKey(scope), "broken");
  await assert.rejects(f.run(), /could not be verified/);
  assert.equal(f.data.get(campaignKey(scope)), "broken");
});
test("scope changes between check and apply prevent dispatch", async () => {
  const f = fixture();
  let checks = 0;
  await assert.rejects(
    f.run("apply", draft, () => ++checks < 3),
    /changed/,
  );
  assert.equal(f.calls.filter((c) => c.args.p_mode === "apply").length, 0);
  assert.ok(readSavedCampaign(f.store, scope));
});
test("expired saved start can still check its committed receipt", async () => {
  const f = fixture();
  const d = structuredClone(draft);
  if (d.operation === "start") d.input.expiresAt = "2020-01-01";
  assert.equal((await f.run("check", d)).state, "pending");
  assert.throws(() => prepareCampaign(d), /expiry/);
});
test("preparation requires past fixed dates, distinct public channel identifiers and bounded allowance", () => {
  const now = Date.parse("2026-10-13");
  assert.deepEqual(prepareCampaign(draft, now), draft);
  for (const change of [
    { channelIds: ["CPUBLIC", "CPUBLIC"] },
    { channelIds: ["DPRIVATE"] },
    { requestBudget: 1000001 },
    { end: "2027-01-01" },
  ])
    assert.throws(() =>
      prepareCampaign({ ...draft, input: { ...draft.input, ...change } } as CampaignDraft, now),
    );
});
const progress: any = {
  version: "learn-slack-campaign/1",
  tenantId: id(1),
  campaignId: id(3),
  revision: 1,
  enabled: true,
  start: "2016-01-01",
  end: "2026-01-01",
  expiresAt: "2026-10-20",
  requestBudget: 100,
  requestsReserved: 50,
  complete: false,
  threadsComplete: false,
  coverage: "fixed_window_observed_threads",
  requestAccounting: "conservative_dispatch_reservations",
  channels: [
    {
      accountId: id(5),
      channelId: "CPUBLIC",
      state: "thread_active",
      channelPagesComplete: true,
      discoveryComplete: true,
      observedThreads: 2,
      completedThreads: 1,
      threadsComplete: false,
      complete: false,
    },
  ],
};
test("progress rejects false completeness, duplicate channels and foreign identity", async () => {
  const db = (data: any) => ({ rpc: async () => ({ data, error: null }) });
  assert.equal((await readCampaign(db(progress), id(1), id(3))).complete, false);
  for (const bad of [
    { ...progress, complete: true },
    { ...progress, tenantId: id(9) },
    { ...progress, channels: [...progress.channels, ...progress.channels] },
    { ...progress, channels: [{ ...progress.channels[0], completedThreads: 3 }] },
  ])
    await assert.rejects(readCampaign(db(bad), id(1), id(3)), /could not be verified/);
});
test("list rejects a forged pagination cursor and unordered duplicates", async () => {
  const row = {
    campaignId: id(3),
    start: "2016-01-01",
    end: "2026-01-01",
    enabled: true,
    lifecycle: "open",
    channelCount: 1,
  };
  for (const page of [
    { campaigns: [row], next: id(9) },
    { campaigns: [row, row], next: null },
  ])
    await assert.rejects(
      listCampaigns(
        {
          rpc: async () => ({
            data: {
              version: "learn-slack-campaign-list/1",
              tenantId: id(1),
              canWrite: true,
              ...page,
            },
            error: null,
          }),
        },
        id(1),
      ),
    );
});
