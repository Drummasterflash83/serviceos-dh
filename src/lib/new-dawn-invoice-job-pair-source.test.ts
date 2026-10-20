import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canInspectInvoiceJobPair, readInvoiceJobPairSource } from "./new-dawn-invoice-job-pair-source.ts";

const tenant="00000000-0000-0000-0000-000000000001";
const actor="00000000-0000-0000-0000-000000000002";
const invoiceVersion="00000000-0000-0000-0000-000000000003";
const job="00000000-0000-0000-0000-000000000004";
const response={version:"new-dawn-invoice-job-pair-source/1",audience:"openfolk_operator_only",
  tenant_id:tenant,actor_id:actor,read_at:"2026-10-20T12:00:00Z",
  audit_id:"00000000-0000-0000-0000-000000000005",relationship:"unverified",
  invoice:{realm_id:"123",invoice_id:"456",version_id:invoiceVersion,
    source_sha256:"a".repeat(64),observed_at:"2026-10-20T11:00:00Z",
    document_number:"INV-456",customer_reference:"789",
    custom_fields:[{name:"P.O No.",value:"PO-12"}]},
  job:{job_id:job,connection_id:"00000000-0000-0000-0000-000000000006",
    external_id:"345",job_number:"001",version_id:"00000000-0000-0000-0000-000000000007",
    source_sha256:"b".repeat(64),observed_at:"2026-10-20T10:00:00Z",
    customer_reference:"PO-12"}};

test("comparison requires an operator, opened review, enabled flag, reason and exact UUID",()=>{
  assert.equal(canInspectInvoiceJobPair(true,true,true,"Source review",job),true);
  for(const args of [[false,true,true,"Source review",job],
    [true,false,true,"Source review",job],[true,true,false,"Source review",job],
    [true,true,true," ",job],[true,true,true,"Source review","001"]] as [boolean,boolean,boolean,string,string][])
    assert.equal(canInspectInvoiceJobPair(...args),false);
});

test("literal source references remain unverified even when values look alike",()=>{
  const pair=readInvoiceJobPairSource(response,tenant,actor,invoiceVersion,job);
  assert.equal(pair.job.jobNumber,"001");
  assert.equal(pair.invoice.customFields[0].value,pair.job.customerReference);
  assert.equal("linked" in pair,false);
  assert.equal("amount" in pair.invoice,false);
});

test("other tenant, actor, versions, job, audience or asserted relationship fail closed",()=>{
  for(const changed of [{tenant_id:actor},{actor_id:tenant},{audience:"client"},
    {relationship:"reviewed"},{invoice:{...response.invoice,version_id:job}},
    {job:{...response.job,job_id:invoiceVersion}},
    {invoice:{...response.invoice,observed_at:"2026-10-21T11:00:00Z"}},
    {invoice:{...response.invoice,custom_fields:[{name:"x",value:"x".repeat(201)}]}}])
    assert.throws(()=>readInvoiceJobPairSource({...response,...changed},tenant,actor,invoiceVersion,job));
});

test("database contract stays operator-only, exact-version and auditable",()=>{
  const sql=readFileSync(new URL("../../supabase/migrations/20261108130000_new_dawn_invoice_job_pair_source.sql",import.meta.url),"utf8");
  assert.match(sql,/perform public\.learn_operator_input_access\(p_tenant,actor,true\)/);
  assert.match(sql,/perform public\.learn_quickbooks_actor_access\(p_tenant,actor\)/);
  assert.match(sql,/l\.version_id is distinct from invoice\.id/);
  assert.match(sql,/job_link_count<>1/);
  assert.match(sql,/j\.metadata#>>'\{learn_business_input,source_version_id\}' is distinct from job_source\.id::text/);
  assert.match(sql,/relationship','unverified'/);
  assert.match(sql,/invoice\.job_pair_source_read/);
  assert.match(sql,/grant execute on function public\.new_dawn_invoice_job_pair_source\(uuid,uuid,uuid,text\)\s+to authenticated/);
  assert.doesNotMatch(sql,/grant execute[\s\S]*to anon|insert into public\.learn_business_input_links/i);
});
