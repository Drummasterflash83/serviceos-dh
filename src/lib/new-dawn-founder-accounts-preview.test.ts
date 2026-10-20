import assert from "node:assert/strict";
import test from "node:test";
import { accountsPeriodCoverage, canReadFounderAccountsPreview, canShowAgedReceivablesReview, canShowReceivablesAgeing,
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
  assert.deepEqual(result.receivables,{current:"1.00",days1To30:"2.00",
    days31To60:"3.00",days61To90:"4.00",days91Plus:"5.00",total:"15.00"});
  assert.equal(result.profitReceivedAt,candidate.profit_received_at);
  assert.equal(result.receivablesReceivedAt,candidate.receivables_received_at);
  assert.equal("summary" in result,false);
  assert.match(accountsPeriodCoverage("2026-10-18","2026-10-19"),/later changes/);
  assert.match(accountsPeriodCoverage("2026-09-30","2026-10-19"),/Historical period/);
  for(const change of [{audience:"client_owner"},{tenant_id:actorId},
    {period_end:"2026-10-17"},{accounting_method:"Cash"},{environment:"sandbox"},
    {profit_sha256:"c".repeat(64)},{summary:{...response.summary,net_profit:10.02}}])
    assert.throws(()=>readFounderAccountsPreview({...response,...change},tenantId,pair,"2026-10-19"));
  assert.throws(()=>readFounderAccountsPreview(response,tenantId,pair,"2026-10-17"));
});

test("receivables buckets must exactly reconcile before showing any saved money",()=>{
  const changed=(summary: typeof response.summary) =>
    readFounderAccountsPreview({...response,summary},tenantId,pair,"2026-10-19");
  assert.throws(()=>changed({...response.summary,ar_total:"15.01"}),/accounts_preview_scope_held/);
  assert.throws(()=>changed({...response.summary,ar_91_plus:"5.01"}),/accounts_preview_scope_held/);
  assert.deepEqual(changed({...response.summary,ar_current:"-1.50",ar_1_30:"2.25",
    ar_31_60:"3",ar_61_90:"4.0",ar_91_plus:"5.25",ar_total:"13.00"}).receivables,
    {current:"-1.50",days1To30:"2.25",days31To60:"3",days61To90:"4.0",
      days91Plus:"5.25",total:"13.00"});
  assert.throws(()=>changed({...response.summary,ar_total:"0.00"}),/accounts_preview_scope_held/);
});

test("aged receivables review is default-off, operator-only and only a positive exact report bucket",()=>{
  const saved=readFounderAccountsPreview(response,tenantId,pair,"2026-10-19");
  assert.equal(canShowReceivablesAgeing({operator:true,flagEnabled:true,saved}),true);
  assert.equal(canShowReceivablesAgeing({operator:true,flagEnabled:false,saved}),false);
  assert.equal(canShowReceivablesAgeing({operator:false,flagEnabled:true,saved}),false);
  assert.equal(canShowReceivablesAgeing({operator:true,flagEnabled:true,saved:null}),false);
  assert.equal(canShowAgedReceivablesReview({operator:true,flagEnabled:true,saved}),true);
  for(const changed of [
    {operator:false,flagEnabled:true,saved},
    {operator:true,flagEnabled:false,saved},
    {operator:true,flagEnabled:true,saved:null},
    {operator:true,flagEnabled:true,saved:{...saved,receivables:{...saved.receivables,days91Plus:"0.00"}}},
    {operator:true,flagEnabled:true,saved:{...saved,receivables:{...saved.receivables,days91Plus:"-5.00"}}},
  ]) assert.equal(canShowAgedReceivablesReview(changed),false);
  assert.equal(canShowAgedReceivablesReview({operator:true,flagEnabled:true,
    saved:{...saved,receivables:{...saved.receivables,days91Plus:"0.01"}}}),true);
});
