import assert from "node:assert/strict";
import test from "node:test";
import {readMoneySourceReadiness} from "./learn-quickbooks-money-readiness.ts";

const scope={tenantId:"00000000-0000-0000-0000-000000000001",
  connectionId:"00000000-0000-0000-0000-000000000002",environment:"production" as const,realmId:"123"};
const retained={invoice_latest:10,bill_latest:3,purchase_latest:2,qbo_job_customers:4,
  bill_customer_line_refs:1,purchase_customer_line_refs:1,invoice_item_refs:8,
  items_with_purchase_cost_field:2,invoices_with_checked_recurring_markers:0,
  commusoft_job_versions:9,commusoft_jobs_with_checked_direct_cost_fields:0};
const receipt={version:"quickbooks-money-source-readiness/1",audience:"openfolk_operator_only",
  tenant_id:scope.tenantId,connection_id:scope.connectionId,environment:scope.environment,
  realm_id:scope.realmId,commusoft_scope:"all_retained_tenant_connections",
  read_at:"2026-10-19T10:00:00Z",latest_qbo_observed_at:null,
  audit_id:"00000000-0000-0000-0000-000000000003",retained,
  field_gp:{status:"held",reason:"cross_provider_job_mapping_and_actual_cost_not_verified"},
  arr:{status:"held",reason:"recurring_contract_and_period_not_verified"},
  limits:["field_presence_is_not_financial_value","customer_ref_is_not_commusoft_job_link",
    "item_purchase_cost_is_not_actual_job_cost","no_recurring_transaction_entity_in_current_import_adapter"]};
test("operator readiness accepts only held, count-only tenant-bound evidence",()=>{
  const read=readMoneySourceReadiness(receipt,scope);
  assert.equal(read.retained.qbo_job_customers,4);
  assert.equal("balance" in read.retained,false);
  for(const change of [{tenant_id:scope.connectionId},{realm_id:"999"},
    {net_profit:"100.00"},
    {field_gp:{status:"ready",reason:"cross_provider_job_mapping_and_actual_cost_not_verified"}},
    {arr:{...receipt.arr,amount:"100.00"}},
    {retained:{...retained,invoice_latest:1.5}},
    {retained:{...retained,net_profit:"100.00"}},
    {limits:[...receipt.limits.slice(1)]}])
    assert.throws(()=>readMoneySourceReadiness({...receipt,...change},scope));
});
