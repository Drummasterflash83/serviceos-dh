import test from "node:test";
import assert from "node:assert/strict";
import { handleIdentityResolve } from "./identity_resolve.ts";
(globalThis as any).Deno = { env: { get: () => undefined } };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n = 2) => ({ interaction_id: id(n), source_revision: String(n % 10).repeat(64) });
function fixture(options: any = {}) {
  const calls: any[] = [];
  const reviews = new Set();
  const admin: any = {
    from() {
      throw Error("Direct identity/card writes forbidden");
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      if (name === "learn_identity_pending")
        return options.inventory ?? { data: options.rows ?? [row()], error: null };
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
test("empty inventory succeeds with zero work; a full verified batch continues once", async () => {
  const empty = await fixture({ rows: [] }).run();
  assert.equal(empty.success, true);
  assert.equal(empty.recordsProcessed, 0);
  assert.equal(empty.continuation, undefined);
  const full = await fixture({ rows: [row(2), row(3)] }).run({ limit: 2 });
  assert.equal(full.success, true);
  assert.equal(full.continuation?.jobType, "identity.resolve");
  assert.deepEqual(full.continuation?.payload, { limit: 2 });
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
