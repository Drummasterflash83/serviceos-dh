import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import type { QuickBooksConnection } from "@/lib/learn-quickbooks";
import { buildReportCaptureBody, readReportCaptureReceipt, readReportRefreshResult, reportCaptureConnectionReady, type ReportCaptureReceipt } from "@/lib/learn-quickbooks-report-capture";
import { DRUMMONDS_FY27_START, fy27LastCompletedUkDate } from "@/lib/new-dawn-md-money";

const DRUMMONDS_TENANT = "00000000-0000-0000-0000-000000000001";

/** Operator-only evidence capture. Never renders report rows or profit amounts. */
export function OperatorQuickBooksReportCapture({ tenantId, actorId, canWrite, connections, onConnectionRefresh }: {
  tenantId: string; actorId: string; canWrite: boolean; connections: QuickBooksConnection[];
  onConnectionRefresh: () => Promise<void>;
}) {
  const [connectionId, setConnectionId] = useState("");
  const [kind, setKind] = useState<"ProfitAndLoss" | "AgedReceivables">("ProfitAndLoss");
  const [periodStart, setPeriodStart] = useState(""), [periodEnd, setPeriodEnd] = useState("");
  const [accountingMethod, setAccountingMethod] = useState<"Cash" | "Accrual">("Accrual");
  const [reportDate, setReportDate] = useState("");
  const [reason, setReason] = useState(""), [reviewed, setReviewed] = useState(false),
    [refreshReviewed, setRefreshReviewed] = useState(false);
  const [receipt, setReceipt] = useState<ReportCaptureReceipt | null>(null);
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const generation = useRef(0), working = useRef(false);
  useEffect(() => {
    generation.current++; working.current = false;
    setConnectionId(""); setKind("ProfitAndLoss"); setPeriodStart(""); setPeriodEnd("");
    setAccountingMethod("Accrual"); setReportDate(""); setReason(""); setReviewed(false);
    setReceipt(null); setNotice(""); setBusy(false); setRefreshReviewed(false);
    return () => { generation.current++; };
  }, [tenantId, actorId]);
  if (!canWrite) return null;
  const available = connections.filter(c => c.confirmedAt && c.realmId && ["active", "paused"].includes(c.status));
  const selected = available.find(c => c.id === connectionId);
  const accessReady = reportCaptureConnectionReady(selected);
  const fy27Cutoff = tenantId === DRUMMONDS_TENANT ? fy27LastCompletedUkDate(new Date()) : null;
  const scopeReady = kind === "ProfitAndLoss" ? !!periodStart && !!periodEnd && periodStart <= periodEnd : !!reportDate;
  const reset = () => { setReviewed(false); setRefreshReviewed(false); setReceipt(null); setNotice(""); };
  async function refreshAccess() {
    if (!selected || accessReady || !refreshReviewed || working.current || reason.trim().length < 3 || reason.trim().length > 500) return;
    const ticket = generation.current, requestId = crypto.randomUUID();
    working.current = true; setBusy(true); setNotice("");
    try {
      const { data, error } = await getSupabaseClient().functions.invoke("learn-quickbooks-report-refresh", {
        body: { tenantId, connectionId: selected.id, requestId, realmId: selected.realmId,
          environment: selected.environment, reason: reason.trim() },
      });
      if (error) throw Error();
      const state = readReportRefreshResult(data, requestId);
      if (ticket !== generation.current) return;
      await onConnectionRefresh();
      setNotice(state === "refreshed" || state === "current" ?
        "QuickBooks access is current. Review the refreshed company status before capturing a report." :
        state === "busy" ? "Another credential refresh is in progress. Check company status before another action." :
        state === "authentication_required" ? "The saved QuickBooks authorization needs reconnection." :
        "The refresh result is unconfirmed. Check company status and audit before another action.");
    } catch {
      if (ticket === generation.current) setNotice(`The QuickBooks refresh result is unconfirmed (request ${requestId}). Check company status and audit before another action.`);
    } finally {
      if (ticket === generation.current) { working.current = false; setBusy(false); setRefreshReviewed(false); }
    }
  }
  async function capture() {
    if (!selected || !reportCaptureConnectionReady(selected) || !reviewed || !scopeReady || working.current || reason.trim().length < 3 || reason.trim().length > 500) return;
    const ticket = generation.current, requestId = crypto.randomUUID();
    working.current = true; setBusy(true); setNotice(""); setReceipt(null);
    try {
      const { data, error } = await getSupabaseClient().functions.invoke("learn-quickbooks-report-capture", {
        body: buildReportCaptureBody({ tenantId, connectionId: selected.id, requestId,
          realmId: selected.realmId!, environment: selected.environment, kind,
          periodStart, periodEnd, accountingMethod, reportDate, reason }),
      });
      if (error) throw Error();
      const checked = readReportCaptureReceipt(data, { requestId, tenantId,
        realmId: selected.realmId!, environment: selected.environment, kind });
      if (ticket === generation.current) setReceipt(checked);
    } catch {
      if (ticket === generation.current) setNotice(`The one-use report capture was not confirmed (request ${requestId}). Inspect its audit before trying a new request.`);
    } finally {
      if (ticket === generation.current) { working.current = false; setBusy(false); setReviewed(false); }
    }
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="QuickBooks report evidence capture">
    <h4 className="font-semibold">Accounting report evidence · OpenFolk only</h4>
    <p className="text-sm text-muted-foreground">Capture one dated QuickBooks report as a private, audited source receipt. This performs one read-only provider request. It does not publish money figures or enable the owner panel.</p>
    <label className="grid gap-1 text-sm">Connected company
      <select className="rounded-lg border bg-background p-2" disabled={busy} value={connectionId}
        onChange={e => { setConnectionId(e.target.value); reset(); }}>
        <option value="">Choose company</option>
        {available.map(c => <option key={c.id} value={c.id}>{c.companyName ?? c.realmId} · {c.environment === "production" ? "LIVE" : "Sandbox"}</option>)}
      </select>
    </label>
    {fy27Cutoff && <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p><strong>Drummonds FY27 source pair:</strong> 1 April 2026 to {fy27Cutoff}. These buttons fill the dates only. Review and capture the accrual P&amp;L and matching aged receivables separately; neither button contacts QuickBooks.</p>
      <div className="flex flex-wrap gap-2">
        <button className="cp-secondary" type="button" disabled={busy} onClick={() => {
          setKind("ProfitAndLoss"); setPeriodStart(DRUMMONDS_FY27_START); setPeriodEnd(fy27Cutoff);
          setAccountingMethod("Accrual"); reset();
        }}>Set FY27 P&amp;L scope</button>
        <button className="cp-secondary" type="button" disabled={busy} onClick={() => {
          setKind("AgedReceivables"); setReportDate(fy27Cutoff); reset();
        }}>Set matching receivables date</button>
      </div>
    </div>}
    {selected && !accessReady && <p role="status" className="text-sm text-muted-foreground">Current QuickBooks access has expired or is about to expire. Refresh or reconnect this company, then refresh its status before capturing a report.</p>}
    <label className="grid gap-1 text-sm">Report
      <select className="rounded-lg border bg-background p-2" disabled={busy} value={kind}
        onChange={e => { setKind(e.target.value as typeof kind); reset(); }}>
        <option value="ProfitAndLoss">Profit and loss</option><option value="AgedReceivables">Aged receivables</option>
      </select>
    </label>
    {kind === "ProfitAndLoss" ? <div className="grid gap-2 sm:grid-cols-3">
      <label className="grid gap-1 text-sm">Start date<input className="rounded-lg border bg-background p-2" type="date" disabled={busy} value={periodStart} onChange={e => { setPeriodStart(e.target.value); reset(); }}/></label>
      <label className="grid gap-1 text-sm">End date<input className="rounded-lg border bg-background p-2" type="date" disabled={busy} value={periodEnd} onChange={e => { setPeriodEnd(e.target.value); reset(); }}/></label>
      <label className="grid gap-1 text-sm">Accounting basis<select className="rounded-lg border bg-background p-2" disabled={busy} value={accountingMethod} onChange={e => { setAccountingMethod(e.target.value as typeof accountingMethod); reset(); }}><option value="Accrual">Accrual</option><option value="Cash">Cash</option></select></label>
    </div> : <label className="grid gap-1 text-sm">Report date · ageing at report date
      <input className="rounded-lg border bg-background p-2" type="date" disabled={busy} value={reportDate} onChange={e => { setReportDate(e.target.value); reset(); }}/>
    </label>}
    <label className="grid gap-1 text-sm">Reason for this QuickBooks action
      <input className="rounded-lg border bg-background p-2" maxLength={500} disabled={busy} value={reason} onChange={e => { setReason(e.target.value); reset(); }}/>
    </label>
    {selected && !accessReady && <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm">A credential refresh uses the existing saved authorization for this company. It does not read a report or start an import.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={refreshReviewed} disabled={busy || reason.trim().length < 3}
        onChange={e => setRefreshReviewed(e.target.checked)}/>I reviewed this company and reason for one credential refresh.</label>
      <button className="cp-secondary" disabled={busy || !refreshReviewed || reason.trim().length < 3 || reason.trim().length > 500}
        onClick={() => void refreshAccess()}>Refresh this company’s access</button>
    </div>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || !selected || !accessReady || !scopeReady}
      onChange={e => setReviewed(e.target.checked)}/>I reviewed this client, company, report, date, basis and reason for one read-only capture.</label>
    <button className="cp-secondary" disabled={busy || !selected || !accessReady || !reviewed || !scopeReady || reason.trim().length < 3}
      onClick={() => void capture()}>Capture this report once</button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {receipt && <p role="status" className="text-sm">{receipt.validationState === "held" ?
      `Held ${receipt.kind} response for review (${receipt.validationCode}). No figures can be published from this receipt.` :
      `Saved ${receipt.kind} source receipt. Figures remain unpublished pending reconciliation.`}
      {` Company ${receipt.realmId} · ${receipt.bytes} bytes · SHA-256 ${receipt.sha256} · audit ${receipt.auditId}. Report currency: ${receipt.currency ?? "not supplied"}; provider time: ${receipt.reportTime ?? "not supplied"}.`}</p>}
    {receipt && <p className="break-all text-xs text-muted-foreground">Saved receipt ID: {receipt.requestId}</p>}
  </section>;
}
