import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readPhoneAttempts,
  resolveSavedPhoneReconciliation,
  readSavedPhoneReconciliation,
  phoneReviewOutboxKey,
  type PhoneReconciliation,
} from "./learn-phone-attempt-review.ts";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const scope = { backend: "https://test.example", tenantId: id(1), actorId: id(2) };
const request: PhoneReconciliation = {
  version: 1,
  ...scope,
  requestId: id(3),
  runId: id(4),
  reason: "Reviewed the saved output",
};
const lock = async <T>(_key: string, task: () => Promise<T>) => task();
const memory = () => {
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
const receipt = (state: "pending" | "cancelled" | "recorded") => ({
  version: "learn-operator-phone-reconciliation/1",
  tenant_id: id(1),
  request_id: id(3),
  run_id: id(4),
  state,
  ...(state === "recorded"
    ? { stage: "analysis", recording_id: id(5), already_completed: false }
    : {}),
});
test("lost publication response retains the request, then reconciles without a second apply", async () => {
  const store = memory();
  let applied = false,
    applies = 0;
  const db = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      if (args.p_mode === "apply") {
        applied = true;
        applies++;
        throw Error("PRIVATE network response detail");
      }
      return { data: receipt(applied ? "recorded" : "pending"), error: null };
    },
  };
  await assert.rejects(
    () => resolveSavedPhoneReconciliation(db, store, lock, scope, request, "apply", () => true),
    {
      message:
        "Phone reconciliation is unconfirmed. The saved request is retained; check its receipt before retrying.",
    },
  );
  assert.deepEqual(readSavedPhoneReconciliation(store, scope), request);
  const r = await resolveSavedPhoneReconciliation(
    db,
    store,
    lock,
    scope,
    request,
    "apply",
    () => true,
  );
  assert.equal(r.state, "recorded");
  assert.equal(applies, 1);
  assert.equal(readSavedPhoneReconciliation(store, scope), null);
});
test("failed durable save and mismatched saved scope prevent network requests", async () => {
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return { data: null, error: null };
    },
  };
  const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  await assert.rejects(() =>
    resolveSavedPhoneReconciliation(db, store, lock, scope, request, "apply", () => true),
  );
  const m = memory();
  m.setItem(phoneReviewOutboxKey(scope), JSON.stringify({ ...request, tenantId: id(99) }));
  await assert.rejects(() =>
    resolveSavedPhoneReconciliation(db, m, lock, scope, request, "apply", () => true),
  );
  assert.equal(calls, 0);
});
test("context change after receipt check prevents apply and retains request", async () => {
  const store = memory();
  let active = true,
    calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      active = false;
      return { data: receipt("pending"), error: null };
    },
  };
  await assert.rejects(() =>
    resolveSavedPhoneReconciliation(db, store, lock, scope, request, "apply", () => active),
  );
  assert.equal(calls, 1);
  assert.ok(readSavedPhoneReconciliation(store, scope));
});
test("cancel records a tombstone only after checking the original receipt", async () => {
  const store = memory();
  store.setItem(phoneReviewOutboxKey(scope), JSON.stringify(request));
  const calls: unknown[] = [];
  const db = {
    rpc: async (_n: string, args: Record<string, unknown>) => {
      calls.push(args.p_mode);
      return { data: receipt(args.p_mode === "cancel" ? "cancelled" : "pending"), error: null };
    },
  };
  assert.equal(
    (await resolveSavedPhoneReconciliation(db, store, lock, scope, request, "cancel", () => true))
      .state,
    "cancelled",
  );
  assert.deepEqual(calls, ["check", "cancel"]);
});
test("foreign or malformed publication receipt cannot clear the durable request", async () => {
  for (const foreign of [true, false]) {
    const store = memory();
    const db = {
      rpc: async () => ({
        data: {
          ...receipt("recorded"),
          ...(foreign ? { tenant_id: id(99) } : { recording_id: "invalid" }),
        },
        error: null,
      }),
    };
    await assert.rejects(() =>
      resolveSavedPhoneReconciliation(db, store, lock, scope, request, "apply", () => true),
    );
    assert.ok(readSavedPhoneReconciliation(store, scope));
  }
});
test("review parser refuses unsafe recovery evidence and foreign scope", async () => {
  const row = {
    run_id: id(4),
    recording_id: id(5),
    stage: "analysis",
    state: "prepared",
    started_at: "2026-10-11T00:00:00Z",
    completed_at: null,
    review_after: "2026-10-11T00:10:00Z",
    has_prepared_result: true,
    has_receipt: false,
    error_code: null,
    retained_previous_result: false,
    retained_previous_attribution: false,
    can_reconcile: true,
  };
  const page = {
    version: "learn-operator-phone-attempts/1",
    tenant_id: id(1),
    recording_id: null,
    held_only: true,
    checked_at: "2026-10-11T00:11:00Z",
    capture_allowed: true,
    rows: [row],
    next_cursor: null,
  };
  assert.equal(
    (await readPhoneAttempts({ rpc: async () => ({ data: page, error: null }) }, id(1), true)).rows
      .length,
    1,
  );
  for (const data of [
    { ...page, tenant_id: id(99) },
    { ...page, capture_allowed: false },
    { ...page, rows: [{ ...row, has_prepared_result: false }] },
    { ...page, rows: [{ ...row, stage: "download" }] },
    { ...page, next_cursor: id(6) },
  ])
    await assert.rejects(() =>
      readPhoneAttempts({ rpc: async () => ({ data, error: null }) }, id(1), true),
    );
});
