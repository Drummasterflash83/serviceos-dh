import assert from "node:assert/strict";
import test from "node:test";
import { readReportSummaryPreview } from "./learn-quickbooks-report-summary.ts";

const scope = { tenantId:"00000000-0000-0000-0000-000000000001",
  profitRequest:"00000000-0000-0000-0000-000000000002",
  receivablesRequest:"00000000-0000-0000-0000-000000000003" };
const receipt = { version:"quickbooks-report-summary-preview/1",audience:"openfolk_operator_only",
  tenant_id:scope.tenantId,realm_id:"123",environment:"production",
  profit_request:scope.profitRequest,receivables_request:scope.receivablesRequest,
  profit_sha256:"a".repeat(64),receivables_sha256:"b".repeat(64),
  period_start:"2026-09-01",period_end:"2026-09-30",accounting_method:"Accrual",
  ar_as_of:"2026-09-30",aging_method:"Report_Date",source:"QuickBooks Online",
  scope:"company_accounts_report_not_job_costing",
  audit_id:"00000000-0000-0000-0000-000000000004",
  summary:{currency:"GBP",accounts_gross_profit:"12345678901234567890.01",net_profit:"-10.02",
    ar_current:"1.00",ar_1_30:"2.00",ar_31_60:"3.00",ar_61_90:"4.00",
    ar_91_plus:"5.00",ar_total:"15.00"} };
test("saved report summary preserves exact decimals and source scope", () => {
  const read = readReportSummaryPreview(receipt,scope);
  assert.equal(read.summary.accountsGrossProfit,"12345678901234567890.01");
  assert.equal(read.summary.netProfit,"-10.02");
  assert.equal(read.currency,"GBP");
  assert.equal("raw_response" in read,false);
  for (const change of [{tenant_id:scope.profitRequest},{profit_request:scope.receivablesRequest},
    {audience:"client_owner"},{period_end:"2026-08-31"},{profit_sha256:"bad"},
    {summary:{...receipt.summary,ar_total:15.01}}])
    assert.throws(() => readReportSummaryPreview({...receipt,...change},scope));
});
