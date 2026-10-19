import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { accountsPeriodCoverage, canReadFounderAccountsPreview, readFounderAccountsPairs,
  readFounderAccountsPreview, type AccountsPair } from "@/lib/new-dawn-founder-accounts-preview";

type SavedAccounts = ReturnType<typeof readFounderAccountsPreview>;

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
  const [pairs,setPairs]=useState<AccountsPair[]|null>(null);
  const [selectedId,setSelectedId]=useState("");
  const [reviewed,setReviewed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [saved,setSaved]=useState<SavedAccounts|null>(null);
  const generation=useRef(0);
  const working=useRef(false);
  useEffect(()=>{
    generation.current++;working.current=false;
    setPairs(null);setSelectedId("");setReviewed(false);
    setBusy(false);setNotice("");setSaved(null);
    return ()=>{generation.current++;};
  },[tenant,user?.id,jobPreviewOpened,flag.data,reason]);
  if (!operator || !jobPreviewOpened || flag.data!==true || !user) return null;
  const pair=pairs?.find((item)=>item.profitRequest===selectedId) ?? null;
  const ready=canReadFounderAccountsPreview({operator,jobPreviewOpened,flagEnabled:flag.data===true,
    pair,reason,reviewed});

  async function findPairs() {
    if (working.current || reason.trim().length<3 || reason.trim().length>500 || !user) return;
    const ticket=generation.current;
    working.current=true;setBusy(true);setNotice("");setPairs(null);setSelectedId("");setReviewed(false);setSaved(null);
    try {
      const {data,error}=await getSupabaseClient().rpc("learn_quickbooks_report_pair_candidates",{
        p_tenant:tenant,p_reason:reason.trim(),
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Saved report choices unavailable");
      const found=readFounderAccountsPairs(data,tenant,user.id);
      if (ticket===generation.current) setPairs(found);
    } catch {
      if (ticket===generation.current) setNotice("Saved report choices could not be confirmed. Ask OpenFolk to check the connection and your access.");
    } finally {
      if (ticket===generation.current) {working.current=false;setBusy(false);}
    }
  }

  async function readSaved() {
    if (!ready || working.current || !pair) return;
    const ticket=generation.current;
    working.current=true;setBusy(true);setNotice("");setSaved(null);
    try {
      const {data,error}=await getSupabaseClient().rpc("learn_quickbooks_report_summary_preview",{
        p_tenant:tenant,p_profit_request:pair.profitRequest,
        p_receivables_request:pair.receivablesRequest,p_reason:reason.trim(),
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Saved accounts read unavailable");
      const checked=readFounderAccountsPreview(data,tenant,pair);
      if (ticket===generation.current) setSaved(checked);
    } catch {
      if (ticket===generation.current) setNotice("The selected reports could not be confirmed together. Their figures remain withheld.");
    } finally {
      if (ticket===generation.current) {working.current=false;setBusy(false);setReviewed(false);}
    }
  }
  return <section className="nd-money-panel" aria-label="OpenFolk saved accounts preview">
    <p className="of-eyebrow">OPENFOLK · PRIVATE ACCOUNTS PREVIEW</p>
    <h2 className="text-xl font-semibold">Saved company accounts</h2>
    <p className="nd-money-scope">Choose a dated QuickBooks report snapshot. This is company evidence, not today’s result or job profit. Client money remains withheld.</p>
    {!saved && <div className="space-y-3">
      <button className="cp-secondary" disabled={busy} onClick={()=>void findPairs()}>
        {busy && !pairs?"Finding saved reports…":"Find saved report periods"}
      </button>
      {pairs?.length===0 && <p role="status">No matching, verified P&amp;L and receivables reports are available for this operator and company.</p>}
      {!!pairs?.length && <>
        <label className="grid gap-1 text-sm">Saved report period
          <select className="rounded-lg border bg-background p-2" value={selectedId} disabled={busy}
            onChange={e=>{setSelectedId(e.target.value);setReviewed(false);setSaved(null);setNotice("");}}>
            <option value="">Choose a report period</option>
            {pairs.map(item=><option key={item.profitRequest} value={item.profitRequest}>
              {item.periodStart} to {item.periodEnd} · {item.accountingMethod} · {item.currency} · saved {item.profitReceivedAt.slice(0,10)}
            </option>)}
          </select>
        </label>
        {pair && <p className="nd-money-scope">QuickBooks company {pair.realmId} · P&amp;L {pair.periodStart} to {pair.periodEnd} · receivables as of {pair.arAsOf}. {accountsPeriodCoverage(pair.periodEnd)}</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || !pair} onChange={e=>setReviewed(e.target.checked)}/>
          I reviewed this company, report period, source and access reason.</label>
        <button className="cp-secondary" disabled={!ready || busy} onClick={()=>void readSaved()}>
          {busy?"Checking saved reports…":"Read selected accounts snapshot"}
        </button>
      </>}
    </div>}
    {notice && <p role="status">{notice}</p>}
    {saved && <div role="status" className="space-y-3">
      <p className="nd-money-scope">QuickBooks Online · production company {saved.realmId} · P&amp;L {saved.periodStart} to {saved.periodEnd} · {saved.accountingMethod} basis · A/R as of {saved.arAsOf}. {accountsPeriodCoverage(saved.periodEnd)}</p>
      <dl className="nd-money-values">
        <div><dt>Accounts gross profit</dt><dd><strong>{financeAmount(saved.accountsGrossProfit,saved.currency)}</strong></dd></div>
        <div><dt>Net profit · OpenFolk authorised view</dt><dd><strong>{financeAmount(saved.netProfit,saved.currency)}</strong></dd></div>
      </dl>
      <p className="nd-money-scope">Field gross profit: awaiting verified job costs and job links. ARR: awaiting verified recurring contracts and periods.</p>
      <details className="text-xs"><summary>Saved source and audit</summary><p className="break-all">P&amp;L SHA-256 {saved.profitSha256}; A/R SHA-256 {saved.receivablesSha256}. Read audit {saved.auditId}.</p></details>
      <button className="cp-secondary" onClick={()=>{setSaved(null);setReviewed(false);}}>Close accounts snapshot</button>
    </div>}
  </section>;
}
