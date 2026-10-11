import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readProjectionReviews,
  readProjectionReviewDetail,
  resolveSavedProjectionReview,
  readSavedProjectionReview,
  projectionReviewOutboxKey,
  type ProjectionReviewRequest,
} from "./learn-projection-review.ts";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const scope = { backend: "https://test.example", tenantId: id(1), actorId: id(2) };
const request: ProjectionReviewRequest = {
  version: 1,
  ...scope,
  requestId: id(3),
  holdId: id(4),
  revision: "a".repeat(64),
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
  version: "learn-projection-review-receipt/1",
  tenant_id: id(1),
  request_id: id(3),
  hold_id: id(4),
  state,
  ...(state === "recorded"
    ? { interaction_id: id(5), event_id: id(6), card_processing: "pending" }
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
    () => resolveSavedProjectionReview(db, store, lock, scope, request, "apply", () => true),
    {
      message:
        "Projection review is unconfirmed. The saved request is retained; check its receipt before retrying.",
    },
  );
  assert.deepEqual(readSavedProjectionReview(store, scope), request);
  const r = await resolveSavedProjectionReview(
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
  assert.equal(readSavedProjectionReview(store, scope), null);
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
    resolveSavedProjectionReview(db, store, lock, scope, request, "apply", () => true),
  );
  const m = memory();
  m.setItem(projectionReviewOutboxKey(scope), JSON.stringify({ ...request, tenantId: id(99) }));
  await assert.rejects(() =>
    resolveSavedProjectionReview(db, m, lock, scope, request, "apply", () => true),
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
    resolveSavedProjectionReview(db, store, lock, scope, request, "apply", () => active),
  );
  assert.equal(calls, 1);
  assert.ok(readSavedProjectionReview(store, scope));
});
test("cancel records a tombstone only after checking the original receipt", async () => {
  const store = memory();
  store.setItem(projectionReviewOutboxKey(scope), JSON.stringify(request));
  const calls: unknown[] = [];
  const db = {
    rpc: async (_n: string, args: Record<string, unknown>) => {
      calls.push(args.p_mode);
      return { data: receipt(args.p_mode === "cancel" ? "cancelled" : "pending"), error: null };
    },
  };
  assert.equal(
    (await resolveSavedProjectionReview(db, store, lock, scope, request, "cancel", () => true))
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
          ...(foreign ? { tenant_id: id(99) } : { event_id: "invalid" }),
        },
        error: null,
      }),
    };
    await assert.rejects(() =>
      resolveSavedProjectionReview(db, store, lock, scope, request, "apply", () => true),
    );
    assert.ok(readSavedProjectionReview(store, scope));
  }
});

const hold = {
  hold_id: id(4),
  source_kind: "email" as const,
  source_id: id(7),
  reason: "legacy_projection_review",
  recorded_at: "2026-10-11T17:00:00Z",
};
const detail = {
  version: "learn-projection-review-detail/1",
  tenant_id: id(1),
  hold_id: id(4),
  source_id: id(7),
  source_kind: "email",
  interaction_id: id(5),
  revision: "a".repeat(64),
  source_revision: "b".repeat(64),
  reason: "legacy_projection_review",
  capture_allowed: true,
  can_apply: true,
  evidence_too_large: false,
  source_fields: { body_preview: "Source" },
  canonical_fields: { body_preview: "Current" },
  checked_at: "2026-10-11T17:00:00Z",
};
test("comparison rejects wrong tenant/source, unsafe fields and contradictory approval flags", async () => {
  assert.equal(
    (
      await readProjectionReviewDetail(
        { rpc: async () => ({ data: detail, error: null }) },
        id(1),
        hold,
      )
    ).can_apply,
    true,
  );
  for (const patch of [
    { tenant_id: id(9) },
    { hold_id: id(9) },
    { source_id: id(9) },
    { source_kind: "phone" },
    { revision: "bad" },
    { capture_allowed: false },
    { evidence_too_large: true },
    { source_fields: { raw_payload: "PRIVATE" } },
    { canonical_fields: {} },
    { reason: "source_changed" },
  ]) {
    await assert.rejects(() =>
      readProjectionReviewDetail(
        { rpc: async () => ({ data: { ...detail, ...patch }, error: null }) },
        id(1),
        hold,
      ),
    );
  }
});
test("list validates cursor, duplicates and tenant while distinguishing empty from unreadable", async () => {
  const page = {
    version: "learn-projection-reviews/1",
    tenant_id: id(1),
    checked_at: "2026-10-11T17:00:00Z",
    rows: [hold],
    next_cursor: null,
  };
  assert.equal(
    (await readProjectionReviews({ rpc: async () => ({ data: page, error: null }) }, id(1))).rows
      .length,
    1,
  );
  for (const data of [
    { ...page, tenant_id: id(2) },
    { ...page, rows: [hold, hold] },
    { ...page, next_cursor: id(8) },
    null,
  ])
    await assert.rejects(() =>
      readProjectionReviews({ rpc: async () => ({ data, error: null }) }, id(1)),
    );
  assert.equal(
    (
      await readProjectionReviews(
        { rpc: async () => ({ data: { ...page, rows: [] }, error: null }) },
        id(1),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(() =>
    readProjectionReviews(
      { rpc: async () => ({ data: null, error: { message: "PRIVATE" } }) },
      id(1),
    ),
  );
});
