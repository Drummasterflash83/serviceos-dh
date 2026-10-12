import { test } from "node:test";
import assert from "node:assert/strict";
import { readCustomerBusinessContext } from "./learn-customer-business-context.ts";
const id = (n: number) => `cf820000-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const args = { tenant: id(1), actor: id(2), card: id(3), collection: "sites" as const };
const row = (n: number) => ({
  id: id(n),
  fields: {
    label: "Synthetic site",
    address_text: null,
    postcode: null,
    verified: false,
    source_system: "alternative-provider",
    external_id: "12",
    updated_at: null,
  },
  truncated_fields: [],
  sources: [],
});
const response = () => ({
  version: "learn-customer-business-context/1",
  tenant_id: args.tenant,
  actor_id: args.actor,
  card_id: args.card,
  collection: args.collection,
  after: null,
  operator_mode: false,
  audit_id: null,
  rows: [row(10)],
  total: 1,
  next_after: null,
  observed_at: new Date().toISOString(),
});
function db(data: any) {
  return {
    rpc(name: string, params: any) {
      assert.equal(name, "learn_customer_business_context");
      assert.equal(params.p_tenant, args.tenant);
      assert.equal(params.p_card, args.card);
      return {
        abortSignal(signal: AbortSignal) {
          assert.ok(signal);
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
}
test("canonical context binds tenant, actor, card and collection and accepts another provider", async () => {
  const r = await readCustomerBusinessContext(db(response()), args, new AbortController().signal);
  assert.equal(r.rows[0].fields.source_system, "alternative-provider");
  assert.equal(r.total, 1);
  for (const field of ["tenant_id", "actor_id", "card_id", "collection"]) {
    const p: any = response();
    p[field] = "foreign";
    await assert.rejects(readCustomerBusinessContext(db(p), args, new AbortController().signal));
  }
});
test("operator responses require their own audit and the requested operator mode", async () => {
  const op = { ...args, operatorReason: "Review client relationships" };
  await assert.rejects(
    readCustomerBusinessContext(db(response()), op, new AbortController().signal),
  );
  const p: any = { ...response(), operator_mode: true, audit_id: id(99) };
  assert.equal(
    (await readCustomerBusinessContext(db(p), op, new AbortController().signal)).rows.length,
    1,
  );
  await assert.rejects(readCustomerBusinessContext(db(p), args, new AbortController().signal));
  p.audit_id = null;
  await assert.rejects(readCustomerBusinessContext(db(p), op, new AbortController().signal));
});
test("pagination is ordered, bounded and cannot mix cursors or duplicate a row", async () => {
  const p: any = {
    ...response(),
    rows: Array.from({ length: 25 }, (_, n) => row(10 + n)),
    total: 26,
    next_after: id(34),
  };
  assert.equal(
    (await readCustomerBusinessContext(db(p), args, new AbortController().signal)).next_after,
    id(34),
  );
  for (const mutate of [
    (x: any) => x.rows.push(row(40)),
    (x: any) => (x.rows[1] = x.rows[0]),
    (x: any) => (x.next_after = id(35)),
    (x: any) => (x.after = id(5)),
    (x: any) => (x.total = 0),
  ]) {
    const x = structuredClone(p);
    mutate(x);
    await assert.rejects(readCustomerBusinessContext(db(x), args, new AbortController().signal));
  }
});
test("expired, malformed, private extra fields and invented source references fail visibly", async () => {
  for (const mutate of [
    (x: any) => (x.observed_at = "2000-01-01T00:00:00Z"),
    (x: any) => (x.rows[0].fields.secret = "private"),
    (x: any) => (x.rows[0].fields.label = true),
    (x: any) => (x.rows[0].truncated_fields = ["not_a_field"]),
    (x: any) => (x.rows[0].sources = [{ provider: "unknown" }]),
  ]) {
    const p: any = response();
    mutate(p);
    await assert.rejects(readCustomerBusinessContext(db(p), args, new AbortController().signal));
  }
});
