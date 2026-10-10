import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readThreadRecoveryDraft,
  prepareThreadRecoveryDraft,
  submitThreadRecoveryDraft,
  threadRecoveryOutboxKey,
  type ThreadRecoveryScope,
  type ThreadRecoveryLock,
} from "./learn-slack-thread-recovery-outbox.ts";
import type { SlackThreadRecoveryState } from "./learn-slack-thread-recovery.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: ThreadRecoveryScope = {
  backend: "https://example.supabase.co",
  actorId: id(1),
  tenantId: id(2),
};
const state: SlackThreadRecoveryState = {
  version: "learn-slack-thread-recovery/1",
  tenantId: id(2),
  accountId: id(3),
  parentTimestamp: "1767225700.000001",
  supersededBy: null,
  teamId: "TTEST",
  channelId: "CTEST",
  importId: id(4),
  approvedAt: "2026-01-02T00:00:00Z",
  previousImportId: null,
  recoveryMode: null,
  stateVersion: "a".repeat(64),
  stateValid: true,
  active: false,
  canContinue: true,
  canRestart: true,
  window: {
    start: "2026-01-01T00:00:00Z",
    end: "2026-01-02T00:00:00Z",
    pageLimit: 1,
    expiresAt: "2026-01-03T00:00:00Z",
  },
  progress: { pagesThisApproval: 1, complete: false, hasCursor: true },
  latestJob: null,
  coverage: "observed_thread_window",
};
const draft = () =>
  prepareThreadRecoveryDraft(scope, state, {
    requestId: id(5),
    tenantId: id(2),
    accountId: id(3),
    importId: id(4),
    stateVersion: state.stateVersion,
    mode: "continue",
    maxPages: 2,
    reason: "Reviewed continuation",
  });
