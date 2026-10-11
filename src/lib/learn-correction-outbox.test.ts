import test from "node:test";
import assert from "node:assert/strict";
import {
  correctionOutboxKey,
  prepareCorrectionDraft,
  readCorrectionDraft,
  recoverCorrectionDraft,
} from "./learn-correction-outbox.ts";
import type { RecoveryLock } from "./learn-slack-recovery-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  backend: "https://synthetic.invalid",
  tenantId: id(1),
  actorId: id(2),
  subject: { kind: "member" as const, id: id(3) },
};
const request = {
  tenantId: id(1),
  measurementId: id(4),
  requestId: id(5),
  expectedReviewRevision: 2,
  value: 17 as number | null,
  reason: "Checked original calculation",
};
const draft = prepareCorrectionDraft(scope, request);
const lock: RecoveryLock = async (_key, fn) => fn();
function memory() {
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
}
function receipt(state: string, change: object = {}) {
  return {
    data: {
      state,
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      measurementId: request.requestId,
      predecessorId: request.measurementId,
      recordedAt: "2026-10-11T04:00:00Z",
      ...change,
    },
    error: null,
  };
}
for (const value of [17, null])
  test(`lost committed reply survives reload and resolves without another correction (${value})`, async () => {
    const d = prepareCorrectionDraft(scope, { ...request, value }),
      storage = memory();
    let recorded = false,
      writes = 0;
    const db = {
      rpc: async (name: string, args: any) => {
        assert.deepEqual(readCorrectionDraft(storage, scope), d);
        assert.equal(args.p_request, d.request.requestId);
        assert.equal(args.p_value, value);
        if (name === "learn_performance_correct") {
          recorded = true;
          writes++;
          throw Error("Lost reply");
        }
        assert.equal(name, "learn_performance_correction_resolve");
        return receipt(recorded ? "recorded" : "pending");
      },
    };
    await assert.rejects(
      recoverCorrectionDraft(db, storage, lock, scope, d, "submit", () => true),
      /Lost reply/,
    );
    const result = await recoverCorrectionDraft(
      db,
      storage,
      lock,
      scope,
      readCorrectionDraft(storage, scope)!,
      "submit",
      () => true,
    );
    assert.equal(result.state, "recorded");
    assert.equal(writes, 1);
    assert.equal(readCorrectionDraft(storage, scope), null);
  });
