import test from "node:test";
import assert from "node:assert/strict";
import { handleIdentityResolve } from "./identity_resolve.ts";
(globalThis as any).Deno = { env: { get: () => undefined } };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n = 2) => ({ interaction_id: id(n), source_revision: String(n % 10).repeat(64) });
function fixture(options: any = {}) {
  const calls: any[] = [];
  const reviews = new Set();
  let inventoryCall = 0;
  const admin: any = {
    from() {
      throw Error("Direct identity/card writes forbidden");
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      if (name === "learn_identity_pending")
        return options.inventories?.[inventoryCall++] ??
          options.inventory ?? { data: options.rows ?? [row()], error: null };
      if (name === "learn_identity_review_count")
        return options.review ?? { data: reviews.size, error: null };
      assert.equal(name, "learn_identity_deliver");
      assert.equal(args.p_tenant, id(1));
      const receipt = {
        version: "learn-identity-delivery/1",
        state: "committed",
        tenantId: id(1),
        requestId: args.p_request,
        interactionId: args.p_interaction,
        sourceRevision: args.p_revision,
        cardId: id(20),
        personCreated: false,
        companyCreated: false,
        cardEnriched: true,
        recommendations: 0,
        suggestions: 1,
        eventsConsumed: 1,
      };
      const answer = options.respond
        ? options.respond(args, receipt)
        : { data: receipt, error: null };
      if (answer.data?.state === "review_required") reviews.add(args.p_interaction);
      return answer;
    },
  };
  return {
    calls,
    run: (payload: any = {}) =>
      handleIdentityResolve({ supabaseAdmin: admin, tenantId: id(1), jobId: id(90), payload }),
  };
}
test("confirmed atomic receipt counts a card and the actual acknowledged event only", async () => {
  const f = fixture(),
    r = await f.run();
  assert.equal(r.success, true);
  assert.equal(r.recordsProcessed, 1);
  assert.equal(r.result?.cards_enriched, 1);
  assert.equal(r.result?.events_consumed, 1);
  assert.equal(f.calls.length, 3);
});
test("lost publication reply inspects exact request once without republishing", async () => {
  const f = fixture({
    respond: (a: any, r: any) => {
      if (a.p_phase === "publish") throw Error("synthetic lost response");
      return { data: r, error: null };
    },
  });
  const r = await f.run();
  assert.equal(r.success, true);
  assert.deepEqual(
    f.calls.filter((c) => c.name === "learn_identity_deliver").map((c) => c.args.p_phase),
    ["publish", "inspect"],
  );
  assert.equal(f.calls[1].args.p_request, f.calls[2].args.p_request);
});
test("definitely missing stale revision is re-inventoried and published once with a fresh request", async () => {
  const old = row(2), current = { ...old, source_revision: "a".repeat(64) };
  const f = fixture({
    inventories: [
      { data: [old], error: null },
      { data: [current], error: null },
    ],
    respond: (a: any, r: any) => a.p_revision === old.source_revision
      ? { data: null, error: { code: "PT409", message: a.p_phase === "inspect"
        ? "processing_receipt_missing" : "identity_source_changed" } }
      : { data: r, error: null },
  });
  const result = await f.run({ limit: 1 });
  assert.equal(result.success, true);
  assert.equal(result.recordsProcessed, 1);
  const deliveries = f.calls.filter((c) => c.name === "learn_identity_deliver");
  assert.deepEqual(deliveries.map((c) => c.args.p_phase), ["publish", "inspect", "publish"]);
  assert.equal(deliveries[0].args.p_request, deliveries[1].args.p_request);
  assert.notEqual(deliveries[1].args.p_request, deliveries[2].args.p_request);
  assert.equal(deliveries[2].args.p_revision, current.source_revision);
});
test("uncertain inspect response cannot trigger a second publication", async () => {
  const f = fixture({
    respond: (a: any) => a.p_phase === "inspect"
      ? { data: null, error: { code: "PGRST000", message: "transport unavailable" } }
      : { data: null, error: { code: "PT409", message: "identity_source_changed" } },
  });
  const result = await f.run({ limit: 1 });
  assert.equal(result.error?.code, "identity_delivery_unconfirmed");
  assert.equal(f.calls.filter((c) => c.name === "learn_identity_pending").length, 1);
  assert.deepEqual(f.calls.filter((c) => c.name === "learn_identity_deliver")
    .map((c) => c.args.p_phase), ["publish", "inspect"]);
});
test("missing publication with unchanged inventory remains retryable without republishing", async () => {
  const f = fixture({
    respond: (a: any) => ({ data: null, error: { code: "PT409", message:
      a.p_phase === "inspect" ? "processing_receipt_missing" : "identity_source_changed" } }),
  });
  const result = await f.run({ limit: 1 });
  assert.equal(result.error?.code, "identity_delivery_unconfirmed");
  assert.equal(f.calls.filter((c) => c.name === "learn_identity_pending").length, 2);
  assert.deepEqual(f.calls.filter((c) => c.name === "learn_identity_deliver")
    .map((c) => c.args.p_phase), ["publish", "inspect"]);
});
test("a mixed batch reports partial failure and does not emit a successful continuation", async () => {
  const f = fixture({
    rows: [row(2), row(3)],
    respond: (a: any, r: any) =>
      a.p_interaction === id(3)
        ? { data: null, error: { message: "PRIVATE DB BODY" } }
        : { data: r, error: null },
  });
  const r = await f.run({ limit: 2 });
  assert.equal(r.success, false);
  assert.equal(r.recordsProcessed, 1);
  assert.equal(r.result?.failed, 1);
  assert.equal(r.error?.retryable, true);
  assert.equal(r.continuation, undefined);
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
});
test("review-required receipts preserve pending events and never count card completion", async () => {
  const f = fixture({
    respond: (_: any, r: any) => ({
      data: {
        ...r,
        state: "review_required",
        reason: "person_ambiguous",
        cardId: null,
        cardEnriched: false,
        recommendations: 0,
        suggestions: 0,
        eventsConsumed: 0,
      },
      error: null,
    }),
  });
  const r = await f.run();
  assert.equal(r.success, false);
  assert.equal(r.result?.review_required, 1);
  assert.equal(r.result?.resolved, 0);
  assert.equal(r.error?.code, "identity_review_required");
  assert.equal(r.error?.retryable, false);
});
test("foreign, mismatched and inconsistent receipts cannot confirm a delivery", async () => {
  for (const patch of [
    { tenantId: id(8) },
    { requestId: id(8) },
    { interactionId: id(8) },
    { sourceRevision: "f".repeat(64) },
    { state: "unknown" },
    { cardId: null },
    { cardEnriched: false },
    { eventsConsumed: 2 },
    { recommendations: -1 },
    { personCreated: "true" },
    { state: "review_required", cardId: null, cardEnriched: false },
  ]) {
    const f = fixture({ respond: (_: any, r: any) => ({ data: { ...r, ...patch }, error: null }) }),
      r = await f.run();
    assert.equal(r.success, false, JSON.stringify(patch));
    assert.equal(r.result?.failed, 1);
  }
});
test("missing, duplicated or invalid inventory prevents every mutation", async () => {
  for (const inventory of [
    { data: null, error: { message: "PRIVATE" } },
    { data: [row(), row()], error: null },
    { data: [{ ...row(), source_revision: "bad" }], error: null },
    { data: {}, error: null },
  ]) {
    const f = fixture({ inventory }),
      r = await f.run();
    assert.equal(r.success, false);
    assert.equal(f.calls.length, 1);
    assert.equal(r.error?.code, "identity_inventory_unconfirmed");
  }
});
test("failed inventory reports only its fixed stage and SQLSTATE", async () => {
  const warnings: string[] = [], prior = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  try {
    const pending = await fixture({ inventory: { data: null,
      error: { code: "57014", message: "PRIVATE database query and contact" } } }).run();
    const review = await fixture({ rows: [], review: { data: null,
      error: { code: "57014", message: "PRIVATE held identity" } } }).run();
    assert.equal(pending.error?.code, "identity_inventory_unconfirmed");
    assert.equal(review.error?.code, "identity_inventory_unconfirmed");
    assert.equal(pending.result?.diagnostic_stage, undefined);
    assert.equal(review.result?.diagnostic_stage, undefined);
    assert.deepEqual(warnings.map(value => JSON.parse(value)), [
      { event: "identity_read_failed", stage: "pending_inventory", sqlstate: "57014" },
      { event: "identity_read_failed", stage: "review_count", sqlstate: "57014" },
    ]);
    assert.doesNotMatch(JSON.stringify({ pending, review, warnings }), /PRIVATE|contact/);
  } finally {
    console.warn = prior;
  }
});
test("empty inventory succeeds with zero work; a full verified batch continues once", async () => {
  const empty = await fixture({ rows: [] }).run();
  assert.equal(empty.success, true);
  assert.equal(empty.recordsProcessed, 0);
  assert.equal(empty.continuation, undefined);
  const full = await fixture({ rows: [row(2), row(3)] }).run({ limit: 2 });
  assert.equal(full.success, true);
  assert.equal(full.continuation?.jobType, "identity.resolve");
  assert.deepEqual(full.continuation?.payload, { limit: 2 });
  const bounded = fixture({ rows: [] });
  await bounded.run({ limit: 2000 });
  assert.equal(bounded.calls[0].args.p_limit, 200);
});
test("legacy input without a pending event reports zero events consumed", async () => {
  const r = await fixture({
    respond: (_: any, r: any) => ({ data: { ...r, eventsConsumed: 0 }, error: null }),
  }).run();
  assert.equal(r.success, true);
  assert.equal(r.result?.events_consumed, 0);
});

