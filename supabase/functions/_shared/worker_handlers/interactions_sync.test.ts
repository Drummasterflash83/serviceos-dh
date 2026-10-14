import test from "node:test";
import assert from "node:assert/strict";
import { handleInteractionsSync } from "./interactions_sync.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n = 2, kind = "phone") => ({
  source_kind: kind,
  source_id: id(n),
  source_revision: String(n % 10).repeat(64),
});
function fixture(options: any = {}) {
  const calls: any[] = [];
  const admin: any = {
    from() {
      throw Error("Direct source or interaction writes forbidden");
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      if (name === "learn_projection_pending")
        return options.inventory ?? { data: options.rows ?? [row()], error: null };
      if (name === "learn_projection_review_count")
        return options.review ?? { data: 0, error: null };
      assert.equal(name, "learn_project_interaction");
      assert.equal(args.p_tenant, id(1));
      const receipt = {
        version: "learn-interaction-projection/1",
        state: "committed",
        tenantId: id(1),
        requestId: args.p_request,
        sourceKind: args.p_source,
        sourceId: args.p_source_id,
        sourceRevision: args.p_revision,
        interactionId: id(20),
        eventId: id(21),
        action: "created",
      };
      return options.respond ? options.respond(args, receipt) : { data: receipt, error: null };
    },
  };
  return {
    calls,
    run: (payload: any = {}) =>
      handleInteractionsSync({ supabaseAdmin: admin, tenantId: id(1), jobId: id(90), payload }),
  };
}
test("Phone and Email receipts count only confirmed interaction/event transactions", async () => {
  const f = fixture({ rows: [row(), row(3, "email")] }),
    r = await f.run();
  assert.equal(r.success, true);
  assert.equal(r.recordsProcessed, 2);
  assert.equal(r.result?.phone_created, 1);
  assert.equal(r.result?.email_created, 1);
  assert.equal(f.calls.length, 4);
});
test("lost reply inspects the exact request once without repeating publication", async () => {
  const f = fixture({
      respond: (a: any, r: any) => {
        if (a.p_phase === "publish") throw Error("Synthetic response loss");
        return { data: r, error: null };
      },
    }),
    r = await f.run();
  assert.equal(r.success, true);
  assert.deepEqual(
    f.calls.slice(1, -1).map((c) => c.args.p_phase),
    ["publish", "inspect"],
  );
  assert.equal(f.calls[1].args.p_request, f.calls[2].args.p_request);
});
test("mixed outcome retains confirmed counts and reports failure without continuation", async () => {
  const f = fixture({
      rows: [row(), row(3, "email")],
      respond: (a: any, r: any) =>
        a.p_source === "email"
          ? { data: null, error: { message: "PRIVATE" } }
          : { data: r, error: null },
    }),
    r = await f.run({ limit: 2 });
  assert.equal(r.success, false);
  assert.equal(r.recordsProcessed, 1);
  assert.equal(r.result?.failed, 1);
  assert.equal(r.error?.code, "projection_unconfirmed");
  assert.equal(r.continuation, undefined);
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
});
test("persistent held work stays visible even on an otherwise empty run", async () => {
  const r = await fixture({ rows: [], review: { data: 2, error: null } }).run();
  assert.equal(r.success, false);
  assert.equal(r.result?.review_required, 2);
  assert.equal(r.error?.code, "projection_review_required");
  assert.equal(r.error?.retryable, false);
  assert.equal(r.recordsProcessed, 0);
});
test("new held receipt does not count as written or failed", async () => {
  const f = fixture({
      respond: (_: any, r: any) => ({
        data: {
          ...r,
          state: "review_required",
          action: "held",
          reason: "canonical_fields_changed",
          eventId: null,
        },
        error: null,
      }),
      review: { data: 1, error: null },
    }),
    r = await f.run();
  assert.equal(r.success, false);
  assert.equal(r.recordsProcessed, 0);
  assert.equal(r.result?.review_required, 1);
  assert.equal(r.result?.failed, 0);
});
test("a full reviewed batch keeps the hold visible and continues unrelated sources", async () => {
  const f = fixture({
    rows: [row(), row(3, "email")],
    review: { data: 1, error: null },
    respond: (a: any, r: any) =>
      a.p_source === "email"
        ? {
            data: {
              ...r,
              state: "review_required",
              action: "held",
              reason: "canonical_fields_changed",
              eventId: null,
            },
            error: null,
          }
        : { data: r, error: null },
  });
  const r = await f.run({ limit: 2 });
  assert.equal(r.success, false);
  assert.equal(r.recordsProcessed, 1);
  assert.equal(r.result?.reviews_recorded, 1);
  assert.equal(r.result?.continued, true);
  assert.equal(r.error?.code, "projection_review_required");
  assert.equal(r.continuation?.jobType, "interactions.sync");
});
test("foreign, stale and contradictory receipts cannot confirm publication", async () => {
  for (const patch of [
    { tenantId: id(8) },
    { requestId: id(8) },
    { sourceId: id(8) },
    { sourceKind: "email" },
    { sourceRevision: "f".repeat(64) },
    { state: "unknown" },
    { interactionId: null },
    { eventId: null },
    { action: "unchanged" },
    { state: "review_required", action: "held", eventId: null },
  ]) {
    const r = await fixture({
      respond: (_: any, r: any) => ({ data: { ...r, ...patch }, error: null }),
    }).run();
    assert.equal(r.success, false, JSON.stringify(patch));
    assert.equal(r.result?.failed, 1);
  }
  const invalid = await fixture({
    rows: [row(3, "email")],
    respond: (_: any, r: any) => ({
      data: { ...r, action: "authoritative_phone_refresh" },
      error: null,
    }),
  }).run();
  assert.equal(invalid.success, false);
});
test("missing, duplicate, over-limit or cross-source inventory prevents publication", async () => {
  for (const inventory of [
    { data: null, error: { message: "PRIVATE" } },
    { data: [row(), row()], error: null },
    { data: [{ ...row(), source_revision: "bad" }], error: null },
    { data: {}, error: null },
    { data: [row(3, "email")], error: null },
    { data: [row(), row(3)], error: null },
  ]) {
    const f = fixture({ inventory }),
      r = await f.run({ source: "phone", limit: 1 });
    assert.equal(r.success, false);
    assert.equal(f.calls.length, 1);
  }
  const invalid = fixture();
  assert.equal((await invalid.run({ source: "slack" })).error?.code, "projection_source_invalid");
  assert.equal(invalid.calls.length, 0);
});
test("bounded full batch requests continuation; empty or unchanged batches stop", async () => {
  const f = fixture({ rows: [row(), row(3, "email")] }),
    r = await f.run({ limit: 2 });
  assert.equal(r.continuation?.jobType, "interactions.sync");
  assert.deepEqual(r.continuation?.payload, { source: "all", limit: 2 });
  const large = fixture({ rows: [] });
  await large.run({ limit: 2000 });
  assert.equal(large.calls[0].args.p_limit, 200);
  const empty = await fixture({ rows: [] }).run();
  assert.equal(empty.success, true);
  assert.equal(empty.continuation, undefined);
  const unchanged = await fixture({
    respond: (_: any, r: any) => ({
      data: { ...r, action: "unchanged", eventId: null },
      error: null,
    }),
  }).run({ limit: 1 });
  assert.equal(unchanged.success, true);
  assert.equal(unchanged.result?.phone_skipped, 1);
  assert.equal(unchanged.continuation, undefined);
});
test("review inventory failure cannot erase previously confirmed work", async () => {
  for (const review of [
    { data: null, error: { message: "PRIVATE" } },
    { data: -1, error: null },
    { data: "0", error: null },
  ]) {
    const r = await fixture({ review }).run();
    assert.equal(r.success, false);
    assert.equal(r.recordsProcessed, 1);
    assert.equal(r.error?.code, "projection_inventory_unconfirmed");
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
});
