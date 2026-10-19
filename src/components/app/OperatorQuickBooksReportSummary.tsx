import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { readReportSummaryPreview, type ReportSummaryPreview } from "@/lib/learn-quickbooks-report-summary";

const uuid = (value: string) => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.trim());

/** OpenFolk-only preview from two exact saved receipts; no QuickBooks request. */
export function OperatorQuickBooksReportSummary({ tenantId, actorId, canWrite }: {
  tenantId: string; actorId: string; canWrite: boolean;
}) {
  const flag = useQuery({
    queryKey:["quickbooks-report-summary-preview-flag",tenantId,actorId],enabled:canWrite,
    queryFn:async () => {
      const {data,error} = await getSupabaseClient().from("feature_flags").select("value")
        .eq("tenant_id",tenantId).eq("flag","new_dawn.report_summary_preview").maybeSingle();
      if (error) throw Error("Report preview flag unavailable");
      return data?.value === true;
    },staleTime:30_000,
  });
  const [profitRequest,setProfitRequest] = useState(""), [receivablesRequest,setReceivablesRequest] = useState("");
  const [reason,setReason] = useState(""), [reviewed,setReviewed] = useState(false);
  const [busy,setBusy] = useState(false), [notice,setNotice] = useState("");
  const [preview,setPreview] = useState<ReportSummaryPreview | null>(null);
  const generation = useRef(0), working = useRef(false);
  useEffect(() => {
    generation.current++;working.current=false;
    setProfitRequest("");setReceivablesRequest("");setReason("");setReviewed(false);
    setBusy(false);setNotice("");setPreview(null);
    return () => {generation.current++;};
  },[tenantId,actorId]);
  if (!canWrite || flag.data !== true) return null;
  const ready = uuid(profitRequest) && uuid(receivablesRequest) &&
    profitRequest.trim() !== receivablesRequest.trim() && reason.trim().length >= 3 &&
    reason.trim().length <= 500 && reviewed;
  async function readSaved() {
    if (!ready || working.current) return;
    const ticket = generation.current;
    working.current=true;
    setBusy(true);setNotice("");setPreview(null);
    try {
      const {data,error} = await getSupabaseClient().rpc("learn_quickbooks_report_summary_preview",{
        p_tenant:tenantId,p_profit_request:profitRequest.trim(),
        p_receivables_request:receivablesRequest.trim(),p_reason:reason.trim(),
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Saved report read unavailable");
      const checked = readReportSummaryPreview(data,{tenantId,profitRequest:profitRequest.trim(),
        receivablesRequest:receivablesRequest.trim()});
      if (ticket === generation.current) setPreview(checked);
    } catch { if (ticket === generation.current) setNotice("The saved reports could not be confirmed together. Review the exact receipts, company, dates and operator audit."); }
    finally {if (ticket === generation.current) {working.current=false;setBusy(false);setReviewed(false);}}
  }
  const amount = (value: string) => financeAmount(value,preview?.currency ?? null);
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Saved QuickBooks accounts report preview">
    <h4 className="font-semibold">Saved accounts reports · OpenFolk preview</h4>
    <p className="text-sm text-muted-foreground">Read two exact private QuickBooks receipts already captured for the same company and date. This makes no provider request. These are company accounts figures, not job profit or a reconciled invoice list. Client money remains withheld.</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Profit and loss receipt ID<input className="rounded-lg border bg-background p-2" value={profitRequest} onChange={e=>{setProfitRequest(e.target.value);setPreview(null);}} disabled={busy}/></label>
      <label className="grid gap-1 text-sm">Aged receivables receipt ID<input className="rounded-lg border bg-background p-2" value={receivablesRequest} onChange={e=>{setReceivablesRequest(e.target.value);setPreview(null);}} disabled={busy}/></label>
    </div>
    <label className="grid gap-1 text-sm">Reason for this accounts read<input className="rounded-lg border bg-background p-2" value={reason} maxLength={500} onChange={e=>{setReason(e.target.value);setPreview(null);}} disabled={busy}/></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/>I reviewed both receipts, the selected client and the reason for this audited read.</label>
    <button className="cp-secondary" disabled={!ready || busy} onClick={()=>void readSaved()}>{busy?"Reading saved evidence…":"Read saved report summaries"}</button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {preview && <div role="status" className="space-y-2 text-sm">
      <p><strong>QuickBooks Online · {preview.environment === "production" ? "LIVE" : "Sandbox"} company {preview.realmId}</strong></p>
      <p>P&amp;L {preview.periodStart} to {preview.periodEnd} · {preview.accountingMethod}. A/R as of {preview.arAsOf}. Currency {preview.currency}. Audit {preview.auditId}.</p>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <dt>Accounts gross profit</dt><dd>{amount(preview.summary.accountsGrossProfit)}</dd>
        <dt>Net profit · operator only</dt><dd>{amount(preview.summary.netProfit)}</dd>
        <dt>Accounts receivable total</dt><dd>{amount(preview.summary.arTotal)}</dd>
        <dt>Current</dt><dd>{amount(preview.summary.arCurrent)}</dd>
        <dt>1–30 days</dt><dd>{amount(preview.summary.ar1To30)}</dd>
        <dt>31–60 days</dt><dd>{amount(preview.summary.ar31To60)}</dd>
        <dt>61–90 days</dt><dd>{amount(preview.summary.ar61To90)}</dd>
        <dt>91+ days</dt><dd>{amount(preview.summary.ar91Plus)}</dd>
      </dl>
      <p className="break-all text-xs text-muted-foreground">P&amp;L SHA-256 {preview.profitSha256}; A/R SHA-256 {preview.receivablesSha256}.</p>
    </div>}
  </section>;
}
