import test from "node:test";
import assert from "node:assert/strict";
import {
  delayOutboxKey,
  prepareDelayDraft,
  readDelayDraft,
  recoverDelayDraft,
  type DelayRecoveryLock,
} from "./learn-work-delay-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  backend: "https://synthetic.invalid",
  tenantId: id(1),
  actorId: id(2),
  objectId: id(3),
};
const period = { start: "2026-10-05T09:00:00Z", end: "2026-10-05T10:00:00Z" };
const approval = prepareDelayDraft(scope, id(4), {
  objectId: scope.objectId,
  expectedRevision: 0,
  decision: "approve",
  approvalId: null,
  period,
  label: "Supplier wait",
  evidenceIds: [id(5)],
  reason: "Owner reviewed delay",
});
const reversal = prepareDelayDraft(scope, id(6), {
  objectId: scope.objectId,
  expectedRevision: 1,
  decision: "reverse",
  approvalId: id(4),
  period: null,
  label: null,
  evidenceIds: [],
  reason: "Corrected attribution",
});
const lock: DelayRecoveryLock = async (_key, fn) => fn();
function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
for (const draft of [approval, reversal]) {
  test(`${draft.payload.decision}: a lost committed reply survives reload without a duplicate`, async () => {
    const storage = memory();
    let recorded = false,
      writes = 0;
    const db = {
      rpc: async (name: string, args: any) => {
        assert.deepEqual(readDelayDraft(storage, scope), draft);
        assert.equal(args.p_request, draft.requestId);
        assert.deepEqual(args.p_payload, draft.payload);
        if (name === "learn_work_delay_record") {
          recorded = true;
          writes++;
          throw Error("Lost committed reply");
        }
        return {
          error: null,
          data: {
            contract: "work-delay-resolution@1",
            tenantId: scope.tenantId,
            actorId: scope.actorId,
            requestId: draft.requestId,
            payload: draft.payload,
            state: recorded ? "recorded" : "pending",
            recordedAt: recorded ? "2026-10-05T11:00:00Z" : null,
          },
        };
      },
    };
    await assert.rejects(
      recoverDelayDraft(db, storage, lock, scope, draft, "submit", () => true),
      /Lost committed/,
    );
    assert.equal(
      (
        await recoverDelayDraft(
          db,
          storage,
          lock,
          scope,
          readDelayDraft(storage, scope)!,
          "submit",
          () => true,
        )
      ).state,
      "recorded",
    );
    assert.equal(writes, 1);
    assert.equal(readDelayDraft(storage, scope), null);
  });
  test(`${draft.payload.decision}: check never writes; cancellation needs a retained terminal receipt`, async () => {
    const storage = memory();
    let calls = 0;
    const db = {
      rpc: async (name: string, args: any) => {
        calls++;
        assert.equal(name, "learn_work_delay_resolve");
        return {
          error: null,
          data: {
            contract: "work-delay-resolution@1",
            tenantId: scope.tenantId,
            actorId: scope.actorId,
            requestId: draft.requestId,
            payload: draft.payload,
            state: args.p_cancel ? "cancelled" : "pending",
            recordedAt: args.p_cancel ? "2026-10-05T11:00:00Z" : null,
          },
        };
      },
    };
    assert.equal(
      (await recoverDelayDraft(db, storage, lock, scope, draft, "check", () => true)).state,
      "pending",
    );
    assert.deepEqual(readDelayDraft(storage, scope), draft);
    assert.equal(
      (await recoverDelayDraft(db, storage, lock, scope, draft, "cancel", () => true)).state,
      "cancelled",
    );
    assert.equal(calls, 2);
    assert.equal(readDelayDraft(storage, scope), null);
  });
}
test("approval and reversal share a slot, isolated by work item, actor, tenant and backend", async () => {
  const storage = memory();
  storage.setItem(delayOutboxKey(scope), JSON.stringify(approval));
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      throw Error("Unexpected call");
    },
  };
  await assert.rejects(
    recoverDelayDraft(db, storage, lock, scope, reversal, "submit", () => true),
    /Another delay change/,
  );
  for (const other of [
    { ...scope, objectId: id(10) },
    { ...scope, tenantId: id(10) },
    { ...scope, actorId: id(10) },
    { ...scope, backend: "https://other.invalid" },
  ]) {
    assert.equal(readDelayDraft(storage, other), null);
    await assert.rejects(
      recoverDelayDraft(db, storage, lock, other, approval, "submit", () => true),
    );
  }
  assert.equal(calls, 0);
});
test("invalid storage or inability to retain the request prevents all network calls", async () => {
  const storage = memory();
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      throw Error("Unexpected call");
    },
  };
  for (const raw of [
    "{",
    JSON.stringify({ ...approval, extra: true }),
    JSON.stringify({ ...approval, payload: { ...approval.payload, extra: true } }),
    "x".repeat(35001),
  ]) {
    storage.setItem(delayOutboxKey(scope), raw);
    await assert.rejects(
      recoverDelayDraft(db, storage, lock, scope, approval, "submit", () => true),
    );
    assert.equal(storage.getItem(delayOutboxKey(scope)), raw);
  }
  storage.removeItem(delayOutboxKey(scope));
  await assert.rejects(
    recoverDelayDraft(
      db,
      {
        ...storage,
        setItem: () => {
          throw Error("Storage denied");
        },
      },
      lock,
      scope,
      approval,
      "submit",
      () => true,
    ),
  );
  assert.equal(calls, 0);
});
test("authority or storage changes during status prevent a subsequent approval call", async () => {
  for (const change of ["access", "storage"]) {
    const storage = memory();
    let allowed = true,
      calls = 0;
    const db = {
      rpc: async () => {
        calls++;
        if (change === "access") allowed = false;
        else storage.setItem(delayOutboxKey(scope), JSON.stringify(reversal));
        return {
          error: null,
          data: {
            contract: "work-delay-resolution@1",
            tenantId: scope.tenantId,
            actorId: scope.actorId,
            requestId: approval.requestId,
            payload: approval.payload,
            state: "pending",
            recordedAt: null,
          },
        };
      },
    };
    await assert.rejects(
      recoverDelayDraft(db, storage, lock, scope, approval, "submit", () => allowed),
    );
    assert.equal(calls, 1);
    assert.ok(storage.getItem(delayOutboxKey(scope)));
  }
});
test("a failed or mismatched status never clears saved intent", async () => {
  for (const result of [
    { data: null, error: { code: "PT409" } },
    {
      error: null,
      data: {
        contract: "work-delay-resolution@1",
        tenantId: scope.tenantId,
        actorId: scope.actorId,
        requestId: approval.requestId,
        payload: { ...approval.payload, reason: "Changed" },
        state: "recorded",
        recordedAt: "2026-10-05T11:00:00Z",
      },
    },
  ]) {
    const storage = memory();
    await assert.rejects(
      recoverDelayDraft(
        { rpc: async () => result },
        storage,
        lock,
        scope,
        approval,
        "check",
        () => true,
      ),
    );
    assert.deepEqual(readDelayDraft(storage, scope), approval);
  }
});

