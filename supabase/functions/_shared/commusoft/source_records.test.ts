import { test } from "node:test";
import assert from "node:assert/strict";
import { commusoftSourceRecords } from "./source_records.ts";
import type { CommusoftPage, CommusoftResource } from "./read_page.ts";
const scope = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  connectionId: "00000000-0000-4000-8000-000000000002",
  resource: "properties" as CommusoftResource,
  observedAt: "2026-10-10T12:00:00.000Z",
};
const page = (records: Record<string, unknown>[]): CommusoftPage => ({
  records,
  nextCursor: null,
  collectionExhausted: true,
  rawEnvelope: { data: records },
  quota: { remaining: null, resetAt: null, retryAt: null },
});
test("customer and work address retain separate identities and explicit customer relationship", () => {
  const raw = [
    {
      id: 1,
      type: "customer",
      companyName: "Example company",
      contact: { firstName: "Example", lastName: "Contact" },
    },
    {
      id: 2,
      type: "workaddress",
      parentPropertyID: 1,
      addressLine1: "Example site",
      status: "dormant",
    },
  ];
  const result = commusoftSourceRecords(page(raw), scope);
  assert.equal(result[0].projection.state === "candidate" && result[0].projection.kind, "customer");
  assert.equal(result[1].projection.state === "candidate" && result[1].projection.kind, "site");
  assert.deepEqual(result[1].projection.state === "candidate" && result[1].projection.references, [
    { relation: "customer_property", target: result[0].identity },
  ]);
  assert.deepEqual(result[1].raw, raw[1]);
  raw[1].addressLine1 = "changed";
  assert.equal(result[1].raw.addressLine1, "Example site");
});
test("equal numeric IDs in jobs, contacts, properties and other connections remain distinct", () => {
  const result = ["jobs", "propertyContacts", "properties"].map(
    (resource) =>
      commusoftSourceRecords(page([{ id: 1, type: "customer", propertyID: 2 }]), {
        ...scope,
        resource: resource as CommusoftResource,
      })[0],
  );
  assert.equal(new Set(result.map((r) => JSON.stringify(r.identity))).size, 3);
  for (const r of result.slice(0, 2)) {
    assert.equal(r.projection.state, "candidate");
    if (r.projection.state === "candidate") {
      assert.equal(r.projection.references[0].target.collection, "properties");
      assert.equal(r.projection.references[0].target.externalId, "2");
      assert.equal(r.projection.references[0].target.tenantId, scope.tenantId);
    }
  }
  const other = commusoftSourceRecords(page([{ id: 1, type: "customer" }]), {
    ...scope,
    connectionId: scope.tenantId,
  });
  assert.notDeepEqual(other[0].identity, result[2].identity);
});
test("unresolved relationships and unknown property types held without losing original data", () => {
  const raw = [
    { id: 1, type: "unexpected", extra: { keep: true } },
    { id: 2, type: "workaddress" },
    { id: 3, type: "workaddress", parentPropertyID: 3 },
  ];
  const result = commusoftSourceRecords(page(raw), scope);
  assert.deepEqual(
    result.map((r) => r.projection),
    [
      { state: "held", reason: "unknown_property_type" },
      { state: "held", reason: "missing_property_reference" },
      { state: "held", reason: "self_parent_reference" },
    ],
  );
  assert.deepEqual(
    result.map((r) => r.raw),
    raw,
  );
  assert.equal(
    commusoftSourceRecords(page([{ id: 1 }]), { ...scope, resource: "jobs" })[0].projection.state,
    "held",
  );
});
test("source timestamps stay source data; observation does not invent historical coverage or scores", () => {
  const result = commusoftSourceRecords(
    page([{ id: 1, type: "customer", lastUpdatedOnDateTime: null }]),
    scope,
  )[0];
  assert.equal(result.raw.lastUpdatedOnDateTime, null);
  assert.equal(result.observedAt, scope.observedAt);
  assert.equal("score" in result, false);
  assert.equal("sourceUpdatedAt" in result, false);
});
test("invalid scope, impossible observation date, duplicate and unsafe IDs refused", () => {
  for (const change of [
    { tenantId: "bad" },
    { connectionId: "bad" },
    { observedAt: "2026-02-30T12:00:00.000Z" },
  ]) {
    assert.throws(
      () => commusoftSourceRecords(page([{ id: 1 }]), { ...scope, ...change }),
      /scope_invalid/,
    );
  }
  for (const records of [
    [{ id: 1 }, { id: 1 }],
    [{ id: Number.MAX_SAFE_INTEGER + 1 }],
    [{ id: "1" }],
  ]) {
    assert.throws(() => commusoftSourceRecords(page(records), scope), /identity_invalid/);
  }
});
