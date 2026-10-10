import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readRecurringChannels,
  readSavedRecurring,
  resolveSavedRecurring,
  recurringOutboxKey,
  type SavedRecurring,
  type RecurringReceipt,
} from "./learn-slack-recurring.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { tenantId: id(1), actorId: id(2), backend: "https://synthetic.invalid" };
const draft: SavedRecurring = {
  version: 1,
  backend: scope.backend,
  label: "Synthetic channel",
  request: {
    tenantId: id(1),
    actorId: id(2),
    requestId: id(3),
    accountId: id(4),
    revision: 0,
    enabled: true,
    reason: "Keep approved channel current",
  },
};
const channel = {
  accountId: id(4),
  name: "Synthetic channel",
  teamId: "TDEMO",
  channelId: "CDEMO",
  enabled: false,
  revision: 0,
  state: "not_configured",
  nextStart: null,
  nextCheckAt: null,
  updatedAt: null,
  completeVerified: true,
  pausedWindow: false,
};
function fixture() {
  const saved = new Map<string, string>();
  const calls: any[] = [];
  let writable = true,
    lose = false;
  let receipt: RecurringReceipt = {
    tenantId: id(1),
    requestId: id(3),
    accountId: id(4),
    state: "pending",
  };
  const page = {
    version: "learn-slack-recurring/1",
    tenantId: id(1),
    canWrite: true,
    channels: [channel],
    next: null,
  };
  const store = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => {
      saved.set(k, v);
    },
    removeItem: (k: string) => {
      saved.delete(k);
    },
  };
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "learn_slack_recurring_read")
        return { data: { ...page, canWrite: writable }, error: null };
      if (receipt.state === "pending" && args.p_mode === "apply") {
        receipt = { ...receipt, state: "recorded", enabled: true, revision: 1 };
        if (lose) throw Error("PRIVATE DETAIL");
      } else if (receipt.state === "pending" && args.p_mode === "cancel")
        receipt = { ...receipt, state: "cancelled" };
      return { data: receipt, error: null };
    },
  };
  return {
    saved,
    store,
    db,
    calls,
    page,
    deny: () => (writable = false),
    lose: () => (lose = true),
    run: (mode: "apply" | "check" | "cancel" = "apply", input = draft, allowed = () => true) =>
      resolveSavedRecurring(db, store, async (_key, task) => task(), scope, input, mode, allowed),
  };
}
test("lost response recovers retained receipt without a duplicate apply", async () => {
  const f = fixture();
  f.lose();
  await assert.rejects(f.run(), (e) => e instanceof Error && !e.message.includes("PRIVATE"));
  assert.deepEqual(readSavedRecurring(f.store, scope), draft);
  assert.equal((await f.run("check")).state, "recorded");
  assert.equal(f.saved.size, 0);
  assert.equal(f.calls.filter((c) => c.args.p_mode === "apply").length, 1);
  assert.equal(f.calls.find((c) => c.args.p_mode === "apply").args.p_actor, scope.actorId);
});
test("checking pending work never applies it; cancellation clears the saved request", async () => {
  const f = fixture();
  assert.equal((await f.run("check")).state, "pending");
  assert.equal(f.saved.size, 1);
  assert.ok(!f.calls.some((c) => c.args.p_mode === "apply"));
  assert.equal((await f.run("cancel")).state, "cancelled");
  assert.equal(f.saved.size, 0);
  assert.equal((await f.run()).state, "cancelled");
  assert.ok(!f.calls.some((c) => c.args.p_mode === "apply"));
});
test("session, storage, current permission and conflicting-request failures prevent writes", async () => {
  const f = fixture();
  await assert.rejects(f.run("apply", draft, () => false));
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.run("apply", { ...draft, backend: "https://another.invalid" }));
  assert.equal(f.saved.size, 0);
  f.store.setItem = () => {
    throw Error("storage blocked");
  };
  await assert.rejects(f.run());
  assert.equal(f.calls.length, 0);
  const g = fixture();
  g.deny();
  await assert.rejects(g.run(), /access/);
  assert.equal(g.saved.size, 1);
  assert.equal(g.calls.length, 1);
  const h = fixture();
  h.saved.set(
    recurringOutboxKey(scope),
    JSON.stringify({ ...draft, request: { ...draft.request, requestId: id(5) } }),
  );
  await assert.rejects(h.run(), /existing/);
  assert.equal(h.calls.length, 0);
});
test("unknown fields cannot persist secrets with the recovery request", async () => {
  for (const v of [
    { ...draft, token: "secret" },
    { ...draft, request: { ...draft.request, token: "secret" } },
  ]) {
    const f = fixture();
    await assert.rejects(f.run("apply", v));
    assert.equal(f.saved.size, 0);
    assert.equal(f.calls.length, 0);
  }
});
test("scoped read rejects disorder, missing counts and invalid pagination; strips extra fields", async () => {
  const f = fixture();
  for (const change of [
    { tenantId: id(9) },
    { canWrite: null },
    { channels: [channel, channel] },
    { next: id(8) },
    { channels: [{ ...channel, enabled: true }] },
  ]) {
    await assert.rejects(
      readRecurringChannels(
        { rpc: async () => ({ data: { ...f.page, ...change }, error: null }) },
        scope.tenantId,
      ),
    );
  }
  const r = await readRecurringChannels(
    {
      rpc: async () => ({
        data: { ...f.page, secret: "PRIVATE", channels: [{ ...channel, secret: "PRIVATE" }] },
        error: null,
      }),
    },
    scope.tenantId,
  );
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  const channels = Array.from({ length: 50 }, (_, i) => ({ ...channel, accountId: id(100 + i) }));
  const page = await readRecurringChannels(
    { rpc: async () => ({ data: { ...f.page, channels, next: id(149) }, error: null }) },
    scope.tenantId,
  );
  assert.equal(page.next, id(149));
});
test("mismatched result keeps recovery; actor change after the response does not clear it", async () => {
  const f = fixture();
  f.db.rpc = async (name, args) =>
    name === "learn_slack_recurring_read"
      ? { data: f.page, error: null }
      : {
          data: {
            tenantId: id(9),
            requestId: id(3),
            accountId: id(4),
            state: "recorded",
            enabled: true,
            revision: 1,
          },
          error: null,
        };
  await assert.rejects(f.run("check"));
  assert.equal(f.saved.size, 1);
  const g = fixture();
  let active = true;
  const original = g.db.rpc;
  g.db.rpc = async (name, args) => {
    const r = await original(name, args);
    if (args.p_mode === "apply") active = false;
    return r;
  };
  await assert.rejects(
    g.run("apply", draft, () => active),
    /context changed/,
  );
  assert.equal(g.saved.size, 1);
});

