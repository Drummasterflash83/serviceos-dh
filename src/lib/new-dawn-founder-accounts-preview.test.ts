import assert from "node:assert/strict";
import test from "node:test";
import { accountsPeriodCoverage, canReadFounderAccountsPreview,
  readFounderAccountsPairs, readFounderAccountsPreview } from "./new-dawn-founder-accounts-preview.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const actorId = "00000000-0000-0000-0000-000000000005";
const profitRequest = "00000000-0000-0000-0000-000000000002";
const receivablesRequest = "00000000-0000-0000-0000-000000000003";
const candidate = {profit_request:profitRequest,receivables_request:receivablesRequest,
  period_start:"2026-10-01",period_end:"2026-10-18",accounting_method:"Accrual",
  ar_as_of:"2026-10-18",currency:"GBP",realm_id:"123",
  profit_received_at:"2026-10-19T10:00:00Z",receivables_received_at:"2026-10-19T10:01:00Z",
  profit_sha256:"a".repeat(64),receivables_sha256:"b".repeat(64)};
const candidateResponse={version:"quickbooks-report-pair-candidates/1",
  audience:"openfolk_operator_only",tenant_id:tenantId,actor_id:actorId,
  candidates:[candidate],audit_id:"00000000-0000-0000-0000-000000000004"};
const pair=readFounderAccountsPairs(candidateResponse,tenantId,actorId)[0];
const ready={operator:true,jobPreviewOpened:true,flagEnabled:true,pair,
  reason:"Review saved accounts",reviewed:true};
const response = { version:"quickbooks-report-summary-preview/1", audience:"openfolk_operator_only",
  tenant_id:tenantId, realm_id:"123", environment:"production",
  profit_request:profitRequest, receivables_request:receivablesRequest,
  profit_sha256:"a".repeat(64), receivables_sha256:"b".repeat(64),
  period_start:"2026-10-01", period_end:"2026-10-18", accounting_method:"Accrual",
  ar_as_of:"2026-10-18", aging_method:"Report_Date", source:"QuickBooks Online",
  scope:"company_accounts_report_not_job_costing",
  audit_id:"00000000-0000-0000-0000-000000000006",
  summary:{currency:"GBP", accounts_gross_profit:"12345678901234567890.01", net_profit:"-10.02",
    ar_current:"1.00",ar_1_30:"2.00",ar_31_60:"3.00",ar_61_90:"4.00",
    ar_91_plus:"5.00",ar_total:"15.00"} };

test("report pair choices contain only strict metadata for the exact operator and tenant",()=>{
  assert.equal(pair.periodEnd,"2026-10-18");
  assert.equal("summary" in pair,false);
  for(const change of [{actor_id:tenantId},{tenant_id:actorId},{audience:"client_owner"},
    {candidates:[{...candidate,period_end:"2026-10-19"}]},
    {candidates:[{...candidate,profit_sha256:"not-a-hash"}]},
    {candidates:[candidate,candidate]}])
    assert.throws(()=>readFounderAccountsPairs({...candidateResponse,...change},tenantId,actorId),/accounts_pairs_invalid/);
});

test("accounts read needs an explicitly selected, reviewed pair and operator preview",()=>{
  assert.equal(canReadFounderAccountsPreview(ready),true);
  for(const change of [{operator:false},{jobPreviewOpened:false},{flagEnabled:false},
    {pair:null},{reviewed:false},{reason:" "},{reason:"x".repeat(501)}])
    assert.equal(canReadFounderAccountsPreview({...ready,...change}),false);
});

test("current and historical source snapshots keep exact scope and decimal strings",()=>{
  const result=readFounderAccountsPreview(response,tenantId,pair,"2026-10-19");
  assert.equal(result.accountsGrossProfit,"12345678901234567890.01");
  assert.equal(result.netProfit,"-10.02");
  assert.equal("summary" in result,false);
  assert.match(accountsPeriodCoverage("2026-10-18","2026-10-19"),/later changes/);
  assert.match(accountsPeriodCoverage("2026-09-30","2026-10-19"),/Historical period/);
  for(const change of [{audience:"client_owner"},{tenant_id:actorId},
    {period_end:"2026-10-17"},{accounting_method:"Cash"},{environment:"sandbox"},
    {profit_sha256:"c".repeat(64)},{summary:{...response.summary,net_profit:10.02}}])
    assert.throws(()=>readFounderAccountsPreview({...response,...change},tenantId,pair,"2026-10-19"));
  assert.throws(()=>readFounderAccountsPreview(response,tenantId,pair,"2026-10-17"));
});
