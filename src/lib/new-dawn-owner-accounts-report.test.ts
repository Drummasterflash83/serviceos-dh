import assert from "node:assert/strict";
import test from "node:test";
import {
  canReadPublishedOwnerAccounts,
  readPublishedOwnerAccounts,
  requestPublishedOwnerAccounts,
} from "./new-dawn-owner-accounts-report.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";
const gate = {
  tenant,
  userId,
  profileTenant: tenant,
  role: "owner",
  operator: false,
  platformAuthorityCleared: true,
  flagEnabled: true,
};
const response = {
  version: "owner-accounts-report/1",
  audience: "client_owner_only",
  tenant_id: tenant,
  source: "QuickBooks Online",
  scope: "published_company_accounts_not_job_costing",
  realm_id: "123",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  accounting_method: "Accrual",
  ar_as_of: "2026-09-30",
  currency: "GBP",
  publication_revision: 1,
  accounts_gross_profit: "12345678901234567890.01",
  net_profit: "-10.02",
  aged_receivables: {
    current: "1.00",
    age_1_30: "2.00",
    age_31_60: "3.00",
    age_61_90: "4.00",
    age_91_plus: "5.00",
    total: "15.00",
  },
  field_gross_profit: { status: "held", reason: "job_cost_mapping_not_verified" },
  arr: { status: "held", reason: "recurring_contract_not_verified" },
  audit_id: "00000000-0000-0000-0000-000000000003",
};

test("only a signed-in same-tenant owner with the separate flag can start the owner RPC", async () => {
  let calls = 0;
  const read = async (target: string) => {
    calls++;
    assert.equal(target, tenant);
    return response;
  };
  const report = await requestPublishedOwnerAccounts(gate, read);
  assert.equal(calls, 1);
  assert.equal(report.netProfit, "-10.02");
  for (const change of [
    { role: "admin" },
    { role: "ops" },
    { role: "viewer" },
    { operator: true },
    { platformAuthorityCleared: false },
    { flagEnabled: false },
    { profileTenant: userId },
    { userId: null },
    { tenant: "not-a-tenant" },
  ]) {
    const denied = { ...gate, ...change };
    assert.equal(canReadPublishedOwnerAccounts(denied), false);
    await assert.rejects(requestPublishedOwnerAccounts(denied, read), /owner_accounts_denied/);
  }
  assert.equal(calls, 1, "denied roles and contexts must never invoke the RPC");
});

test("strict owner envelope keeps exact decimals and drops A/R amounts from the UI projection", () => {
  const report = readPublishedOwnerAccounts(response, tenant);
  assert.equal(report.accountsGrossProfit, "12345678901234567890.01");
  assert.equal(report.netProfit, "-10.02");
  assert.equal("agedReceivables" in report, false);
  assert.equal("profitRequest" in report, false);
  for (const change of [
    { audience: "openfolk_operator_only" },
    { tenant_id: userId },
    { publication_revision: 0 },
    { accounts_gross_profit: 123.45 },
    { net_profit: "1e8" },
    { currency: "GBP £" },
    { period_end: "2026-10-31" },
    { field_gross_profit: { status: "available", reason: "job_cost_mapping_not_verified" } },
    { aged_receivables: { ...response.aged_receivables, total: "12.2x" } },
    { summary: { net_profit: "1.00" } },
  ])
    assert.throws(
      () => readPublishedOwnerAccounts({ ...response, ...change }, tenant),
      /owner_accounts_invalid/,
    );
});
