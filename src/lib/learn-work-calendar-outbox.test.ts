import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarOutboxKey,
  prepareCalendarDraft,
  readCalendarDraft,
  recoverCalendarDraft,
  parseCalendarResolution,
  type CalendarRecoveryLock,
  type CalendarDraft,
} from "./learn-work-calendar-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { backend: "https://synthetic.invalid", actorId: id(1), tenantId: id(2) };
const definition = {
  name: "Office",
  timezone: "Europe/London",
  weekly: [{ day: 1, startMinute: 540, endMinute: 1020 }],
  exceptions: [],
};
const save = prepareCalendarDraft(scope, {
  kind: "save",
  requestId: id(3),
  payload: { expectedRevision: 0, definition, reason: "Agreed hours" },
});
const publish = prepareCalendarDraft(scope, {
  kind: "publish",
  requestId: id(4),
  payload: { versionId: id(3), expectedPublication: null, reason: "Approve hours prospectively" },
});
const lock: CalendarRecoveryLock = async (_key, fn) => fn();
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
function receipt(draft: CalendarDraft, state = "pending") {
  return {
    contract: "work-calendar-resolution@1",
    ...scope,
    requestId: draft.requestId,
    kind: draft.kind,
    payload: draft.payload,
    state,
    recordedAt: state === "pending" ? null : "2026-10-11T00:00:00Z",
  };
}
function server(draft: CalendarDraft, storage: ReturnType<typeof memory>, loseWrite = false) {
  let state = "pending",
    writes = 0;
  const calls: string[] = [];
  return {
    calls,
    get writes() {
      return writes;
    },
    db: {
      rpc: async (name: string, args: Record<string, any>) => {
        assert.deepEqual(
          readCalendarDraft(storage, scope),
          draft,
          "The exact request must exist before every RPC",
        );
        calls.push(name);
        assert.equal(args.p_request, draft.requestId);
        if (name === "learn_work_calendar_resolve") {
          assert.deepEqual(args.p_payload, draft.payload);
          if (args.p_cancel && state === "pending") state = "cancelled";
          return { data: receipt(draft, state), error: null };
        }
        writes++;
        assert.equal(state, "pending");
        state = "recorded";
        if (loseWrite) throw Error("Reply lost after commit");
        const data =
          draft.kind === "save"
            ? {
                contract: "work-calendar@1",
                version: {
                  id: draft.requestId,
                  tenantId: scope.tenantId,
                  revision: draft.payload.expectedRevision + 1,
                  definition: draft.payload.definition,
                  recordedAt: "2026-10-11T00:00:00Z",
                  recordedBy: scope.actorId,
                  reason: draft.payload.reason,
                },
              }
            : {
                contract: "work-calendar-publication@1",
                id: draft.requestId,
                tenantId: scope.tenantId,
                versionId: draft.payload.versionId,
                effectiveFrom: "2026-10-11T00:00:00Z",
                recordedBy: scope.actorId,
                reason: draft.payload.reason,
              };
        return { data, error: null };
      },
    },
  };
}
for (const draft of [save, publish]) {
  test(`${draft.kind}: lost committed reply survives reload and resolves without another write`, async () => {
    const storage = memory(),
      s = server(draft, storage, true);
    await assert.rejects(
      recoverCalendarDraft(s.db, storage, lock, scope, draft, "submit", () => true),
      /Reply lost/,
    );
    const reloaded = readCalendarDraft(storage, scope)!;
    assert.deepEqual(reloaded, draft);
    assert.equal(
      (await recoverCalendarDraft(s.db, storage, lock, scope, reloaded, "submit", () => true))
        .state,
      "recorded",
    );
    assert.equal(s.writes, 1);
    assert.equal(readCalendarDraft(storage, scope), null);
  });
  test(`${draft.kind}: check never submits; cancellation clears only after a terminal server receipt`, async () => {
    const storage = memory(),
      s = server(draft, storage);
    assert.equal(
      (await recoverCalendarDraft(s.db, storage, lock, scope, draft, "check", () => true)).state,
      "pending",
    );
    assert.deepEqual(readCalendarDraft(storage, scope), draft);
    assert.equal(
      (await recoverCalendarDraft(s.db, storage, lock, scope, draft, "cancel", () => true)).state,
      "cancelled",
    );
    assert.equal(s.writes, 0);
    assert.equal(readCalendarDraft(storage, scope), null);
  });
}
test("save and publish share one unresolved slot; foreign actor, tenant and backend remain isolated", async () => {
  const storage = memory(),
    s = server(save, storage);
  await recoverCalendarDraft(s.db, storage, lock, scope, save, "check", () => true);
  await assert.rejects(
    recoverCalendarDraft(s.db, storage, lock, scope, publish, "submit", () => true),
    /Another calendar change/,
  );
  assert.equal(s.calls.length, 1);
  for (const other of [
    { ...scope, actorId: id(20) },
    { ...scope, tenantId: id(20) },
    { ...scope, backend: "https://other.invalid" },
  ]) {
    assert.equal(readCalendarDraft(storage, other), null);
    await assert.rejects(
      recoverCalendarDraft(s.db, storage, lock, other, save, "submit", () => true),
      /another session/,
    );
  }
});
test("corrupt recovery data and unavailable storage fail before any network request", async () => {
  const storage = memory(),
    s = server(save, storage),
    key = calendarOutboxKey(scope);
  for (const raw of [
    "{",
    JSON.stringify({ ...save, extra: true }),
    JSON.stringify({ ...save, payload: { ...save.payload, extra: true } }),
    "x".repeat(350001),
  ]) {
    storage.setItem(key, raw);
    await assert.rejects(
      recoverCalendarDraft(s.db, storage, lock, scope, save, "submit", () => true),
    );
    assert.equal(storage.getItem(key), raw);
  }
  storage.removeItem(key);
  await assert.rejects(
    recoverCalendarDraft(
      s.db,
      {
        ...storage,
        setItem: () => {
          throw Error("Storage denied");
        },
      },
      lock,
      scope,
      save,
      "submit",
      () => true,
    ),
    /Storage denied/,
  );
  assert.equal(s.calls.length, 0);
});
test("unmount, role change or cross-tab storage change during status prevents submission", async () => {
  for (const changed of ["access", "storage"]) {
    const storage = memory();
    let allowed = true,
      calls = 0;
    const db = {
      rpc: async () => {
        calls++;
        if (changed === "access") allowed = false;
        else storage.setItem(calendarOutboxKey(scope), JSON.stringify(publish));
        return { data: receipt(save), error: null };
      },
    };
    await assert.rejects(
      recoverCalendarDraft(db, storage, lock, scope, save, "submit", () => allowed),
    );
    assert.equal(calls, 1);
    assert.ok(storage.getItem(calendarOutboxKey(scope)));
  }
});
test("changed authority or storage after a write prevents another RPC and preserves recovery", async () => {
  for (const changed of ["access", "storage"]) {
    const storage = memory(),
      s = server(save, storage);
    let allowed = true;
    const db = {
      rpc: async (name: string, args: Record<string, any>) => {
        const result = await s.db.rpc(name, args);
        if (name === "learn_work_calendar_save") {
          if (changed === "access") allowed = false;
          else storage.setItem(calendarOutboxKey(scope), JSON.stringify(publish));
        }
        return result;
      },
    };
    await assert.rejects(
      recoverCalendarDraft(db, storage, lock, scope, save, "submit", () => allowed),
    );
    assert.equal(s.calls.length, 2);
    assert.ok(storage.getItem(calendarOutboxKey(scope)));
  }
});
test("resolution rejects changed identity, payload, time or an unconfirmed cancellation", () => {
  const valid = receipt(save, "recorded");
  for (const patch of [
    { contract: "other" },
    { tenantId: id(9) },
    { actorId: id(9) },
    { requestId: id(9) },
    { kind: "publish" },
    { state: "unknown" },
    { recordedAt: null },
    { recordedAt: "2026-10-11" },
    { payload: { ...save.payload, reason: "Changed" } },
    { payload: { ...save.payload, expectedRevision: 10 } },
  ])
    assert.throws(() => parseCalendarResolution({ ...valid, ...patch }, scope, save, false));
  assert.throws(() => parseCalendarResolution(receipt(save), scope, save, true));
});
test("status errors and stale-write conflicts retain original details for check or cancellation", async () => {
  for (const code of ["42501", "PT409", "network"]) {
    const storage = memory();
    const db = { rpc: async () => ({ data: null, error: { code } }) };
    await assert.rejects(
      recoverCalendarDraft(db, storage, lock, scope, save, "submit", () => true),
    );
    assert.deepEqual(readCalendarDraft(storage, scope), save);
  }
  const storage = memory();
  let calls = 0;
  const db = {
    rpc: async () =>
      ++calls === 1
        ? { data: receipt(save), error: null }
        : { data: null, error: { code: "PT409" } },
  };
  await assert.rejects(recoverCalendarDraft(db, storage, lock, scope, save, "submit", () => true));
  assert.deepEqual(readCalendarDraft(storage, scope), save);
});
test("a second tab must wait for the lock and recheck retained state", async () => {
  const storage = memory(),
    s = server(save, storage);
  const gated: CalendarRecoveryLock = async (key, fn) => {
    assert.equal(key, calendarOutboxKey(scope));
    storage.setItem(key, JSON.stringify(publish));
    return fn();
  };
  await assert.rejects(
    recoverCalendarDraft(s.db, storage, gated, scope, save, "submit", () => true),
    /Another calendar change/,
  );
  assert.equal(s.calls.length, 0);
});
test("a successful submit resolves the same request after writing before clearing it", async () => {
  for (const draft of [save, publish]) {
    const storage = memory(),
      s = server(draft, storage);
    assert.equal(
      (await recoverCalendarDraft(s.db, storage, lock, scope, draft, "submit", () => true)).state,
      "recorded",
    );
    assert.deepEqual(s.calls, [
      "learn_work_calendar_resolve",
      `learn_work_calendar_${draft.kind}`,
      "learn_work_calendar_resolve",
    ]);
    assert.equal(readCalendarDraft(storage, scope), null);
  }
});

