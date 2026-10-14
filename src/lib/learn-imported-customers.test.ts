import test from "node:test";
import assert from "node:assert/strict";
import { readImportedCustomers, type ImportedScope } from "./learn-imported-customers.ts";
import { readImportedCustomerDetail, type SourceDetailScope } from "./learn-imported-customer-detail.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const when = () => new Date().toISOString();
const scope: ImportedScope = { tenant: id(1), actor: id(2), environment: "production", provider: "all", query: "", after: null, group: null, operatorReason: "Review captured customer" };
const cs = { key: `commusoft:${id(3)}:664`, provider: "commusoft", scope: id(3), external_id: "664", version_id: id(4), name: "Example customer", contact_name: null, email: null, phone: null, address: "Example Road", active: null, observed_at: when(), source_updated_at: null, review_state: "reviewed" };
const qb = { key: "quickbooks:1197397945:17937", provider: "quickbooks", scope: "1197397945", external_id: "17937", version_id: id(5), name: "Example customer", contact_name: null, email: null, phone: null, address: "Different billing address", active: true, observed_at: when(), source_updated_at: null, review_state: "reviewed" };
function catalog() {
  return { version: "imported-customer-catalog/1", coverage: "retained_source_accounts", tenant_id: scope.tenant, actor_id: scope.actor, environment: scope.environment, provider: scope.provider, query: scope.query, after: scope.after, group: scope.group, operator_mode: true, audit_id: id(6), observed_at: when(), rows: [{ key: `card:${id(7)}`, card_id: id(7), name: "Example customer", sources: [cs, qb], total_sources: 2 }], next_after: null, counts: { commusoft_records: 1, quickbooks_accounts: 1, displayed_accounts: 1, matched_accounts: 1, unreviewed_records: 0, records_needing_review: 0, matching_results: 1 } };
}
test("only an explicitly reviewed two-source card is accepted as combined", () => {
  const page = readImportedCustomers(catalog(), scope);
  assert.equal(page.rows[0].sources.length, 2);
  assert.equal(page.rows[0].card_id, id(7));
  assert.notEqual(page.rows[0].sources[0].address, page.rows[0].sources[1].address);
  const unreviewed = catalog();
  unreviewed.rows[0].sources[1].review_state = "unreviewed";
  assert.throws(() => readImportedCustomers(unreviewed, scope));
});
test("catalogue rejects a different actor, tenant, environment or missing audit receipt", () => {
  for (const change of [{ actor_id: id(9) }, { tenant_id: id(9) }, { environment: "sandbox" }, { audit_id: null }])
    assert.throws(() => readImportedCustomers({ ...catalog(), ...change }, scope));
});
test("captured source details preserve exact money and reject a changed source version", () => {
  const detailScope: SourceDetailScope = { tenant: scope.tenant, actor: scope.actor, environment: "production", source: qb.key, sourceVersion: qb.version_id, kind: "transactions", after: null, operatorReason: scope.operatorReason };
  const page = { version: "imported-customer-detail/1", coverage: "native_source_relationships", tenant_id: detailScope.tenant, actor_id: detailScope.actor, environment: "production", source_key: qb.key, source_version: qb.version_id, kind: "transactions", after: null, operator_mode: true, audit_id: id(8), observed_at: when(), total: 1, held: 0, next_after: null, rows: [{ version_id: id(9), external_id: "INV-1", entity: "Invoice", title: "Invoice · INV-1", status: null, email: null, phone: null, address: null, role: null, parent_reference: qb.external_id, transaction_date: "2026-10-14", due_date: null, amount: "9007199254740993.01", balance: "0.10", currency: "GBP", observed_at: when() }] };
  assert.equal(readImportedCustomerDetail(page, detailScope).rows[0].amount, "9007199254740993.01");
  assert.throws(() => readImportedCustomerDetail({ ...page, source_version: id(10) }, detailScope));
  assert.throws(() => readImportedCustomerDetail({ ...page, actor_id: id(10) }, detailScope));
});
