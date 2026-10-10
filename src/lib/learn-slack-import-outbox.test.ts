import { test } from "node:test";
import assert from "node:assert/strict";
import {
  importOutboxKey,
  prepareImportDraft,
  readImportDraft,
  submitImportDraft,
  skipRejectedImport,
  ImportSubmissionError,
  type ImportRequest,
} from "./learn-slack-import-outbox.ts";
import type { RecoveryLock } from "./learn-slack-recovery-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { backend: "https://example.supabase.co", tenantId: id(1), actorId: id(2) };
const common = {
  tenantId: id(1),
  start: "2026-01-01T00:00:00Z",
  end: "2026-01-02T00:00:00Z",
  maxPages: 3,
  reason: "Reviewed source window",
};
const channel = (): ImportRequest => ({
  kind: "channel",
  request: {
    ...common,
    requestId: id(3),
    channelId: "CTEST",
    connection: { id: id(4), teamId: "TTEST", name: "Synthetic workspace", revision: common.start },
  },
});
const threads = (): ImportRequest[] =>
  [5, 6, 7].map((n) => ({
    kind: "threads",
    request: {
      ...common,
      requestId: id(n),
      accountId: id(8),
      sourceId: id(n + 10),
      sourceVersion: "a".repeat(64),
      parentTimestamp: "1767225600.000001",
      connectionRevision: common.start,
    },
  }));
