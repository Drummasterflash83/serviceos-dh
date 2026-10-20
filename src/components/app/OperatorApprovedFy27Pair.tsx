import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import type { QuickBooksConnection } from "@/lib/learn-quickbooks";
import { readReportCaptureReceipt, reportCaptureConnectionReady,
  type ReportCaptureReceipt } from "@/lib/learn-quickbooks-report-capture";
import { approvedFy27PairBodies, DRUMMONDS_FY27_PAIR } from "@/lib/new-dawn-fy27-report-pair";

type Attempt = { requestIds: { profit: string; receivables: string }; state: string; at: string };

function readAttempt(key: string): Attempt | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && "requestIds" in value &&
      value.requestIds && typeof value.requestIds === "object" &&
      "profit" in value.requestIds && typeof value.requestIds.profit === "string" &&
      "receivables" in value.requestIds && typeof value.requestIds.receivables === "string" &&
      "state" in value && typeof value.state === "string" &&
      "at" in value && typeof value.at === "string") return value as Attempt;
  } catch { /* An unknown prior attempt still blocks a retry. */ }
  return { requestIds: { profit: "unavailable", receivables: "unavailable" },
    state: "unconfirmed", at: "unavailable" };
}

/** A deliberate, one-time operator action for the exact approved LIVE source pair. */
export function OperatorApprovedFy27Pair({ tenantId, actorId, connections }: {
  tenantId: string;
  actorId: string;
  connections: QuickBooksConnection[];
}) {
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [prior, setPrior] = useState(false);
  const [notice, setNotice] = useState("");
  const [receipts, setReceipts] = useState<ReportCaptureReceipt[]>([]);
  const connection = connections.find(c => c.environment === "production" &&
    c.realmId === DRUMMONDS_FY27_PAIR.realmId);
  const key = `serviceos.approved-fy27-pair.v1:${tenantId}:${actorId}:${DRUMMONDS_FY27_PAIR.realmId}`;
  const current = reportCaptureConnectionReady(connection);

  useEffect(() => {
    try {
      setStorageReady(Boolean(navigator.locks));
      setAttempt(readAttempt(key));
      setPrior(localStorage.getItem(key) !== null);
    } catch {
      setStorageReady(false);
      setPrior(true);
    }
  }, [key]);

  async function capture() {
    if (tenantId !== DRUMMONDS_FY27_PAIR.tenantId || !reviewed || !current || !connection ||
      !storageReady || prior || busy) return;
    setBusy(true); setNotice(""); setReceipts([]);
    try {
      await navigator.locks.request(key, { ifAvailable: true }, async lock => {
        if (!lock || localStorage.getItem(key)) throw Error("Existing request must be reviewed");
        const requestIds = { profit: crypto.randomUUID(), receivables: crypto.randomUUID() };
        const bodies = approvedFy27PairBodies(connection, requestIds);
        // Persist only request IDs before any provider call. A lost response must
        // be audited, never silently retried with a new one-use request.
        localStorage.setItem(key, JSON.stringify({ requestIds, state: "started", at: new Date().toISOString() }));
        setPrior(true);
        setAttempt(readAttempt(key));
        const saved: ReportCaptureReceipt[] = [];
        for (const body of bodies) {
          const { data, error } = await getSupabaseClient().functions.invoke("learn-quickbooks-report-capture", { body });
          if (error) throw Error("A report result is unconfirmed");
          const receipt = readReportCaptureReceipt(data, {
            requestId: body.requestId, tenantId, realmId: DRUMMONDS_FY27_PAIR.realmId,
            environment: "production", kind: body.kind,
          });
          saved.push(receipt); setReceipts([...saved]);
          localStorage.setItem(key, JSON.stringify({ requestIds,
            state: receipt.validationState === "verified" ? body.kind : "held",
            at: new Date().toISOString() }));
          setAttempt(readAttempt(key));
          if (receipt.validationState !== "verified") throw Error("A report was held for review");
        }
        localStorage.setItem(key, JSON.stringify({ requestIds, state: "complete", at: new Date().toISOString() }));
        setAttempt(readAttempt(key));
        setNotice("Both source receipts were saved and validated. Reconcile the period and amounts before any MD publication.");
      });
    } catch {
      setNotice("The pair is incomplete or unconfirmed. Inspect the saved request IDs and audit before any retry; no automatic retry will run.");
    } finally {
      setBusy(false); setReviewed(false);
      try { setPrior(localStorage.getItem(key) !== null); setAttempt(readAttempt(key)); }
      catch { setPrior(true); }
    }
  }

  if (tenantId !== DRUMMONDS_FY27_PAIR.tenantId) return null;
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Approved Drummonds FY27 source pair">
    <h2 className="font-semibold">Approved Drummonds FY27 source pair</h2>
    <p className="text-sm">LIVE company {DRUMMONDS_FY27_PAIR.realmId} · accrual P&amp;L 1 April–19 October 2026, then aged receivables dated 19 October 2026. Exactly two separate read-only QuickBooks requests; no accounting write or publication.</p>
    <p className="text-sm">Audit reason: {DRUMMONDS_FY27_PAIR.reason}.</p>
    {!current && <p role="status">The production company or current access is unavailable. Refresh its status, or use the reviewed credential refresh in the existing QuickBooks controls.</p>}
    {!storageReady && <p role="status">Browser request locking is unavailable. The pair cannot start safely here.</p>}
    {prior && <div role="status" className="space-y-1 text-xs break-all">
      <p>A pair request has already been prepared in this browser. Check its request IDs and audit; this control will not send it again.</p>
      {attempt && <p>State: {attempt.state} · prepared {attempt.at} · P&amp;L request {attempt.requestIds.profit} · A/R request {attempt.requestIds.receivables}</p>}
    </div>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed}
      disabled={busy || prior || !storageReady || !current}
      onChange={event => setReviewed(event.target.checked)}/>
      I reviewed the Drummonds tenant, LIVE company, both dates, accrual basis and one-use read-only action.
    </label>
    <button type="button" className="cp-secondary" disabled={!reviewed || busy || prior || !storageReady || !current}
      onClick={() => void capture()}>{busy ? "Capturing the approved pair…" : "Capture approved FY27 pair once"}</button>
    {notice && <p role="status">{notice}</p>}
    {receipts.map(receipt => <p className="text-xs break-all" key={receipt.requestId}>
      {receipt.kind}: {receipt.validationState} · request {receipt.requestId} · audit {receipt.auditId} · SHA-256 {receipt.sha256}.
    </p>)}
  </section>;
}