test("check never submits, cancellation clears only a terminal server receipt", async () => {
  const storage = memory();
  let calls = 0;
  const db = {
    rpc: async (name: string, args: any) => {
      calls++;
      assert.equal(name, "learn_performance_correction_resolve");
      return receipt(args.p_cancel ? "cancelled" : "pending");
    },
  };
  assert.equal(
    (await recoverCorrectionDraft(db, storage, lock, scope, draft, "check", () => true)).state,
    "pending",
  );
  assert.deepEqual(readCorrectionDraft(storage, scope), draft);
  assert.equal(
    (await recoverCorrectionDraft(db, storage, lock, scope, draft, "cancel", () => true)).state,
    "cancelled",
  );
  assert.equal(readCorrectionDraft(storage, scope), null);
  assert.equal(calls, 2);
});
test("changed receipt scope, identity, action or timestamp keeps the exact request", async () => {
  for (const changed of [
    { tenantId: id(9) },
    { actorId: id(9) },
    { measurementId: id(9) },
    { predecessorId: id(9) },
    { state: "unknown" },
    { recordedAt: "bad" },
  ]) {
    const storage = memory();
    await assert.rejects(
      recoverCorrectionDraft(
        { rpc: async () => receipt("recorded", changed) },
        storage,
        lock,
        scope,
        draft,
        "check",
        () => true,
      ),
      /not be verified/,
    );
    assert.deepEqual(readCorrectionDraft(storage, scope), draft);
  }
  const storage = memory();
  await assert.rejects(
    recoverCorrectionDraft(
      { rpc: async () => receipt("pending") },
      storage,
      lock,
      scope,
      draft,
      "cancel",
      () => true,
    ),
    /not be verified/,
  );
  assert.deepEqual(readCorrectionDraft(storage, scope), draft);
});
test("changed local request, denied storage and closed card stop before correction submission", async () => {
  const storage = memory();
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return receipt("pending");
    },
  };
  storage.setItem(correctionOutboxKey(scope), JSON.stringify(draft));
  await assert.rejects(
    recoverCorrectionDraft(
      db,
      storage,
      lock,
      scope,
      prepareCorrectionDraft(scope, { ...request, requestId: id(8) }),
      "submit",
      () => true,
    ),
    /Another correction/,
  );
  await assert.rejects(
    recoverCorrectionDraft(db, storage, lock, scope, draft, "submit", () => false),
    /closed/,
  );
  await assert.rejects(
    recoverCorrectionDraft(
      db,
      {
        ...storage,
        setItem: () => {
          throw Error("Storage denied");
        },
      },
      lock,
      scope,
      draft,
      "submit",
      () => true,
    ),
    /Storage denied/,
  );
  assert.equal(calls, 0);
  let allowed = true;
  await assert.rejects(
    recoverCorrectionDraft(
      {
        rpc: async () => {
          allowed = false;
          return receipt("pending");
        },
      },
      storage,
      lock,
      scope,
      draft,
      "submit",
      () => allowed,
    ),
    /closed/,
  );
  assert.deepEqual(readCorrectionDraft(storage, scope), draft);
  await assert.rejects(
    recoverCorrectionDraft(
      {
        rpc: async () => {
          storage.setItem(correctionOutboxKey(scope), "changed");
          return receipt("pending");
        },
      },
      storage,
      lock,
      scope,
      draft,
      "submit",
      () => true,
    ),
    /details changed/,
  );
});
test("slots isolate backend, actor, tenant and card; corrupt or extended data is never discarded", async () => {
  const storage = memory(),
    key = correctionOutboxKey(scope);
  storage.setItem(key, JSON.stringify(draft));
  for (const s of [
    { ...scope, actorId: id(8) },
    { ...scope, tenantId: id(8) },
    { ...scope, backend: "https://other.invalid" },
    { ...scope, subject: { ...scope.subject, id: id(8) } },
  ]) {
    assert.equal(readCorrectionDraft(storage, s), null);
    await assert.rejects(
      recoverCorrectionDraft(
        {
          rpc: async () => {
            throw Error("Unexpected");
          },
        },
        storage,
        lock,
        s,
        draft,
        "check",
        () => true,
      ),
    );
  }
  for (const raw of [
    "bad",
    JSON.stringify({ ...draft, extra: true }),
    JSON.stringify({ ...draft, request: { ...request, reason: "" } }),
    "x".repeat(16001),
  ]) {
    storage.setItem(key, raw);
    assert.throws(() => readCorrectionDraft(storage, scope), /needs attention/);
    assert.equal(storage.getItem(key), raw);
  }
});
test("same-request tabs serialize and do not submit a second correction", async () => {
  const storage = memory();
  let tail = Promise.resolve(),
    recorded = false,
    writes = 0;
  const serial: RecoveryLock = async (_key, fn) => {
    const before = tail;
    let release!: () => void;
    tail = new Promise((r) => (release = r));
    await before;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const db = {
    rpc: async (name: string) => {
      if (name === "learn_performance_correct") {
        writes++;
        recorded = true;
        return {
          data: {
            measurementId: request.requestId,
            predecessorId: request.measurementId,
            reused: false,
          },
          error: null,
        };
      }
      return receipt(recorded ? "recorded" : "pending");
    },
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      recoverCorrectionDraft(db, storage, serial, scope, draft, "submit", () => true),
    ),
  );
  assert.equal(writes, 1);
  assert.deepEqual(
    results.map((r) => r.state),
    ["recorded", "recorded"],
  );
});
test("uncertain resolve, failed submit and failed local clearing retain recoverable intent", async () => {
  for (const code of ["42501", "PT409", "network"]) {
    const storage = memory();
    await assert.rejects(
      recoverCorrectionDraft(
        { rpc: async () => ({ data: null, error: { code } }) },
        storage,
        lock,
        scope,
        draft,
        "check",
        () => true,
      ),
    );
    assert.deepEqual(readCorrectionDraft(storage, scope), draft);
  }
  const storage = memory();
  await assert.rejects(
    recoverCorrectionDraft(
      { rpc: async () => receipt("recorded") },
      { ...storage, removeItem: () => {} },
      lock,
      scope,
      draft,
      "check",
      () => true,
    ),
    /details remain/,
  );
  assert.deepEqual(readCorrectionDraft(storage, scope), draft);
});