const storage = () => {
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
const lock: RecoveryLock = async (_key, task) => task();
const receipt = (args: Record<string, unknown>) => ({
  requestId: args.p_request_id,
  accountId: args.p_account_id ?? id(8),
  jobId: id(9),
  reused: false,
});
test("channel response loss survives reload with exact request identity and scoped storage", async () => {
  const s = storage(),
    d = prepareImportDraft(scope, [channel()]),
    calls: unknown[] = [];
  const db = {
    rpc: async (_n: string, args: Record<string, unknown>) => {
      calls.push(args);
      assert.deepEqual(readImportDraft(s, scope, "channel"), d);
      if (calls.length === 1) throw Error("Lost reply");
      return { data: { ...receipt(args), reused: true }, error: null };
    },
  };
  await assert.rejects(submitImportDraft(db, s, lock, scope, d, () => true));
  for (const change of [
    { actorId: id(90) },
    { tenantId: id(90) },
    { backend: "https://different.invalid" },
  ])
    assert.equal(readImportDraft(s, { ...scope, ...change }, "channel"), null);
  const result = await submitImportDraft(
    db,
    s,
    lock,
    scope,
    readImportDraft(s, scope, "channel")!,
    () => true,
  );
  assert.equal(result.entries[0].receipt?.reused, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(readImportDraft(s, scope, "channel"), null);
});
test("partial batch persists each receipt; reload skips confirmed requests and retries uncertain IDs", async () => {
  const s = storage(),
    d = prepareImportDraft(scope, threads()),
    calls: string[] = [];
  let lose = true;
  const db = {
    rpc: async (_n: string, args: Record<string, unknown>) => {
      const requestId = String(args.p_request_id);
      calls.push(requestId);
      if (requestId === id(6)) {
        assert.ok(readImportDraft(s, scope, "threads")?.entries[0].receipt);
        if (lose) {
          lose = false;
          throw Error("Lost reply");
        }
      }
      return { data: receipt(args), error: null };
    },
  };
  await assert.rejects(submitImportDraft(db, s, lock, scope, d, () => true));
  const restored = readImportDraft(s, scope, "threads")!;
  assert.equal(restored.entries.filter((e) => e.receipt).length, 1);
  await submitImportDraft(db, s, lock, scope, restored, () => true);
  assert.deepEqual(calls, [id(5), id(6), id(6), id(7)]);
  assert.equal(readImportDraft(s, scope, "threads"), null);
});
test("storage failure before send and after a receipt prevent further RPCs", async () => {
  const d = prepareImportDraft(scope, threads());
  for (const failAt of [1, 2]) {
    const s = storage();
    let writes = 0,
      calls = 0;
    const set = s.setItem;
    s.setItem = (k, v) => {
      if (++writes === failAt) throw Error("Quota");
      set(k, v);
    };
    const db = {
      rpc: async (_n: string, args: Record<string, unknown>) => {
        calls++;
        return { data: receipt(args), error: null };
      },
    };
    await assert.rejects(
      submitImportDraft(db, s, lock, scope, d, () => true),
      /Quota/,
    );
    assert.equal(calls, failAt - 1);
    if (failAt === 2) assert.equal(readImportDraft(s, scope, "threads")?.entries[0].receipt, null);
  }
  let calls = 0;
  const s = { ...storage(), setItem: () => {} };
  await assert.rejects(
    submitImportDraft(
      {
        rpc: async () => {
          calls++;
          return { data: null, error: null };
        },
      },
      s,
      lock,
      scope,
      d,
      () => true,
    ),
  );
  assert.equal(calls, 0);
});
test("closure or authority revocation stops unsent batch members", async () => {
  const s = storage(),
    d = prepareImportDraft(scope, threads());
  let allowed = true,
    calls = 0;
  const db = {
    rpc: async (_n: string, args: Record<string, unknown>) => {
      calls++;
      allowed = false;
      return { data: receipt(args), error: null };
    },
  };
  await assert.rejects(
    submitImportDraft(db, s, lock, scope, d, () => allowed),
    /Remaining requests/,
  );
  assert.equal(calls, 1);
  assert.ok(readImportDraft(s, scope, "threads")?.entries[0].receipt);
  await assert.rejects(
    submitImportDraft(db, s, lock, scope, d, () => false),
    /access/,
  );
  assert.equal(calls, 1);
});
test("competing tabs cannot replace unresolved imports; stale tabs use stored receipts", async () => {
  const s = storage(),
    first = prepareImportDraft(scope, threads()),
    other = prepareImportDraft(scope, threads());
  let tail = Promise.resolve(),
    calls = 0;
  const serial: RecoveryLock = (_k, task) => {
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
  const outcomes = await Promise.allSettled([
    submitImportDraft(db, s, serial, scope, first, () => true),
    submitImportDraft(db, s, serial, scope, other, () => true),
  ]);
  assert.ok(outcomes.every((r) => r.status === "rejected"));
  assert.equal(calls, 1);
  assert.deepEqual(readImportDraft(s, scope, "threads"), first);
});
test("explicit rejection can clear only its item, retaining confirmed and unsent siblings", async () => {
  const s = storage(),
    d = prepareImportDraft(scope, threads());
  let failure: ImportSubmissionError | undefined;
  const db = {
    rpc: async (_n: string, args: Record<string, unknown>) =>
      args.p_request_id === id(6)
        ? { data: null, error: { code: "PT409" } }
        : { data: receipt(args), error: null },
  };
  try {
    await submitImportDraft(db, s, lock, scope, d, () => true);
  } catch (e) {
    failure = e as ImportSubmissionError;
  }
  assert.equal(failure?.rejected, true);
  await assert.rejects(
    skipRejectedImport(s, lock, scope, prepareImportDraft(scope, threads()), failure!),
    /changed/,
  );
  const remaining = await skipRejectedImport(s, lock, scope, d, failure!);
  assert.ok(remaining?.entries[0].receipt);
  assert.equal(remaining?.entries[1].skipped, true);
  assert.equal(remaining?.entries[2].receipt, null);
  const calls: string[] = [];
  await submitImportDraft(
    {
      rpc: async (_n, args) => {
        calls.push(String(args.p_request_id));
        return { data: receipt(args), error: null };
      },
    },
    s,
    lock,
    scope,
    d,
    () => true,
  );
  assert.deepEqual(calls, [id(7)]);
});
test("uncertain, forbidden and malformed receipts cannot authorize clearing", async () => {
  for (const response of [
    { data: null, error: { code: "42501" } },
    { data: null, error: { code: "network" } },
    { data: { requestId: id(3), accountId: "bad" }, error: null },
  ]) {
    const s = storage(),
      d = prepareImportDraft(scope, [channel()]);
    let failure: ImportSubmissionError | undefined;
    try {
      await submitImportDraft({ rpc: async () => response }, s, lock, scope, d, () => true);
    } catch (e) {
      failure = e as ImportSubmissionError;
    }
    assert.equal(failure?.rejected, false);
    await assert.rejects(skipRejectedImport(s, lock, scope, d, failure!), /uncertain/);
    assert.deepEqual(readImportDraft(s, scope, "channel"), d);
  }
});
test("malformed, mixed, duplicate and foreign batches never submit; fields are whitelisted", async () => {
  const s = storage(),
    d = prepareImportDraft(scope, threads()),
    key = importOutboxKey(scope, "threads");
  let calls = 0;
  for (const raw of [
    "bad json",
    JSON.stringify({ ...d, tenantId: id(99) }),
    JSON.stringify({ ...d, entries: [d.entries[0], d.entries[0]] }),
    JSON.stringify({
      ...d,
      entries: [{ ...d.entries[0], request: { ...d.entries[0].request, tenantId: id(99) } }],
    }),
  ]) {
    s.setItem(key, raw);
    assert.throws(() => readImportDraft(s, scope, "threads"));
    await assert.rejects(
      submitImportDraft(
        {
          rpc: async () => {
            calls++;
            return { data: null, error: null };
          },
        },
        s,
        lock,
        scope,
        d,
        () => true,
      ),
    );
    assert.equal(s.getItem(key), raw);
  }
  assert.equal(calls, 0);
  assert.throws(() => prepareImportDraft(scope, []));
  assert.throws(() => prepareImportDraft(scope, [channel(), threads()[0]]));
  s.setItem(
    key,
    JSON.stringify({
      ...d,
      privatePayload: "omit",
      entries: d.entries.map((e) => ({
        ...e,
        request: { ...e.request, secret: "omit", excerpt: "omit" },
      })),
    }),
  );
  assert.deepEqual(readImportDraft(s, scope, "threads"), d);
});
test("external storage replacement and failed clear retain uncertainty without overwriting another review", async () => {
  const s = storage(),
    d = prepareImportDraft(scope, [channel()]),
    replacement = prepareImportDraft(scope, [channel()]),
    key = importOutboxKey(scope, "channel");
  await assert.rejects(
    submitImportDraft(
      {
        rpc: async (_n, args) => {
          s.setItem(key, JSON.stringify(replacement));
          return { data: receipt(args), error: null };
        },
      },
      s,
      lock,
      scope,
      d,
      () => true,
    ),
    /saved import changed/,
  );
  assert.deepEqual(readImportDraft(s, scope, "channel"), replacement);
  s.removeItem = () => {};
  await assert.rejects(
    submitImportDraft(
      { rpc: async (_n, args) => ({ data: receipt(args), error: null }) },
      s,
      lock,
      scope,
      replacement,
      () => true,
    ),
    /could not be cleared/,
  );
  assert.ok(readImportDraft(s, scope, "channel")?.entries[0].receipt);
});
