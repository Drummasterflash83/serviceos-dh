import assert from "node:assert/strict";
import test from "node:test";
import { readOwnerMoney } from "./learn-owner-money.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const audit = "33333333-3333-4333-8333-333333333333";
const scope = { tenant, actor, environment: "production" as const };
const group = () => ({
  realm_id: "12345", currency: "GBP", records: 2, missing_balances: 0,
  undated_positive: 0, negative_balances: 0,
  oldest_observed_at: "2026-10-18T10:00:00Z",
  newest_observed_at: "2026-10-19T10:00:00Z",
  newest_source_updated_at: "2026-10-19T09:00:00Z",
  outstanding: "12345678901234567890.12", overdue: "100.01", not_due: "12345678901234567790.11",
  overdue_1_30: "100.01", overdue_31_60: "0", overdue_61_90: "0",
  overdue_91_plus: "0",
});
const payload = () => ({
  version: "quickbooks-owner-money/1", tenant_id: tenant, actor_id: actor,
  environment: "production", operator_mode: false,
  coverage: "retained_unreconciled_invoices", source: "QuickBooks Online",
  as_of: "2026-10-19", read_at: new Date().toISOString(), audit_id: audit,
  records: 3, conflicted_records: 1, groups: [group()],
  overdue_invoice_count: 1,
  attention: [{ realm_id: "12345", currency: "GBP",
    source_version_id: "44444444-4444-4444-8444-444444444444",
    invoice_id: "921", document_number: "INV-921", customer_ref: "48",
    due_date: "2026-10-01", balance: "100.01",
    last_observed_at: "2026-10-19T10:00:00Z" }],
  accounts_gross_profit: { status: "unavailable", reason: "profit_and_loss_report_not_captured" },
  field_gross_profit: { status: "unavailable", reason: "job_cost_mapping_not_verified" },
  net_profit: { status: "withheld", reason: "owner_report_not_captured" },
  arr: { status: "unavailable", reason: "recurrence_not_verified" },
  further_works: { status: "unavailable", reason: "source_linkage_not_verified" },
});

test("retained invoice money remains an exact decimal string and labels absent metrics", () => {
  const result = readOwnerMoney(payload(), scope);
  assert.equal(result.groups[0].outstanding, "12345678901234567890.12");
  assert.equal(result.accounts_gross_profit.status, "unavailable");
  assert.equal(result.net_profit.status, "withheld");
  assert.equal(result.attention[0].source_version_id,
    "44444444-4444-4444-8444-444444444444");
});
test("rejects another tenant, fabricated profit and mismatched record coverage", () => {
  assert.throws(() => readOwnerMoney({ ...payload(), tenant_id: actor }, scope));
  assert.throws(() => readOwnerMoney({
    ...payload(), net_profit: { status: "available", value: "1000" },
  }, scope));
  assert.throws(() => readOwnerMoney({ ...payload(), records: 4 }, scope));
});
test("missing currency or invoice balance cannot produce a misleading total", () => {
  assert.throws(() => readOwnerMoney({
    ...payload(), groups: [{ ...group(), currency: null }],
  }, scope));
  assert.throws(() => readOwnerMoney({
    ...payload(), groups: [{ ...group(), missing_balances: 1 }],
  }, scope));
  const withheld = readOwnerMoney({
    ...payload(), groups: [{ ...group(), missing_balances: 1, outstanding: null,
      overdue: null, not_due: null, overdue_1_30: null, overdue_31_60: null,
      overdue_61_90: null, overdue_91_plus: null }],
  }, scope);
  assert.equal(withheld.groups[0].overdue, null);
});
test("rejects unsourced or future-dated overdue attention", () => {
  assert.throws(() => readOwnerMoney({
    ...payload(), attention: [{ ...payload().attention[0], source_version_id: "not-a-version" }],
  }, scope));
  assert.throws(() => readOwnerMoney({
    ...payload(), attention: [{ ...payload().attention[0], due_date: "2026-10-19" }],
  }, scope));
});