const receipt = {
  requestId: id(5),
  accountId: id(3),
  previousImportId: id(4),
  jobId: id(6),
  reused: false,
};
const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
};
const lock: ThreadRecoveryLock = async (_key, task) => task();
test("lost response survives reload and scope isolation; exact receipt clears saved request", async () => {
  const storage = store(),
    d = draft(),
    calls: unknown[] = [];
  let lost = true;
  const db = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      assert.equal(readThreadRecoveryDraft(storage, scope)?.request.requestId, id(5));
      if (lost) {
        lost = false;
        throw Error("Lost after commit");
      }
      return { data: { ...receipt, reused: true }, error: null };
    },
  };
  await assert.rejects(
    submitThreadRecoveryDraft(db, storage, lock, scope, d, () => true),
    /not confirmed/,
  );
  const restored = readThreadRecoveryDraft(storage, scope)!;
  assert.deepEqual(restored, d);
  for (const changed of [
    { actorId: id(7) },
    { tenantId: id(7) },
    { backend: "https://another.supabase.co" },
  ])
    assert.equal(readThreadRecoveryDraft(storage, { ...scope, ...changed }), null);
  assert.equal(
    (await submitThreadRecoveryDraft(db, storage, lock, scope, restored, () => true)).reused,
    true,
  );
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(readThreadRecoveryDraft(storage, scope), null);
});
test("storage failure and missing authority send no request", async () => {
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return { data: receipt, error: null };
    },
  };
  for (const storage of [
    {
      ...store(),
      setItem: () => {
        throw Error("Quota");
      },
    },
    { ...store(), setItem: () => {} },
  ])
    await assert.rejects(submitThreadRecoveryDraft(db, storage, lock, scope, draft(), () => true));
  await assert.rejects(
    submitThreadRecoveryDraft(db, store(), lock, scope, draft(), () => false),
    /access/,
  );
  assert.equal(calls, 0);
});
test("two tabs serialize and cannot replace an unresolved review", async () => {
  const storage = store(),
    first = draft(),
    second = { ...first, request: { ...first.request, requestId: id(8) } };
  let tail = Promise.resolve(),
    calls = 0;
  const serialized: ThreadRecoveryLock = (_key, task) => {
    const next = tail.then(task);
    tail = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const db = {
    rpc: async () => {
      calls++;
      return { data: null, error: { code: "network" } };
    },
  };
  const results = await Promise.allSettled([
    submitThreadRecoveryDraft(db, storage, serialized, scope, first, () => true),
    submitThreadRecoveryDraft(db, storage, serialized, scope, second, () => true),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "rejected");
  assert.equal(calls, 1);
  assert.deepEqual(readThreadRecoveryDraft(storage, scope), first);
});
test("altered, malformed and foreign saved records are not sent or silently erased", async () => {
  const storage = store(),
    d = draft(),
    key = threadRecoveryOutboxKey(scope);
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return { data: receipt, error: null };
    },
  };
  for (const value of [
    "{bad",
    JSON.stringify({ ...d, actorId: id(9) }),
    JSON.stringify({ ...d, request: { ...d.request, stateVersion: "bad" } }),
  ]) {
    storage.setItem(key, value);
    assert.throws(() => readThreadRecoveryDraft(storage, scope));
    await assert.rejects(submitThreadRecoveryDraft(db, storage, lock, scope, d, () => true));
    assert.equal(storage.getItem(key), value);
  }
  storage.setItem(key, JSON.stringify(d));
  await assert.rejects(
    submitThreadRecoveryDraft(
      db,
      storage,
      lock,
      scope,
      { ...d, request: { ...d.request, reason: "Changed" } },
      () => true,
    ),
    /Another saved recovery/,
  );
  assert.equal(calls, 0);
});
test("unconfirmed receipt and permission revocation retain the exact saved request", async () => {
  for (const response of [
    { data: { ...receipt, jobId: "bad" }, error: null },
    { data: null, error: { code: "42501" } },
  ]) {
    const storage = store(),
      d = draft();
    await assert.rejects(
      submitThreadRecoveryDraft({ rpc: async () => response }, storage, lock, scope, d, () => true),
    );
    assert.deepEqual(readThreadRecoveryDraft(storage, scope), d);
  }
});
test("new reviews must match eligible company/account/version; storage carries no source payload", () => {
  for (const change of [
    { tenantId: id(9) },
    { importId: id(9) },
    { supersededBy: id(9) },
    { active: true },
    { canContinue: false },
    { stateVersion: "b".repeat(64) },
  ])
    assert.throws(() =>
      prepareThreadRecoveryDraft(scope, { ...state, ...change }, draft().request),
    );
  const storage = store(),
    d = draft();
  storage.setItem(
    threadRecoveryOutboxKey(scope),
    JSON.stringify({
      ...d,
      secret_refs: { token: "private" },
      review: { ...d.review, cursor: "private" },
    }),
  );
  assert.deepEqual(readThreadRecoveryDraft(storage, scope), d);
});

test("closing or losing authority after saving does not send; rejected clear cannot erase a replacement", async () => {
  const storage = store(),
    d = draft();
  let permissionChecks = 0,
    calls = 0;
  await assert.rejects(
    submitThreadRecoveryDraft(
      {
        rpc: async () => {
          calls++;
          return { data: receipt, error: null };
        },
      },
      storage,
      lock,
      scope,
      d,
      () => ++permissionChecks === 1,
    ),
    /has not been sent/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(readThreadRecoveryDraft(storage, scope), d);
  const { discardRejectedThreadRecovery } = await import("./learn-slack-thread-recovery-outbox.ts");
  await assert.rejects(discardRejectedThreadRecovery(storage, lock, scope, id(9)), /changed/);
  assert.deepEqual(readThreadRecoveryDraft(storage, scope), d);
  await discardRejectedThreadRecovery(storage, lock, scope, d.request.requestId);
  assert.equal(readThreadRecoveryDraft(storage, scope), null);
});
