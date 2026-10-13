import { test } from "node:test";
import assert from "node:assert/strict";
import { readCustomerContactPoints } from "./learn-customer-contact-points.ts";
const id = (n: number) => `cf820000-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const args = { tenant: id(1), actor: id(2), card: id(3), person: id(4) };
const row = (n: number) => ({
  id: id(n),
  channel: "phone",
  value: "01234567890",
  label: "Shared office",
  is_primary: false,
  verification_state: "unverified",
  source: "import",
  last_observed_at: null,
  updated_at: new Date().toISOString(),
  truncated_fields: [],
});
const response = () => ({
  version: "learn-customer-contact-points/1",
  tenant_id: args.tenant,
  actor_id: args.actor,
  card_id: args.card,
  person_id: args.person,
  after: null,
  operator_mode: false,
  audit_id: null,
  rows: [row(10)],
  total: 1,
  next_after: null,
  observed_at: new Date().toISOString(),
});
function db(data: any, error: any = null) {
  return {
    rpc(name: string, p: any) {
      assert.equal(name, "learn_customer_contact_points");
      assert.equal(p.p_tenant, args.tenant);
      assert.equal(p.p_card, args.card);
      assert.equal(p.p_person, args.person);
      return {
        abortSignal(signal: AbortSignal) {
          assert.ok(signal);
          return Promise.resolve({ data, error });
        },
      };
    },
  };
}
const read = (p: any, a: any = args) =>
  readCustomerContactPoints(db(p), a, new AbortController().signal);
test("non-primary, shared and invalid details retain their explicit state", async () => {
  const p: any = response();
  p.rows.push({
    ...row(11),
    channel: "email",
    value: "old@example.invalid",
    verification_state: "invalid",
  });
  p.total = 2;
  assert.deepEqual((await read(p)).rows, p.rows);
  assert.equal((await read(p)).rows[0].is_primary, false);
});
test("responses are bound to the selected tenant, actor, card, person and cursor", async () => {
  for (const field of ["tenant_id", "actor_id", "card_id", "person_id", "after"]) {
    const p: any = response();
    p[field] = id(99);
    await assert.rejects(read(p));
  }
  for (const field of ["tenant", "actor", "card", "person"]) {
    await assert.rejects(read(response(), { ...args, [field]: "invalid" }));
  }
});
test("operator reads require a matching audited mode and meaningful reason", async () => {
  const op = { ...args, operatorReason: "Review contact" };
  await assert.rejects(read(response(), op));
  const p: any = { ...response(), operator_mode: true, audit_id: id(99) };
  assert.equal((await read(p, op)).total, 1);
  await assert.rejects(read(p));
  p.audit_id = null;
  await assert.rejects(read(p, op));
  await assert.rejects(read(p, { ...op, operatorReason: " " }));
});
test("pages cannot duplicate points, cross cursors, overflow or invent a continuation", async () => {
  const p: any = {
    ...response(),
    rows: Array.from({ length: 25 }, (_, i) => row(10 + i)),
    total: 26,
    next_after: id(34),
  };
  assert.equal((await read(p)).next_after, id(34));
  for (const mutate of [
    (x: any) => x.rows.push(row(35)),
    (x: any) => (x.rows[1] = x.rows[0]),
    (x: any) => (x.next_after = id(33)),
    (x: any) => (x.next_after = null),
    (x: any) => (x.total = 25),
    (x: any) => (x.total = 0),
  ]) {
    const x = structuredClone(p);
    mutate(x);
    await assert.rejects(read(x));
  }
  const next = { ...response(), after: id(34), rows: [row(35)], total: 26 };
  assert.equal((await read(next, { ...args, after: id(34) })).rows.length, 1);
  await assert.rejects(read({ ...next, rows: [row(34)] }, { ...args, after: id(34) }));
});
test("unknown fields, malformed endpoints and stale observations fail visibly", async () => {
  for (const mutate of [
    (x: any) => (x.rows[0].metadata = { secret: "private" }),
    (x: any) => (x.rows[0].channel = "vault"),
    (x: any) => (x.rows[0].value = "x".repeat(4001)),
    (x: any) => (x.rows[0].label = "x".repeat(201)),
    (x: any) => (x.rows[0].verification_state = "trusted"),
    (x: any) => (x.rows[0].is_primary = "true"),
    (x: any) => (x.rows[0].updated_at = "invalid"),
    (x: any) => (x.rows[0].truncated_fields = ["secret"]),
    (x: any) => (x.observed_at = "2000-01-01"),
    (x: any) => (x.rows[0].source = "x".repeat(101)),
  ]) {
    const p: any = response();
    mutate(p);
    await assert.rejects(read(p));
  }
  await assert.rejects(
    readCustomerContactPoints(
      db(response(), { message: "unavailable" }),
      args,
      new AbortController().signal,
    ),
  );
});
test("bounded excerpts and empty pages are represented honestly", async () => {
  const p: any = response();
  p.rows[0].value = "😀".repeat(4000);
  p.rows[0].truncated_fields = ["value"];
  assert.equal((await read(p)).rows[0].truncated_fields[0], "value");
  const empty = { ...response(), rows: [], total: 0 };
  assert.deepEqual((await read(empty)).rows, []);
});
