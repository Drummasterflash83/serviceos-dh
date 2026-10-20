import assert from "node:assert/strict";
import test from "node:test";
import { readAccountsMarginPreview } from "./new-dawn-accounts-margin.ts";
import type { AccountsPair, FounderAccountsPreview } from "./new-dawn-founder-accounts-preview.ts";

const tenant="00000000-0000-0000-0000-000000000001";
const actor="00000000-0000-0000-0000-000000000002";
const pair: AccountsPair={
  profitRequest:"00000000-0000-0000-0000-000000000003",
  receivablesRequest:"00000000-0000-0000-0000-000000000004",
  periodStart:"2026-09-01",periodEnd:"2026-09-30",accountingMethod:"Accrual",
  arAsOf:"2026-09-30",currency:"GBP",realmId:"123",
  profitReceivedAt:"2026-10-01T10:00:00Z",receivablesReceivedAt:"2026-10-01T10:01:00Z",
  profitSha256:"a".repeat(64),receivablesSha256:"b".repeat(64),
};
const saved: FounderAccountsPreview={
  currency:"GBP",realmId:"123",periodStart:pair.periodStart,periodEnd:pair.periodEnd,
  accountingMethod:"Accrual",arAsOf:pair.arAsOf,profitSha256:pair.profitSha256,
  receivablesSha256:pair.receivablesSha256,auditId:"00000000-0000-0000-0000-000000000005",
  profitReceivedAt:pair.profitReceivedAt,receivablesReceivedAt:pair.receivablesReceivedAt,
  accountsGrossProfit:"250.00",netProfit:"100.00",
  receivables:{current:"0",days1To30:"0",days31To60:"0",days61To90:"0",
    days91Plus:"0",total:"0"},
};
const response={version:"quickbooks-accounts-margin-preview/1",
  audience:"openfolk_operator_only",tenant_id:tenant,actor_id:actor,
  source:"QuickBooks Online",scope:"company_accounts_not_job_margin",
  realm_id:"123",environment:"production",currency:"GBP",
  profit_request:pair.profitRequest,receivables_request:pair.receivablesRequest,
  profit_sha256:pair.profitSha256,receivables_sha256:pair.receivablesSha256,
  period_start:pair.periodStart,period_end:pair.periodEnd,accounting_method:"Accrual",
  total_income:"1000.00",accounts_gross_profit:"250.00",
  accounts_gross_margin_pct:"25.00",denominator:"QuickBooks Total Income",
  target_comparison:"withheld_unconfirmed_accounts_or_field_basis",
  audit_id:"00000000-0000-0000-0000-000000000006",
  report_summary_audit_id:"00000000-0000-0000-0000-000000000007"};

test("accounts margin accepts only the exact saved operator pair and never a target claim",()=>{
  const scope={tenant,actor,pair,saved};
  assert.deepEqual(readAccountsMarginPreview(response,scope),{
    totalIncome:"1000.00",accountsGrossProfit:"250.00",accountsGrossMarginPct:"25.00",
    auditId:response.audit_id,reportSummaryAuditId:response.report_summary_audit_id});
  for(const change of [
    {audience:"client_owner"},{actor_id:tenant},{tenant_id:actor},
    {environment:"sandbox"},{scope:"job_margin"},{period_end:"2026-08-31"},
    {profit_sha256:"c".repeat(64)},{accounts_gross_profit:"251.00"},
    {total_income:"0"},{total_income:"-1"},{accounts_gross_margin_pct:"25.001"},
    {accounts_gross_margin_pct:"24.99"},
    {target_comparison:"met"},{net_profit:"100.00"},
  ]) assert.throws(()=>readAccountsMarginPreview({...response,...change},scope),/accounts_margin_invalid/);
});
