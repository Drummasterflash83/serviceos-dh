import assert from "node:assert/strict";
import test from "node:test";
import { canReadFounderAccountsPreview, readSeptemberFounderAccountsPreview } from "./new-dawn-founder-accounts-preview.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const profitRequest = "00000000-0000-0000-0000-000000000002";
const receivablesRequest = "00000000-0000-0000-0000-000000000003";
const scope = { tenantId, profitRequest, receivablesRequest };
const ready = { operator:true, jobPreviewOpened:true, flagEnabled:true,
  profitRequest, receivablesRequest, reason:"Review saved accounts", reviewed:true };
const response = { version:"quickbooks-report-summary-preview/1", audience:"openfolk_operator_only",
  tenant_id:tenantId, realm_id:"123", environment:"production",
  profit_request:profitRequest, receivables_request:receivablesRequest,
  profit_sha256:"a".repeat(64), receivables_sha256:"b".repeat(64),
  period_start:"2026-09-01", period_end:"2026-09-30", accounting_method:"Accrual",
  ar_as_of:"2026-09-30", aging_method:"Report_Date", source:"QuickBooks Online",
  scope:"company_accounts_report_not_job_costing",
  audit_id:"00000000-0000-0000-0000-000000000004",
  summary:{currency:"GBP", accounts_gross_profit:"12345678901234567890.01", net_profit:"-10.02",
    ar_current:"1.00",ar_1_30:"2.00",ar_31_60:"3.00",ar_61_90:"4.00",
    ar_91_plus:"5.00",ar_total:"15.00"} };

test("founder accounts preview requires operator, open job preview, flag and reviewed exact pair", () => {
  assert.equal(canReadFounderAccountsPreview(ready),true);
  for (const change of [{operator:false},{jobPreviewOpened:false},{flagEnabled:false},
    {reviewed:false},{profitRequest:receivablesRequest},{profitRequest:"not-an-id"},
    {reason:" "},{reason:"x".repeat(501)}])
    assert.equal(canReadFounderAccountsPreview({...ready,...change}),false);
});

test("September accounts preview accepts only exact saved-report scope and decimal strings", () => {
  const result=readSeptemberFounderAccountsPreview(response,scope);
  assert.equal(result.accountsGrossProfit,"12345678901234567890.01");
  assert.equal(result.netProfit,"-10.02");
  assert.equal("summary" in result,false);
  assert.equal("arTotal" in result,false);
  for (const change of [{audience:"client_owner"},{tenant_id:profitRequest},
    {period_end:"2026-10-31"},{accounting_method:"Cash"},{environment:"sandbox"},
    {summary:{...response.summary,net_profit:10.02}}])
    assert.throws(()=>readSeptemberFounderAccountsPreview({...response,...change},scope));
});
