import assert from "node:assert/strict";
import test from "node:test";
import { canRequestInvoiceReview,readInvoiceReviewCandidates } from "./new-dawn-invoice-review-candidates.ts";

const tenant="00000000-0000-0000-0000-000000000001";
const actor="00000000-0000-0000-0000-000000000002";
const row={invoice_id:"123",source_version_id:"00000000-0000-0000-0000-000000000003",
  document_number:"TEST-001",balance:"12345678901234567890.01",currency:"GBP",
  due_date:"2026-10-10",source_updated_at:"2026-10-19T16:00:00Z",
  source_observed_at:"2026-10-19T22:00:00Z",source_sha256:"a".repeat(64)};
const response={version:"quickbooks-invoice-review-candidates/1",audience:"openfolk_operator_only",
  tenant_id:tenant,actor_id:actor,environment:"production",realm_id:"123",currency:"GBP",
  as_of:"2026-10-20",read_at:"2026-10-20T12:00:00Z",
  newest_observed_at:"2026-10-19T22:00:00Z",eligible_count:1,candidates:[row],
  audit_id:"00000000-0000-0000-0000-000000000004"};

test("operator review stays default-off until the explicit audited job preview",()=>{
  assert.equal(canRequestInvoiceReview(true,true,true,"Review saved invoices"),true);
  for(const [operator,opened,flag,reason] of [
    [false,true,true,"Review saved invoices"],[true,false,true,"Review saved invoices"],
    [true,true,false,"Review saved invoices"],[true,true,true," "]
  ] as const) assert.equal(canRequestInvoiceReview(operator,opened,flag,reason),false);
});

test("saved invoice review preserves exact decimal text and source times",()=>{
  const page=readInvoiceReviewCandidates(response,tenant,actor);
  assert.equal(page.candidates[0].balance,"12345678901234567890.01");
  assert.equal(page.candidates[0].sourceUpdatedAt,"2026-10-19T16:00:00Z");
  assert.equal(page.candidates[0].sourceObservedAt,"2026-10-19T22:00:00Z");
  assert.equal("customer" in page.candidates[0],false);
  assert.equal("job" in page.candidates[0],false);
});

test("cross-tenant, client audience, wrong currency and conflicted/malformed source cannot pass",()=>{
  for(const changed of [{tenant_id:actor},{actor_id:tenant},{audience:"client_owner"},
    {environment:"sandbox"},{currency:"USD"},{candidates:[{...row,currency:"USD"}]},
    {candidates:[{...row,source_sha256:"invalid"}]},
    {candidates:[row,row],eligible_count:2}])
    assert.throws(()=>readInvoiceReviewCandidates({...response,...changed},tenant,actor));
});

test("zero or negative balance, missing or stale due date, stale observation and source update are held",()=>{
  for(const changed of [
    {balance:"0.00"},{balance:"-1.00"},{balance:1.2},{due_date:null},
    {due_date:"2026-09-01"},{due_date:"2026-10-20"},
    {source_observed_at:"2026-10-12T22:00:00Z"},
    {source_updated_at:"2026-09-10T16:00:00Z"},
  ]) assert.throws(()=>readInvoiceReviewCandidates({...response,candidates:[{...row,...changed}]},tenant,actor));
});
