import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmCommusoftCustomer,
  findCommusoftCustomers,
  loadCommusoftReviewPage,
  type ReviewClient,
} from "./learn-commusoft-review.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const summary = {
  person_name: "Synthetic Person",
  company_name: null,
  email: null,
  phone: null,
  address: null,
  postcode: null,
  source_type: "customer",
  customer_type: "45",
};
const row = {
  version_id: id(3),
  external_id: "1",
  observed_at: "2026-10-10T08:00:00Z",
  summary,
  link: null,
};
const page = () => ({
  tenant_id: id(1),
  connection_id: id(2),
  rows: [structuredClone(row)],
  next_cursor: null,
});
const client = (data: unknown): ReviewClient => ({ rpc: async () => ({ data, error: null }) });
test("review page strips unrequested fields and refuses cross-company data", async () => {
  const d = { ...page(), private_metadata: "must not leak" };
  (d.rows[0] as any).payload = { private: true };
  const r = await loadCommusoftReviewPage(client(d), id(1), id(2));
  assert.deepEqual(r.rows, [row]);
  await assert.rejects(loadCommusoftReviewPage(client({ ...d, tenant_id: id(99) }), id(1), id(2)));
  await assert.rejects(
    loadCommusoftReviewPage(client({ ...d, connection_id: id(99) }), id(1), id(2)),
  );
});
test("source pagination refuses duplicates and invalid continuation", async () => {
  await assert.rejects(
    loadCommusoftReviewPage(client({ ...page(), rows: [row, row] }), id(1), id(2)),
  );
  await assert.rejects(
    loadCommusoftReviewPage(client({ ...page(), next_cursor: "9" }), id(1), id(2)),
  );
  await assert.rejects(loadCommusoftReviewPage(client(page()), id(1), id(2), "1"));
});
test("malformed source fields do not become display strings", async () => {
  const d = page();
  (d.rows[0].summary as any).email = { key: "private" };
  await assert.rejects(loadCommusoftReviewPage(client(d), id(1), id(2)));
});
test("candidate data remains bound to source, company and customer kind", async () => {
  const d = {
    tenant_id: id(1),
    version_id: id(3),
    kind: "person",
    rows: [
      {
        id: id(4),
        name: "Same name",
        email: null,
        phone: null,
        postcode: null,
        reason: "same_name",
      },
    ],
    next_cursor: null,
  };
  assert.equal(
    (await findCommusoftCustomers(client(d), id(1), id(3), "person", "")).rows[0].reason,
    "same_name",
  );
  for (const change of [
    { tenant_id: id(99) },
    { version_id: id(99) },
    { kind: "company" },
    { next_cursor: id(99) },
  ])
    await assert.rejects(
      findCommusoftCustomers(client({ ...d, ...change }), id(1), id(3), "person", ""),
    );
});
test("confirmation sends no actor and accepts only the requested target/kind", async () => {
  let args: any;
  const db: ReviewClient = {
    rpc: async (name, a) => {
      assert.equal(name, "learn_commusoft_confirm_customer");
      args = a;
      return {
        data: {
          link_id: id(5),
          entity_id: id(4),
          card_id: id(6),
          entity_table: "people",
          already: false,
          secret: "ignored",
        },
        error: null,
      };
    },
  };
  const input = {
    tenant: id(1),
    version: id(3),
    kind: "person" as const,
    target: id(4),
    reason: " Reviewed identity ",
  };
  assert.deepEqual(await confirmCommusoftCustomer(db, input), {
    linkId: id(5),
    entityId: id(4),
    cardId: id(6),
    already: false,
  });
  assert.equal(args.p_reason, "Reviewed identity");
  assert.ok(!("p_actor" in args));
  await assert.rejects(confirmCommusoftCustomer(db, { ...input, target: id(99) }));
});
test("lost acknowledgement never causes an automatic write retry or exposes errors", async () => {
  let calls = 0;
  const db: ReviewClient = {
    rpc: async () => {
      calls++;
      throw Error("sensitive provider data");
    },
  };
  await assert.rejects(
    confirmCommusoftCustomer(db, {
      tenant: id(1),
      version: id(3),
      kind: "company",
      target: null,
      reason: "Reviewed company",
    }),
    /Save not confirmed/,
  );
  assert.equal(calls, 1);
});
test("matching endpoints retain bounded evidence without private fields or requiring a new backend", async () => {
  const candidate = {
    id: id(4),
    name: "Existing person",
    email: null,
    phone: null,
    postcode: null,
    reason: "shared_email",
  };
  const envelope = (match: unknown, include = true) => ({
    tenant_id: id(1),
    version_id: id(3),
    kind: "person",
    rows: [{ ...candidate, ...(include ? { match_detail: match } : {}) }],
    next_cursor: null,
  });
  const find = (data: unknown) => findCommusoftCustomers(client(data), id(1), id(3), "person", "");
  const match = {
    channel: "email",
    value: "shared@example.invalid",
    private_metadata: "must not leak",
  };
  assert.deepEqual((await find(envelope(match))).rows[0], {
    ...candidate,
    match_detail: { channel: "email", value: "shared@example.invalid" },
  });
  assert.deepEqual((await find(envelope(null, false))).rows[0], candidate);
  assert.equal((await find(envelope(null))).rows[0].match_detail, null);
  for (const invalid of [
    [],
    "phone",
    { channel: "secret", value: "test" },
    { channel: "email", value: " " },
    { channel: "phone", value: false },
    { channel: "email", value: "x".repeat(1001) },
  ]) {
    await assert.rejects(find(envelope(invalid)));
  }
});
