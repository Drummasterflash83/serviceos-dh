import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { canReadFounderAccountsPreview, readSeptemberFounderAccountsPreview } from "@/lib/new-dawn-founder-accounts-preview";

type SavedAccounts = ReturnType<typeof readSeptemberFounderAccountsPreview>;

/** OpenFolk founder/operator preview; never mounted on the ordinary client home. */
export function FounderAccountsPreview({ tenant, operator, jobPreviewOpened, reason }: {
  tenant: string; operator: boolean; jobPreviewOpened: boolean; reason: string;
}) {
  const { user } = useAuth();
  const flag = useQuery({
    queryKey:["new-dawn-job-home-accounts-flag",user?.id,tenant],
    enabled:operator && !!user,
    queryFn:async () => {
      const {data,error}=await getSupabaseClient().from("feature_flags").select("flag,value")
        .eq("tenant_id",tenant).in("flag",["new_dawn.job_home_accounts_preview","new_dawn.report_summary_preview"]);
      if (error) throw Error("Accounts preview flag unavailable");
      return ["new_dawn.job_home_accounts_preview","new_dawn.report_summary_preview"]
        .every(name=>data?.some(row=>row.flag===name && row.value===true));
    },staleTime:30_000,
  });
  const [profitRequest,setProfitRequest]=useState("");
  const [receivablesRequest,setReceivablesRequest]=useState("");
  const [reviewed,setReviewed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [saved,setSaved]=useState<SavedAccounts|null>(null);
  const generation=useRef(0);
  useEffect(()=>{
    generation.current++;
    setProfitRequest("");setReceivablesRequest("");setReviewed(false);
    setBusy(false);setNotice("");setSaved(null);
  },[tenant,user?.id,jobPreviewOpened,flag.data,reason]);
  if (!operator || !jobPreviewOpened || flag.data!==true) return null;
  const ready=canReadFounderAccountsPreview({operator,jobPreviewOpened,flagEnabled:flag.data===true,
    profitRequest:profitRequest.trim(),receivablesRequest:receivablesRequest.trim(),reason,reviewed});
  const clear=()=>{generation.current++;setSaved(null);setNotice("");setReviewed(false);};
  async function readSaved() {
    if (!ready || busy) return;
    const ticket=generation.current;
    setBusy(true);setNotice("");setSaved(null);
    try {
      const {data,error}=await getSupabaseClient().rpc("learn_quickbooks_report_summary_preview",{
        p_tenant:tenant,p_profit_request:profitRequest.trim(),
        p_receivables_request:receivablesRequest.trim(),p_reason:reason.trim(),
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Saved accounts read unavailable");
      const checked=readSeptemberFounderAccountsPreview(data,{tenantId:tenant,
        profitRequest:profitRequest.trim(),receivablesRequest:receivablesRequest.trim()});
      if (ticket===generation.current) setSaved(checked);
    } catch {
      if (ticket===generation.current) setNotice("The saved accounts evidence could not be confirmed. Check the reviewed receipt pair and access.");
    } finally {
      if (ticket===generation.current) {setBusy(false);setReviewed(false);}
    }
  }
  return <section className="nd-money-panel" aria-label="OpenFolk saved accounts preview">
    <p className="of-eyebrow">OPENFOLK · PRIVATE ACCOUNTS PREVIEW</p>
    <h2 className="text-xl font-semibold">September accounts snapshot</h2>
    <p className="nd-money-scope">A reviewed QuickBooks company report, read only when you ask. This is September 2026 evidence, not today’s result or job profit.</p>
    {!saved && <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Verified P&amp;L receipt ID<input className="rounded-lg border bg-background p-2" value={profitRequest} disabled={busy} onChange={e=>{clear();setProfitRequest(e.target.value);}} /></label>
      <label className="grid gap-1 text-sm">Matching A/R receipt ID<input className="rounded-lg border bg-background p-2" value={receivablesRequest} disabled={busy} onChange={e=>{clear();setReceivablesRequest(e.target.value);}} /></label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>I reviewed this company, both exact saved receipts and the access reason above.</label>
      <button className="cp-secondary sm:col-span-2" disabled={!ready || busy} onClick={()=>void readSaved()}>{busy?"Checking saved reports…":"Read September accounts"}</button>
    </div>}
    {notice && <p role="status">{notice}</p>}
    {saved && <div role="status" className="space-y-3">
      <p className="nd-money-scope">QuickBooks Online · production company {saved.realmId} · P&amp;L {saved.periodStart} to {saved.periodEnd} · {saved.accountingMethod} basis · A/R as of {saved.arAsOf}. This is a saved report snapshot.</p>
      <dl className="nd-money-values">
        <div><dt>Accounts gross profit</dt><dd><strong>{financeAmount(saved.accountsGrossProfit,saved.currency)}</strong></dd></div>
        <div><dt>Net profit · OpenFolk authorised view</dt><dd><strong>{financeAmount(saved.netProfit,saved.currency)}</strong></dd></div>
      </dl>
      <p className="nd-money-scope">Field gross profit: awaiting verified job costs and job links. ARR: awaiting verified recurring contracts and periods.</p>
      <details className="text-xs"><summary>Saved source and audit</summary><p className="break-all">P&amp;L SHA-256 {saved.profitSha256}; A/R SHA-256 {saved.receivablesSha256}. Read audit {saved.auditId}.</p></details>
      <button className="cp-secondary" onClick={()=>{clear();setProfitRequest("");setReceivablesRequest("");}}>Close accounts snapshot</button>
    </div>}
  </section>;
}
