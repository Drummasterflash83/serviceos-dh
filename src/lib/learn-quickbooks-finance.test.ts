import test from "node:test";
import assert from "node:assert/strict";
import {
  financeAmount,
  readFinanceCandidates,
  readFinancePage,
  type FinanceScope,
} from "./learn-quickbooks-finance.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: FinanceScope = {
  tenant: id(1),
  actor: id(2),
  card: id(3),
  environment: "production",
  operatorReason: "Review customer",
};
function base() {
  const time = new Date().toISOString();
  return {
    version: "quickbooks-customer-finance/1",
    tenant_id: scope.tenant,
    actor_id: scope.actor,
    card_id: scope.card,
    environment: "production",
    operator_mode: true,
    after: null,
    next_after: null,
    audit_id: id(4),
    observed_at: time,
    records: 1,
    linked_customers: 1,
    links_needing_review: 0,
    conflicted_records: 0,
    coverage: "retained_unreconciled_records",
    rows: [
      {
        version_id: id(5),
        realm_id: "123",
        entity: "Invoice",
        external_id: "91",
        document_number: "I-91",
        transaction_date: "2026-10-13",
        due_date: null,
        currency: "GBP",
        amount: "9007199254740993.01",
        balance: "0.10",
        source_updated_at: null,
        last_observed_at: time,
      },
    ],
    groups: [
      {
        realm_id: "123",
        currency: "GBP",
        entity: "Invoice",
        records: 1,
        missing_amounts: 0,
        missing_balances: 0,
        total: "9007199254740993.01",
        outstanding: "0.10",
        oldest_observation: time,
        newest_observation: time,
      },
    ],
  };
}
test("exact amounts reach presentation without Number rounding", () => {
  const result = readFinancePage(base(), scope);
  assert.equal(financeAmount(result.groups[0].total, "GBP"), "GBP 9,007,199,254,740,993.01");
  assert.equal(financeAmount("-1000.10", "GBP"), "GBP -1,000.10");
  assert.equal(financeAmount(null, "GBP"), "Not available");
});
test("finance responses cannot cross actor, tenant, card, environment or mode", () => {
  for (const patch of [
    { tenant_id: id(99) },
    { actor_id: id(99) },
    { card_id: id(99) },
    { environment: "sandbox" },
    { operator_mode: false },
    { audit_id: null },
    { coverage: "complete" },
    { observed_at: new Date(Date.now() - 120000).toISOString() },
    { after: id(6) },
    { next_after: id(5) },
    { records: 2 },
  ])
    assert.throws(() => readFinancePage({ ...base(), ...patch }, scope));
});
test("unknown currency, partial amounts and duplicate summaries cannot masquerade as totals", () => {
  for (const patch of [
    { total: 9 },
    { outstanding: 1 },
    { currency: null },
    { missing_amounts: 1 },
    { missing_balances: 1 },
    { entity: "Payment" },
  ]) {
    const p = base();
    Object.assign(p.groups[0], patch);
    assert.throws(() => readFinancePage(p, scope));
  }
  const p = base();
  p.groups.push(p.groups[0]);
  p.records = 2;
  assert.throws(() => readFinancePage(p, scope));
  const unknown = base();
  Object.assign(unknown.groups[0], { currency: null, total: null, outstanding: null });
  assert.equal(readFinancePage(unknown, scope).groups[0].total, null);
});
test("link review rejects malformed revisions, foreign scope and unlogged reads", () => {
  const p = {
    ...base(),
    version: "quickbooks-customers/1",
    rows: [
      {
        version_id: id(5),
        realm_id: "123",
        external_id: "C1",
        name: "Example customer",
        email: null,
        phone: null,
        address: null,
        parent_id: null,
        conflicted: false,
        last_observed_at: new Date().toISOString(),
        card_id: null,
        revision: "0",
      },
    ],
  };
  assert.equal(readFinanceCandidates(p, scope).rows[0].revision, "0");
  assert.throws(() => readFinanceCandidates(p, { ...scope, operatorReason: undefined }));
  assert.throws(() => readFinanceCandidates({ ...p, tenant_id: id(99) }, scope));
  assert.throws(() =>
    readFinanceCandidates({ ...p, rows: [{ ...p.rows[0], revision: 0 }] }, scope),
  );
});