test("a lost final status reply retains the committed request until a later check", async () => {
  const storage = memory(),
    s = server(save, storage);
  let reads = 0;
  const db = {
    rpc: async (name: string, args: Record<string, any>) => {
      if (name === "learn_work_calendar_resolve" && ++reads === 2)
        return { data: null, error: { code: "network" } };
      return s.db.rpc(name, args);
    },
  };
  await assert.rejects(recoverCalendarDraft(db, storage, lock, scope, save, "submit", () => true));
  assert.deepEqual(readCalendarDraft(storage, scope), save);
  assert.equal(
    (await recoverCalendarDraft(db, storage, lock, scope, save, "check", () => true)).state,
    "recorded",
  );
  assert.equal(s.writes, 1);
});
test("browser cleanup failure keeps the terminal request recoverable without another write", async () => {
  const storage = memory(),
    s = server(publish, storage);
  const failing = {
    ...storage,
    removeItem: () => {
      throw Error("Storage cleanup denied");
    },
  };
  await assert.rejects(
    recoverCalendarDraft(s.db, failing, lock, scope, publish, "submit", () => true),
    /cleanup denied/,
  );
  assert.deepEqual(readCalendarDraft(storage, scope), publish);
  assert.equal(
    (await recoverCalendarDraft(s.db, storage, lock, scope, publish, "check", () => true)).state,
    "recorded",
  );
  assert.equal(s.writes, 1);
});
