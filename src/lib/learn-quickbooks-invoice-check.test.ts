import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readInvoiceCheckCandidates, readInvoiceCheckOutcome } from "./learn-quickbooks-invoice-check.ts";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const tenant=id(1), actor=id(2), connection=id(3), request=id(4), audit=id(5), version=id(6);
const candidates = { version:"quickbooks-invoice-candidates/1",tenant_id:tenant,actor_id:actor,connection_id:connection,
  environment:"production",realm_id:"123",audit_id:audit,checked_at:"2026-10-19T12:00:00Z",
  rows:[{version_id:version,invoice_id:"42",document_number:"INV-42",due_date:"2026-10-30",observed_at:"2026-10-18T12:00:00Z"}] };
test("candidate list is bound to the selected actor, tenant and company", () => {
  assert.equal(readInvoiceCheckCandidates(candidates,tenant,actor,connection).rows.length,1);
  for(const change of [{tenant_id:id(7)},{actor_id:id(7)},{connection_id:id(7)},{rows:[...candidates.rows,...candidates.rows]}])
    assert.throws(()=>readInvoiceCheckCandidates({...candidates,...change},tenant,actor,connection));
});
test("result exposes only checked states after exact scope validation", () => {
  const scope={tenant,realm:"123",environment:"production" as const,request,versions:[version]};
  const result={version:"quickbooks-invoice-check/1",tenant_id:tenant,realm_id:"123",environment:"production",
    request_id:request,audit_id:audit,compared_at:"2026-10-19T12:00:00Z",
    rows:[{version_id:version,balance_matches:true,due_date_matches:false,provider_balance:"100000000000.01"}]};
  assert.deepEqual(readInvoiceCheckOutcome(result,scope).rows,[{versionId:version,balanceMatches:true,dueDateMatches:false}]);
  assert.throws(()=>readInvoiceCheckOutcome({...result,realm_id:"456"},scope));
  assert.throws(()=>readInvoiceCheckOutcome({...result,rows:[{...result.rows[0],version_id:id(7)}]},scope));
});
test("deployed SQL completion event supplies the audit ID required by the operator result", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261106090000_new_dawn_invoice_comparison.sql", import.meta.url),"utf8");
  const finish = sql.split("create function public.learn_quickbooks_invoice_check_finish(")[1]?.split("create function public.learn_quickbooks_invoice_check_result(")[0];
  assert.ok(finish, "finish function is present");
  assert.match(finish, /'invoice\.provider_check_completed'[\s\S]*?returning id into audit;/i);
  assert.match(finish, /return jsonb_build_object\('version','quickbooks-invoice-check\/1'[\s\S]*?'audit_id',audit,'rows',result\)/i);
});
