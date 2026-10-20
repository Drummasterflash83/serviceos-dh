import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { canRequestInvoiceReview, readInvoiceReviewCandidates,
  type InvoiceReviewPage } from "@/lib/new-dawn-invoice-review-candidates";
import { canInspectInvoiceJobPair, readInvoiceJobPairSource,
  type InvoiceJobPairSource } from "@/lib/new-dawn-invoice-job-pair-source";

/** Internal saved-source review. Never mounted for clients or owners. */
export function FounderInvoiceReviewCandidates({tenant,operator,jobPreviewOpened,reason}:{
  tenant:string;operator:boolean;jobPreviewOpened:boolean;reason:string;
}) {
  const {user}=useAuth();
  const flag=useQuery({
    queryKey:["new-dawn-invoice-review-flag",user?.id,tenant],
    enabled:operator && !!user,
    queryFn:async()=>{
      const {data,error}=await getSupabaseClient().from("feature_flags").select("value")
        .eq("tenant_id",tenant).eq("flag","new_dawn.invoice_review_candidates_preview").maybeSingle();
      if(error) throw Error("Invoice review flag unavailable");
      return data?.value===true;
    },staleTime:30_000,
  });
  const pairFlag=useQuery({
    queryKey:["new-dawn-invoice-job-pair-flag",user?.id,tenant],
    enabled:operator && !!user && flag.data===true,
    queryFn:async()=>{
      const {data,error}=await getSupabaseClient().from("feature_flags").select("value")
        .eq("tenant_id",tenant).eq("flag","new_dawn.invoice_job_pair_source_preview").maybeSingle();
      if(error) throw Error("Invoice/job comparison flag unavailable");
      return data?.value===true;
    },staleTime:30_000,
  });
  const [page,setPage]=useState<InvoiceReviewPage|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [jobId,setJobId]=useState("");
  const [pair,setPair]=useState<InvoiceJobPairSource|null>(null);
  const [pairBusy,setPairBusy]=useState(false);
  const [pairNotice,setPairNotice]=useState("");
  const generation=useRef(0);
  const working=useRef(false);
  useEffect(()=>{
    generation.current++;working.current=false;setPage(null);setBusy(false);setNotice("");
    setJobId("");setPair(null);setPairBusy(false);setPairNotice("");
    return()=>{generation.current++;};
  },[tenant,user?.id,jobPreviewOpened,flag.data,pairFlag.data,reason]);
  if(!user || !canRequestInvoiceReview(operator,jobPreviewOpened,flag.data===true,reason)) return null;

  async function readSaved() {
    if(working.current || !user || !canRequestInvoiceReview(operator,jobPreviewOpened,flag.data===true,reason)) return;
    const ticket=generation.current;
    working.current=true;setBusy(true);setPage(null);setPair(null);setPairNotice("");setNotice("");
    try {
      const {data,error}=await getSupabaseClient().rpc("new_dawn_invoice_review_candidates",{
        p_tenant:tenant,p_reason:reason.trim(),
      }).abortSignal(AbortSignal.timeout(20_000));
      if(error) throw Error("Saved invoice read unavailable");
      const checked=readInvoiceReviewCandidates(data,tenant,user.id);
      if(ticket===generation.current) setPage(checked);
    } catch {
      if(ticket===generation.current) setNotice("Saved invoice evidence could not be confirmed. No review candidates are shown.");
    } finally {
      if(ticket===generation.current){working.current=false;setBusy(false);}
    }
  }
  async function inspectPair(versionId:string) {
    if (pairBusy || !user || !canInspectInvoiceJobPair(operator,jobPreviewOpened,
      pairFlag.data===true,reason,jobId)) return;
    const ticket=generation.current;
    const exactJobId=jobId.trim().toLowerCase();
    setPairBusy(true);setPair(null);setPairNotice("");
    try {
      const {data,error}=await getSupabaseClient().rpc("new_dawn_invoice_job_pair_source",{
        p_tenant:tenant,p_invoice_version:versionId,p_job:exactJobId,p_reason:reason.trim(),
      }).abortSignal(AbortSignal.timeout(20_000));
      if(error) throw Error("Exact pair source unavailable");
      const checked=readInvoiceJobPairSource(data,tenant,user.id,versionId,exactJobId);
      if(ticket===generation.current) setPair(checked);
    } catch {
      if(ticket===generation.current) setPairNotice("The exact source pair could not be verified. No relationship was recorded.");
    } finally {
      if(ticket===generation.current) setPairBusy(false);
    }
  }
  return <section className="nd-money-panel" aria-label="OpenFolk saved invoice review">
    <p className="of-eyebrow">OPENFOLK · PRIVATE SOURCE REVIEW</p>
    <h2 className="text-xl font-semibold">Saved invoice review</h2>
    <p className="nd-money-scope">An internal check of recently observed QuickBooks invoice records. These are saved source balances, not a live debt position, a customer chase or a link to a Commusoft job. Client money remains withheld.</p>
    <button className="cp-secondary" disabled={busy} onClick={()=>void readSaved()}>
      {busy?"Checking saved invoices…":"Review saved invoice candidates"}
    </button>
    {notice && <p role="alert">{notice}</p>}
    {page && <div className="space-y-3" role="status">
      <p className="nd-money-scope">QuickBooks production company {page.realmId} · source review as of {page.asOf} · last invoice observation {page.newestObservedAt?.slice(0,16).replace("T"," ") ?? "not confirmed"} UTC. {page.eligibleCount} records meet the bounded source checks; showing up to 20.</p>
      {page.candidates.length===0 && <p>No recently observed, source-updated invoice candidates meet the review checks. This does not establish that the company has no unpaid invoices.</p>}
      {page.candidates.length>0 && <div className="space-y-2">
        {pairFlag.data===true && <><label className="block text-sm">Exact OpenFolk job ID for source comparison
          <input className="mt-1 w-full rounded-md border p-2 font-mono text-xs" value={jobId}
            onChange={event=>{setJobId(event.target.value);setPair(null);setPairNotice("");}}
            placeholder="Paste the reviewed job UUID" maxLength={36} autoComplete="off" />
        </label>
        <p className="nd-money-scope">Choose one invoice below to compare literal saved references with this exact reviewed job. Similar numbers or customer details do not establish a link.</p></>}
        {page.candidates.map(row=><article className="rounded-lg border p-3 text-sm" key={row.versionId}>
          <strong>QuickBooks invoice {row.documentNumber || row.invoiceId}</strong>
          <p>Saved balance {financeAmount(row.balance,row.currency)} · source due date {row.dueDate}</p>
          <p className="nd-money-scope">Source updated {row.sourceUpdatedAt.slice(0,16).replace("T"," ")} UTC · observed by OpenFolk {row.sourceObservedAt.slice(0,16).replace("T"," ")} UTC.</p>
          <details className="text-xs"><summary>Source version</summary><p className="break-all">Invoice ID {row.invoiceId}; version {row.versionId}; SHA-256 {row.sourceSha256}.</p></details>
          {pairFlag.data===true && <button className="cp-secondary" disabled={pairBusy || !canInspectInvoiceJobPair(operator,jobPreviewOpened,pairFlag.data===true,reason,jobId)}
            onClick={()=>void inspectPair(row.versionId)}>{pairBusy?"Checking exact pair…":"Compare with exact job source"}</button>}
        </article>)}
      </div>}
      {pairNotice && <p role="alert">{pairNotice}</p>}
      {pair && <section className="rounded-lg border p-3 text-sm" aria-label="Exact invoice and job source comparison">
        <strong>Invoice ↔ job relationship: unverified</strong>
        <p>QuickBooks invoice {pair.invoice.documentNumber || pair.invoice.invoiceId} in production company {pair.invoice.realmId}; saved {pair.invoice.observedAt.slice(0,16).replace("T"," ")} UTC.</p>
        <p>Reviewed Commusoft job {pair.job.jobNumber || pair.job.externalId}; saved {pair.job.observedAt.slice(0,16).replace("T"," ")} UTC.</p>
        <p>Invoice customer reference: {pair.invoice.customerReference || "not supplied"}. Job customer reference: {pair.job.customerReference || "not supplied"}.</p>
        <p>Invoice custom fields: {pair.invoice.customFields.length ? pair.invoice.customFields.map(field=>`${field.name}: ${field.value}`).join(" · ") : "none with a saved string value"}.</p>
        <p className="nd-money-scope">These are original source fields for a human document check. A shared-looking value is not an approved relationship; no job amount, payment or margin is shown.</p>
        <details className="text-xs"><summary>Exact source and audit IDs</summary>
          <p className="break-all">Invoice {pair.invoice.invoiceId}, version {pair.invoice.versionId}, SHA-256 {pair.invoice.sourceSha256}.</p>
          <p className="break-all">Job {pair.job.jobId}, connection {pair.job.connectionId}, source version {pair.job.versionId}, SHA-256 {pair.job.sourceSha256}.</p>
          <p className="break-all">Audit {pair.auditId}.</p>
        </details>
      </section>}
      <details className="text-xs"><summary>Read audit</summary><p>{page.auditId}</p></details>
      <button className="cp-secondary" onClick={()=>setPage(null)}>Close invoice review</button>
    </div>}
  </section>;
}
