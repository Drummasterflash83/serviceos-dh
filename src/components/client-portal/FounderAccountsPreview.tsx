import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { readAccountsMarginPreview, type AccountsMarginPreview } from "@/lib/new-dawn-accounts-margin";
import { accountsPeriodCoverage, canReadFounderAccountsPreview, canShowAgedReceivablesReview, canShowReceivablesAgeing, readFounderAccountsPairs,
  readFounderAccountsPreview, type AccountsPair } from "@/lib/new-dawn-founder-accounts-preview";

type SavedAccounts = ReturnType<typeof readFounderAccountsPreview>;
const receivedUtc = (value: string) => `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`;

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
        .eq("tenant_id",tenant).in("flag",["new_dawn.job_home_accounts_preview","new_dawn.report_summary_preview","new_dawn.aged_debt_exception_preview","new_dawn.report_margin_preview"]);
      if (error) throw Error("Accounts preview flag unavailable");
      const enabled=(name:string)=>data?.some(row=>row.flag===name && row.value===true)===true;
      return {accounts:enabled("new_dawn.job_home_accounts_preview") && enabled("new_dawn.report_summary_preview"),
        agedReceivables:enabled("new_dawn.aged_debt_exception_preview"),
        margin:enabled("new_dawn.report_margin_preview")};
    },staleTime:30_000,
  });
  const [pairs,setPairs]=useState<AccountsPair[]|null>(null);
  const [selectedId,setSelectedId]=useState("");
  const [reviewed,setReviewed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [saved,setSaved]=useState<SavedAccounts|null>(null);
  const [margin,setMargin]=useState<AccountsMarginPreview|null>(null);
  const generation=useRef(0);
  const working=useRef(false);
  useEffect(()=>{
    generation.current++;working.current=false;
    setPairs(null);setSelectedId("");setReviewed(false);
    setBusy(false);setNotice("");setSaved(null);setMargin(null);
    return ()=>{generation.current++;};
  },[tenant,user?.id,jobPreviewOpened,flag.data?.accounts,flag.data?.margin,reason]);
  if (!operator || !jobPreviewOpened || flag.data?.accounts!==true || !user) return null;
  const pair=pairs?.find((item)=>item.profitRequest===selectedId) ?? null;
  const ready=canReadFounderAccountsPreview({operator,jobPreviewOpened,flagEnabled:flag.data.accounts,
    pair,reason,reviewed});
  const showAgedReceivables=canShowAgedReceivablesReview({operator,
    flagEnabled:flag.data.agedReceivables,saved});
  const showAgeing=canShowReceivablesAgeing({operator,
    flagEnabled:flag.data.agedReceivables,saved});

  async function findPairs() {
    if (working.current || reason.trim().length<3 || reason.trim().length>500 || !user) return;
    const ticket=generation.current;
    working.current=true;setBusy(true);setNotice("");setPairs(null);setSelectedId("");setReviewed(false);setSaved(null);setMargin(null);
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
    working.current=true;setBusy(true);setNotice("");setSaved(null);setMargin(null);
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
  async function readMargin() {
    if (!saved || !pair || !user || !flag.data?.margin || working.current) return;
    const ticket=generation.current;
    working.current=true;setBusy(true);setNotice("");setMargin(null);
    try {
      const {data,error}=await getSupabaseClient().rpc("learn_quickbooks_accounts_margin_preview",{
        p_tenant:tenant,p_profit_request:pair.profitRequest,
        p_receivables_request:pair.receivablesRequest,p_reason:reason.trim(),
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Saved accounts margin unavailable");
      const checked=readAccountsMarginPreview(data,{tenant,actor:user.id,pair,saved});
      if (ticket===generation.current) setMargin(checked);
    } catch {
      if (ticket===generation.current) setNotice("Accounts margin could not be verified from this saved report. The percentage remains withheld.");
    } finally {
      if (ticket===generation.current) {working.current=false;setBusy(false);}
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
      {flag.data.margin && <section className="space-y-2" aria-label="Accounts gross margin evidence">
        <button className="cp-secondary" disabled={busy} onClick={()=>void readMargin()}>
          {busy?"Checking accounts margin…":"Read accounts gross margin"}
        </button>
        {margin && <div className="space-y-1">
          <p><strong>Accounts gross margin: {margin.accountsGrossMarginPct}%</strong> · P&amp;L {saved.periodStart} to {saved.periodEnd} · {saved.accountingMethod} basis.</p>
          <p className="nd-money-scope">QuickBooks Gross Profit ÷ Total Income ({financeAmount(margin.totalIncome,saved.currency)}), rounded to two decimals. This is company accounts margin, not Commusoft field or job margin. No target comparison: the accounts-versus-field basis of the proposed GP floor is unconfirmed.</p>
          <details className="text-xs"><summary>Margin read audit</summary><p>{margin.auditId} · source report read {margin.reportSummaryAuditId}</p></details>
        </div>}
      </section>}
      <section className="space-y-2" aria-label="Saved QuickBooks receivables ageing">
        <h3 className="font-semibold">Receivables report · as of {saved.arAsOf}</h3>
        <p className="nd-money-scope">Company-level net report balances. Credits may affect buckets; these are not today's collectable debt or a customer, invoice or job list.</p>
        <dl className="nd-money-values">
          <div><dt>Report total</dt><dd><strong>{financeAmount(saved.receivables.total,saved.currency)}</strong></dd></div>
        </dl>
        {showAgeing && <dl className="nd-money-values" aria-label="Receivables ageing bands">
          <div><dt>Current</dt><dd>{financeAmount(saved.receivables.current,saved.currency)}</dd></div>
          <div><dt>1–30 days</dt><dd>{financeAmount(saved.receivables.days1To30,saved.currency)}</dd></div>
          <div><dt>31–60 days</dt><dd>{financeAmount(saved.receivables.days31To60,saved.currency)}</dd></div>
          <div><dt>61–90 days</dt><dd>{financeAmount(saved.receivables.days61To90,saved.currency)}</dd></div>
          <div><dt>91 days and over</dt><dd>{financeAmount(saved.receivables.days91Plus,saved.currency)}</dd></div>
        </dl>}
      </section>
      {showAgedReceivables && <aside className="rounded-lg border border-amber-200 bg-amber-50/50 p-4" aria-label="OpenFolk aged receivables review">
        <p className="font-semibold">Review aged receivables</p>
        <p className="mt-1 text-sm">QuickBooks Aged Receivables · 91 and over · as of {saved.arAsOf}: <strong>{financeAmount(saved.receivables.days91Plus,saved.currency)}</strong></p>
        <p className="nd-money-scope">Positive company-level report bucket in this saved snapshot. It is not linked to a particular customer, invoice or job, and does not authorise a payment chase.</p>
      </aside>}
      <p className="nd-money-scope">Field gross profit: awaiting verified job costs and job links. ARR: awaiting verified recurring contracts and periods.</p>
      <details className="text-xs"><summary>Saved source and audit</summary>
        <p>P&amp;L received {receivedUtc(saved.profitReceivedAt)}; A/R received {receivedUtc(saved.receivablesReceivedAt)}.</p>
        <p className="break-all">P&amp;L SHA-256 {saved.profitSha256}; A/R SHA-256 {saved.receivablesSha256}. Read audit {saved.auditId}.</p>
      </details>
      <button className="cp-secondary" onClick={()=>{setSaved(null);setMargin(null);setReviewed(false);}}>Close accounts snapshot</button>
    </div>}
  </section>;
}