test("losing authority after recording stops follow-up calls and retains the exact request", async () => {
  const storage = memory();
  let allowed = true,
    calls = 0;
  const db = {
    rpc: async (name: string) => {
      calls++;
      if (name === "learn_work_delay_record") {
        allowed = false;
        return {
          error: null,
          data: {
            contract: "work-delay-record@1",
            entry: {
              id: approval.requestId,
              tenantId: scope.tenantId,
              objectId: scope.objectId,
              revision: 1,
              decision: "approve",
              approvalId: null,
              period,
              label: approval.payload.label,
              reason: approval.payload.reason,
              evidenceIds: approval.payload.evidenceIds,
              recordedBy: scope.actorId,
              recordedAt: "2026-10-05T11:00:00Z",
            },
          },
        };
      }
      return {
        error: null,
        data: {
          contract: "work-delay-resolution@1",
          tenantId: scope.tenantId,
          actorId: scope.actorId,
          requestId: approval.requestId,
          payload: approval.payload,
          state: "pending",
          recordedAt: null,
        },
      };
    },
  };
  await assert.rejects(
    recoverDelayDraft(db, storage, lock, scope, approval, "submit", () => allowed),
  );
  assert.equal(calls, 2);
  assert.deepEqual(readDelayDraft(storage, scope), approval);
});
test("terminal browser cleanup failure remains recoverable", async () => {
  const storage = memory();
  const db = {
    rpc: async () => ({
      error: null,
      data: {
        contract: "work-delay-resolution@1",
        tenantId: scope.tenantId,
        actorId: scope.actorId,
        requestId: approval.requestId,
        payload: approval.payload,
        state: "recorded",
        recordedAt: "2026-10-05T11:00:00Z",
      },
    }),
  };
  await assert.rejects(
    recoverDelayDraft(
      db,
      {
        ...storage,
        removeItem: () => {
          throw Error("Cleanup failed");
        },
      },
      lock,
      scope,
      approval,
      "check",
      () => true,
    ),
  );
  assert.deepEqual(readDelayDraft(storage, scope), approval);
  assert.equal(
    (await recoverDelayDraft(db, storage, lock, scope, approval, "check", () => true)).state,
    "recorded",
  );
  assert.equal(readDelayDraft(storage, scope), null);
});