test("thread requests share durable recovery but use their own RPC and cannot replace pending channel work", async () => {
  const t: SavedRecurring = {
    ...draft,
    request: { ...draft.request, kind: "threads", revision: 1 },
  };
  const f = fixture();
  f.lose();
  const original = f.db.rpc;
  f.db.rpc = async (name, args) => {
    const r = await original(name, args);
    if (r.data && "state" in r.data && r.data.state === "recorded")
      r.data = { ...r.data, revision: 2 };
    return r;
  };
  await assert.rejects(f.run("apply", t));
  assert.equal(readSavedRecurring(f.store, scope)?.request.kind, "threads");
  assert.equal((await f.run("check", t)).state, "recorded");
  assert.equal(f.calls.filter((c) => c.args.p_mode === "apply").length, 1);
  assert.ok(
    f.calls
      .filter((c) => c.args.p_mode)
      .every((c) => c.name === "learn_slack_recurring_threads_control"),
  );
  const pending = fixture();
  await pending.run("check");
  await assert.rejects(pending.run("apply", t), /existing/);
  const cancelled = fixture();
  assert.equal((await cancelled.run("cancel", t)).state, "cancelled");
  assert.equal((await cancelled.run("apply", t)).state, "cancelled");
  assert.ok(!cancelled.calls.some((c) => c.args.p_mode === "apply"));
  for (const bad of [
    { ...t, request: { ...t.request, kind: "unknown" } },
    { ...t, request: { ...t.request, revision: 0 } },
  ]) {
    const g = fixture();
    await assert.rejects(g.run("apply", bad as SavedRecurring));
    assert.equal(g.calls.length, 0);
  }
});
test("thread status is unknown on old backends and strictly validates coverage before displaying counts", async () => {
  const f = fixture();
  assert.equal((await readRecurringChannels(f.db, scope.tenantId)).channels[0].threads, null);
  const status = {
    enabled: true,
    canEnable: false,
    discoveryComplete: false,
    observed: 23,
    completed: 4,
  };
  const page = (threads: any) => ({
    rpc: async () => ({ error: null, data: { ...f.page, channels: [{ ...channel, threads }] } }),
  });
  assert.deepEqual(
    (await readRecurringChannels(page({ ...status, secret: "PRIVATE" }), scope.tenantId))
      .channels[0].threads,
    status,
  );
  for (const bad of [
    null,
    {},
    { ...status, observed: -1 },
    { ...status, completed: 24 },
    { ...status, completed: null },
    { ...status, discoveryComplete: null },
    { ...status, enabled: 1 },
  ])
    await assert.rejects(readRecurringChannels(page(bad), scope.tenantId));
  assert.deepEqual(
    (
      await readRecurringChannels(
        page({
          enabled: false,
          canEnable: true,
          discoveryComplete: null,
          observed: null,
          completed: null,
        }),
        scope.tenantId,
      )
    ).channels[0].threads,
    { enabled: false, canEnable: true, discoveryComplete: null, observed: null, completed: null },
  );
});
