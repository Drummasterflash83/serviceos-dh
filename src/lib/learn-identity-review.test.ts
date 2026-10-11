import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readIdentityReviews,
  readIdentityReviewDetail,
  searchIdentityPeople,
  resolveSavedIdentityReview,
  readSavedIdentityReview,
  identityReviewOutboxKey,
  type IdentityReviewRequest,
} from "./learn-identity-review.ts";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const scope = { backend: "https://test.example", tenantId: id(1), actorId: id(2) };
const request: IdentityReviewRequest = {
  version: 1,
  ...scope,
  requestId: id(3),
  interactionId: id(4),
  personId: id(7),
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
  version: "learn-identity-review-receipt/1",
  tenant_id: id(1),
  request_id: id(3),
  interaction_id: id(4),
  person_id: id(7),
  state,
  ...(state === "recorded" ? { card_id: id(5), card_processing: "committed" } : {}),
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
    () => resolveSavedIdentityReview(db, store, lock, scope, request, "apply", () => true),
    {
      message:
        "Identity review is unconfirmed. The saved request is retained; check its receipt before retrying.",
    },
  );
  assert.deepEqual(readSavedIdentityReview(store, scope), request);
  const r = await resolveSavedIdentityReview(db, store, lock, scope, request, "apply", () => true);
  assert.equal(r.state, "recorded");
  assert.equal(applies, 1);
  assert.equal(readSavedIdentityReview(store, scope), null);
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
    resolveSavedIdentityReview(db, store, lock, scope, request, "apply", () => true),
  );
  const m = memory();
  m.setItem(identityReviewOutboxKey(scope), JSON.stringify({ ...request, tenantId: id(99) }));
  await assert.rejects(() =>
    resolveSavedIdentityReview(db, m, lock, scope, request, "apply", () => true),
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
    resolveSavedIdentityReview(db, store, lock, scope, request, "apply", () => active),
  );
  assert.equal(calls, 1);
  assert.ok(readSavedIdentityReview(store, scope));
});
test("cancel records a tombstone only after checking the original receipt", async () => {
  const store = memory();
  store.setItem(identityReviewOutboxKey(scope), JSON.stringify(request));
  const calls: unknown[] = [];
  const db = {
    rpc: async (_n: string, args: Record<string, unknown>) => {
      calls.push(args.p_mode);
      return { data: receipt(args.p_mode === "cancel" ? "cancelled" : "pending"), error: null };
    },
  };
  assert.equal(
    (await resolveSavedIdentityReview(db, store, lock, scope, request, "cancel", () => true)).state,
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
          ...(foreign ? { tenant_id: id(99) } : { card_id: "invalid" }),
        },
        error: null,
      }),
    };
    await assert.rejects(() =>
      resolveSavedIdentityReview(db, store, lock, scope, request, "apply", () => true),
    );
    assert.ok(readSavedIdentityReview(store, scope));
  }
});

const detail = () => ({
  version: "learn-identity-review-detail/1",
  tenant_id: id(1),
  interaction_id: id(4),
  person_id: id(7),
  revision: "a".repeat(64),
  can_apply: true,
  blocked_reason: null,
  hold_reason: "person_ambiguous",
  checked_at: "2026-10-11T18:00:00Z",
  source: {
    source_type: "phone",
    direction: "inbound",
    occurred_at: "2026-10-11T10:00:00Z",
    subject: null,
    preview: "Synthetic summary",
    from_address: null,
    to_address: null,
    phone_from: "+441632960000",
    phone_to: null,
    related_person_id: null,
    related_company_id: null,
  },
  person: { name: "Chosen contact", email: null, phone: "+441632960000", verified: false },
  company: null,
  rejected_matches: [],
});
test("comparison rejects foreign scope, unexpected source fields and contradictory action flags", async () => {
  const good = detail();
  for (const data of [
    { ...good, person_id: id(99) },
    { ...good, tenant_id: id(99) },
    { ...good, source: { ...good.source, raw_payload: "secret" } },
    { ...good, can_apply: true, blocked_reason: "hold_changed" },
    { ...good, person: { ...good.person, verified: null } },
  ]) {
    await assert.rejects(() =>
      readIdentityReviewDetail({ rpc: async () => ({ data, error: null }) }, id(1), id(4), id(7)),
    );
  }
  assert.deepEqual(
    await readIdentityReviewDetail(
      { rpc: async () => ({ data: good, error: null }) },
      id(1),
      id(4),
      id(7),
    ),
    good,
  );
});
test("paged contact search binds search and tenant; failed reads are not empty results", async () => {
  const good = {
    version: "learn-identity-people/1",
    tenant_id: id(1),
    search: "Chosen",
    rows: [{ id: id(7), name: "Chosen", email: null, phone: null }],
    next_cursor: null,
  };
  assert.deepEqual(
    await searchIdentityPeople({ rpc: async () => ({ data: good, error: null }) }, id(1), "Chosen"),
    good,
  );
  for (const data of [
    { ...good, tenant_id: id(99) },
    { ...good, search: "Different" },
    { ...good, next_cursor: id(7) },
    { ...good, rows: [...good.rows, ...good.rows] },
  ])
    await assert.rejects(() =>
      searchIdentityPeople({ rpc: async () => ({ data, error: null }) }, id(1), "Chosen"),
    );
  await assert.rejects(() =>
    searchIdentityPeople(
      { rpc: async () => ({ data: null, error: new Error("private") }) },
      id(1),
      "Chosen",
    ),
  );
});
test("hold pagination refuses unordered rows and repeated cursor pages", async () => {
  const row = (n: number) => ({
    interaction_id: id(n),
    source_type: "phone",
    subject: null,
    occurred_at: "2026-10-11T10:00:00Z",
    reason: "person_ambiguous",
  });
  const good = {
    version: "learn-identity-reviews/1",
    tenant_id: id(1),
    rows: [row(4)],
    next_cursor: null,
    checked_at: "2026-10-11T18:00:00Z",
  };
  assert.deepEqual(
    await readIdentityReviews({ rpc: async () => ({ data: good, error: null }) }, id(1)),
    good,
  );
  await assert.rejects(() =>
    readIdentityReviews({ rpc: async () => ({ data: good, error: null }) }, id(1), id(4)),
  );
  await assert.rejects(() =>
    readIdentityReviews(
      { rpc: async () => ({ data: { ...good, rows: [row(5), row(4)] }, error: null }) },
      id(1),
    ),
  );
});
