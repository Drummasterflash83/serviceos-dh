// Run: node --test supabase/functions/_shared/controlplane/comm_relevance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapReason } from "./comm_relevance.ts";

test("noise reasons map to not_relevant classes", () => {
  assert.deepEqual(mapReason("marketing").relevance, "not_relevant");
  assert.equal(mapReason("marketing").commClass, "marketing_newsletter");
  assert.equal(mapReason("automated_notification").commClass, "system_notification");
  assert.equal(mapReason("automated_notification").relevance, "not_relevant");
  assert.equal(mapReason("outbound_no_signal").commClass, "internal");
  assert.equal(mapReason("outbound_no_signal").relevance, "not_relevant");
  assert.equal(mapReason("empty").commClass, "spam_noise");
});

test("operational reasons map to relevant customer/supplier classes", () => {
  assert.equal(mapReason("customer_risk").commClass, "operational_customer");
  assert.equal(mapReason("customer_risk").relevance, "relevant");
  assert.equal(mapReason("sales_opportunity").commClass, "operational_customer");
  assert.equal(mapReason("supplier_risk").commClass, "supplier_vendor");
});

test("customer_context is relevant but honestly flagged (header-less marketing leaks in)", () => {
  const v = mapReason("customer_context");
  assert.equal(v.commClass, "operational_customer");
  assert.equal(v.relevance, "relevant");
  assert.match(v.note ?? "", /marketing|header/i);
});

test("unknown/absent reason is uncertain, never asserted as a customer relationship", () => {
  assert.equal(mapReason(null).commClass, "unknown");
  assert.equal(mapReason(null).relevance, "uncertain");
  assert.equal(mapReason("unclassified_inbound").commClass, "unknown");
});
