import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareWorkCollectionDraft,
  readWorkCollectionDraft,
  workCollectionOutboxKey,
  operateWorkCollection,
} from "./learn-work-collection-outbox.ts";
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const scope = {
  backend: "https://test.example",
  tenantId: id(1),
  actorId: id(2),
  subjectId: id(3),
  kind: "residence" as const,
};
const request = {
  tenantId: id(1),
  actorId: id(2),
  requestId: id(4),
  kind: "residence" as const,
  subjectId: id(3),
  policyId: id(5),
  policyVersion: 1,
  period: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
  reason: "Review retained work",
};
const draft = prepareWorkCollectionDraft(scope, request);
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
const lock = async <T>(_key: string, f: () => Promise<T>) => f();
function backend(
  storage: ReturnType<typeof memory>,
  options: { loseStart?: boolean; loseStep?: boolean; noProgress?: boolean } = {},
) {
  let progress: any = null;
  const calls: any[] = [];
  let lost = false;
  const zero = () => ({
    contract: "work-collection@1",
    ...request,
    state: "collecting",
    population: 200,
    processed: 0,
    eligible: 0,
    covered: 0,
    snapshotAt: "2026-01-03T00:00:00Z",
    measurementId: null,
    endReason: null,
  });
  return {
    calls,
    get progress() {
      return progress;
    },
    rpc: async (name: string, args: any) => {
      assert.ok(
        storage.getItem(workCollectionOutboxKey(scope)),
        "Request must be durable before every dispatch",
      );
      calls.push({ name, args });
      if (name === "learn_work_collection_begin") {
        progress ??= zero();
        if (options.loseStart && !lost) {
          lost = true;
          throw Error("Lost start reply");
        }
      }
      if (
        name === "learn_work_collection_step" &&
        progress.state === "collecting" &&
        args.p_after === progress.processed &&
        !options.noProgress
      ) {
        progress = {
          ...progress,
          processed: Math.min(200, progress.processed + 100),
          eligible: Math.min(200, progress.processed + 100),
          covered: Math.min(200, progress.processed + 100),
        };
        if (progress.processed === 200)
          progress = { ...progress, state: "completed", measurementId: request.requestId };
        if (options.loseStep && !lost) {
          lost = true;
          throw Error("Lost batch reply");
        }
      }
      if (name === "learn_work_collection_abandon") {
        assert.equal(args.p_reason, request.reason);
        assert.equal(args.p_policy, request.policyId);
        assert.equal(args.p_kind, request.kind);
        progress ??= { ...zero(), population: 0 };
        if (progress.state === "collecting")
          progress = { ...progress, state: "abandoned", endReason: args.p_end_reason };
      }
      return progress
        ? { data: structuredClone(progress), error: null }
        : { data: null, error: { code: "42501" } };
    },
  };
}
test("durable original scope survives lost start, reload and changed screen dates/rules", async () => {
  const storage = memory(),
    db = backend(storage, { loseStart: true });
  await assert.rejects(operateWorkCollection(db, storage, lock, scope, draft, "run", () => true));
  assert.equal(db.calls.length, 1);
  const restored = readWorkCollectionDraft(storage, scope)!;
  assert.deepEqual(restored, draft);
  const done = await operateWorkCollection(db, storage, lock, scope, restored, "run", () => true);
  assert.equal(done.state, "completed");
  assert.ok(
    readWorkCollectionDraft(storage, scope),
    "Completed request remains until explicit confirmed clear",
  );
  await operateWorkCollection(db, storage, lock, scope, restored, "clear", () => true);
  assert.equal(readWorkCollectionDraft(storage, scope), null);
  assert.deepEqual(
    db.calls.filter((c) => c.name.endsWith("step")).map((c) => c.args.p_after),
    [0, 100],
  );
});
test("a lost batch reply stops dispatch; checking reads its committed checkpoint before resume", async () => {
  const storage = memory(),
    db = backend(storage, { loseStep: true });
  await assert.rejects(operateWorkCollection(db, storage, lock, scope, draft, "run", () => true));
  assert.equal(db.progress.processed, 100);
  assert.equal(db.calls.length, 2);
  assert.equal(
    (await operateWorkCollection(db, storage, lock, scope, draft, "check", () => true)).processed,
    100,
  );
  await operateWorkCollection(db, storage, lock, scope, draft, "run", () => true);
  assert.deepEqual(
    db.calls.filter((c) => c.name.endsWith("step")).map((c) => c.args.p_after),
    [0, 100],
  );
});
test("pause/access loss after one checkpoint retains request and stops further work", async () => {
  const storage = memory(),
    db = backend(storage);
  let allowed = true;
  await assert.rejects(
    operateWorkCollection(
      db,
      storage,
      lock,
      scope,
      draft,
      "run",
      () => allowed,
      (p) => {
        if (p.processed === 100) allowed = false;
      },
    ),
    /paused/,
  );
  assert.equal(db.progress.processed, 100);
  assert.equal(db.calls.filter((c) => c.name.endsWith("step")).length, 1);
  assert.ok(readWorkCollectionDraft(storage, scope));
});
test("blocked storage, changed storage and lost authority cannot dispatch further batches", async () => {
  const storage = memory(),
    db = backend(storage);
  const broken = {
    ...storage,
    setItem: () => {
      throw Error("Quota");
    },
  };
  await assert.rejects(operateWorkCollection(db, broken, lock, scope, draft, "run", () => true));
  assert.equal(db.calls.length, 0);
  await assert.rejects(operateWorkCollection(db, storage, lock, scope, draft, "run", () => false));
  assert.equal(db.calls.length, 0);
  await assert.rejects(
    operateWorkCollection(
      db,
      storage,
      lock,
      scope,
      draft,
      "run",
      () => true,
      (p) => {
        if (p.processed === 0) storage.setItem(workCollectionOutboxKey(scope), "changed");
      },
    ),
    /changed/,
  );
  assert.equal(db.calls.length, 1);
});
test("unknown or unfinished outcomes cannot clear; explicit ending retains exact cancellation intent", async () => {
  const storage = memory(),
    db = backend(storage);
  storage.setItem(workCollectionOutboxKey(scope), JSON.stringify(draft));
  await assert.rejects(operateWorkCollection(db, storage, lock, scope, draft, "clear", () => true));
  assert.ok(readWorkCollectionDraft(storage, scope));
  const ended = await operateWorkCollection(
    db,
    storage,
    lock,
    scope,
    draft,
    "end",
    () => true,
    () => {},
    "No longer needed",
  );
  assert.equal(ended.state, "abandoned");
  const late = await operateWorkCollection(db, storage, lock, scope, draft, "run", () => true);
  assert.equal(late.state, "abandoned");
  assert.equal(db.calls.filter((c) => c.name.endsWith("step")).length, 0);
  await operateWorkCollection(db, storage, lock, scope, draft, "clear", () => true);
  assert.equal(readWorkCollectionDraft(storage, scope), null);
});
test("run refuses a nonadvancing checkpoint rather than looping; end after completion keeps measurement", async () => {
  const storage = memory(),
    db = backend(storage, { noProgress: true });
  await assert.rejects(
    operateWorkCollection(db, storage, lock, scope, draft, "run", () => true),
    /checkpoint/,
  );
  assert.equal(db.calls.length, 2);
  const fresh = memory(),
    completed = backend(fresh);
  await operateWorkCollection(completed, fresh, lock, scope, draft, "run", () => true);
  const result = await operateWorkCollection(
    completed,
    fresh,
    lock,
    scope,
    draft,
    "end",
    () => true,
    () => {},
    "Stop",
  );
  assert.equal(result.state, "completed");
  assert.equal(result.measurementId, request.requestId);
});
test("scope, backend and malformed storage are isolated; a different retained request is never overwritten", async () => {
  const storage = memory(),
    db = backend(storage);
  storage.setItem(workCollectionOutboxKey(scope), JSON.stringify(draft));
  for (const patch of [
    { actorId: id(9) },
    { tenantId: id(9) },
    { subjectId: id(9) },
    { kind: "handoffs" as const },
    { backend: "https://other.example" },
  ])
    assert.equal(readWorkCollectionDraft(storage, { ...scope, ...patch }), null);
  const other = prepareWorkCollectionDraft(scope, { ...request, requestId: id(8) });
  await assert.rejects(
    operateWorkCollection(db, storage, lock, scope, other, "run", () => true),
    /Another collection/,
  );
  assert.equal(db.calls.length, 0);
  storage.setItem(
    workCollectionOutboxKey(scope),
    JSON.stringify({ ...draft, unexpected: "payload" }),
  );
  assert.throws(() => readWorkCollectionDraft(storage, scope), /needs attention/);
});
test("same-browser lock serializes competing requests before any network call", async () => {
  const storage = memory(),
    db = backend(storage);
  let chain = Promise.resolve();
  const serial = async <T>(_key: string, f: () => Promise<T>) => {
    const next = chain.then(f);
    chain = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const other = prepareWorkCollectionDraft(scope, { ...request, requestId: id(8) });
  const results = await Promise.allSettled([
    operateWorkCollection(db, storage, serial, scope, draft, "run", () => true),
    operateWorkCollection(db, storage, serial, scope, other, "run", () => true),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.ok(db.calls.every((c) => c.args.p_request === request.requestId));
});