test("persisted holds remain visible even when no new identity work is pending", async () => {
  const r = await fixture({ rows: [], review: { data: 4, error: null } }).run();
  assert.equal(r.success, false);
  assert.equal(r.result?.review_required, 4);
  assert.equal(r.error?.code, "identity_review_required");
  const failed = await fixture({
    rows: [],
    review: { data: null, error: { message: "PRIVATE" } },
  }).run();
  assert.equal(failed.success, false);
  assert.equal(failed.error?.code, "identity_inventory_unconfirmed");
});

const heldReceipt = (r: any) => ({ ...r, state: "review_required", reason: "direction_unverified",
  cardId: null, cardEnriched: false, personCreated: false, companyCreated: false,
  recommendations: 0, suggestions: 0, eventsConsumed: 0 });
test("a full mixed batch continues without declaring held identities complete", async () => {
  const r = await fixture({ rows: [row(2), row(3)], respond: (a: any, r: any) =>
    ({ data: a.p_interaction === id(3) ? heldReceipt(r) : r, error: null }) }).run({ limit: 2 });
  assert.equal(r.success, false);
  assert.equal(r.error?.code, "identity_review_required");
  assert.equal(r.error?.retryable, false);
  assert.equal(r.recordsProcessed, 1);
  assert.equal(r.result?.events_consumed, 1);
  assert.equal(r.result?.reviews_recorded, 1);
  assert.equal(r.result?.review_required, 1);
  assert.equal(r.result?.continued, true);
  assert.equal(r.continuation?.jobKey, `identity.resolve:${id(1)}`);
});
test("all-held full batch progresses, but a partial batch and empty inventory stop", async () => {
  for (const rows of [[row(2), row(3)], [row(2)], []]) {
    const r = await fixture({ rows, review: { data: 7, error: null },
      respond: (_: any, r: any) => ({ data: heldReceipt(r), error: null }) }).run({ limit: 2 });
    assert.equal(r.success, false);
    assert.equal(r.recordsProcessed, 0);
    assert.equal(r.result?.events_consumed, 0);
    assert.equal(r.result?.reviews_recorded, rows.length);
    assert.equal(r.result?.review_required, 7);
    assert.equal(!!r.continuation, rows.length === 2);
  }
});
test("existing unrelated holds cannot stop a full batch of confirmed cards", async () => {
  const r = await fixture({ rows: [row(2), row(3)], review: { data: 4, error: null } }).run({ limit: 2 });
  assert.equal(r.success, false);
  assert.equal(r.recordsProcessed, 2);
  assert.equal(r.result?.reviews_recorded, 0);
  assert.equal(r.result?.review_required, 4);
  assert.ok(r.continuation);
});
test("a review hold plus an unconfirmed delivery never continues or hides the failure", async () => {
  const r = await fixture({ rows: [row(2), row(3)], respond: (a: any, r: any) =>
    a.p_interaction === id(2) ? { data: heldReceipt(r), error: null } : { data: null, error: {} }
  }).run({ limit: 2 });
  assert.equal(r.error?.code, "identity_delivery_unconfirmed");
  assert.equal(r.result?.review_required, 1);
  assert.equal(r.result?.failed, 1);
  assert.equal(r.continuation, undefined);
});
