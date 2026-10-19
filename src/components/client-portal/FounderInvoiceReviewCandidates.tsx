import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { canRequestInvoiceReview, readInvoiceReviewCandidates,
  type InvoiceReviewPage } from "@/lib/new-dawn-invoice-review-candidates";

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
  const [page,setPage]=useState<InvoiceReviewPage|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const generation=useRef(0);
  const working=useRef(false);
  useEffect(()=>{
    generation.current++;working.current=false;setPage(null);setBusy(false);setNotice("");
    return()=>{generation.current++;};
  },[tenant,user?.id,jobPreviewOpened,flag.data,reason]);
  if(!user || !canRequestInvoiceReview(operator,jobPreviewOpened,flag.data===true,reason)) return null;

  async function readSaved() {
    if(working.current || !user || !canRequestInvoiceReview(operator,jobPreviewOpened,flag.data===true,reason)) return;
    const ticket=generation.current;
    working.current=true;setBusy(true);setPage(null);setNotice("");
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
        {page.candidates.map(row=><article className="rounded-lg border p-3 text-sm" key={row.versionId}>
          <strong>QuickBooks invoice {row.documentNumber || row.invoiceId}</strong>
          <p>Saved balance {financeAmount(row.balance,row.currency)} · source due date {row.dueDate}</p>
          <p className="nd-money-scope">Source updated {row.sourceUpdatedAt.slice(0,16).replace("T"," ")} UTC · observed by OpenFolk {row.sourceObservedAt.slice(0,16).replace("T"," ")} UTC.</p>
          <details className="text-xs"><summary>Source version</summary><p className="break-all">Invoice ID {row.invoiceId}; version {row.versionId}; SHA-256 {row.sourceSha256}.</p></details>
        </article>)}
      </div>}
      <details className="text-xs"><summary>Read audit</summary><p>{page.auditId}</p></details>
      <button className="cp-secondary" onClick={()=>setPage(null)}>Close invoice review</button>
    </div>}
  </section>;
}
