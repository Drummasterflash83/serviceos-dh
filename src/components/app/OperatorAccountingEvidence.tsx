import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { readOperatorInputWriteAccess } from "@/lib/learn-operator-inputs";
import { readQuickBooksOverview, type QuickBooksOverview } from "@/lib/learn-quickbooks";
import { OperatorQuickBooksReportCapture } from "./OperatorQuickBooksReportCapture";
import { OperatorApprovedFy27Pair } from "./OperatorApprovedFy27Pair";
import { OperatorDailyQuickBooksReports } from "./OperatorDailyQuickBooksReports";
import { OperatorAgedInvoices } from "@/components/client-portal/OperatorAgedInvoices";

/** Short operator path to the existing reviewed, one-use report action. */
export function OperatorAccountingEvidence({ tenantId, actorId }: {
  tenantId: string;
  actorId: string;
}) {
  const [overview, setOverview] = useState<QuickBooksOverview | null>(null);
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setChecking(true);
    setError(false);
    try {
      const db = getSupabaseClient();
      const [status, permission] = await Promise.all([
        db.rpc("learn_quickbooks_status", { p_tenant: tenantId }),
        readOperatorInputWriteAccess(db),
      ]);
      if (status.error || permission === null) throw Error("Accounting status unavailable");
      if (ticket !== generation.current) return;
      setOverview(readQuickBooksOverview(status.data, tenantId));
      setCanWrite(permission);
    } catch {
      if (ticket !== generation.current) return;
      setOverview(null);
      setCanWrite(null);
      setError(true);
    } finally {
      if (ticket === generation.current) setChecking(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load, actorId]);

  return <section className="cp-root op-embedded space-y-4" aria-label="Accounting evidence">
    <div className="cp-card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">OpenFolk only</p>
          <h1 className="text-xl font-semibold">Accounting evidence</h1>
          <p className="text-sm">Review one client, company and dated source request at a time. Reports remain private until reconciled.</p>
        </div>
        <button className="cp-secondary" type="button" onClick={() => void load()} disabled={checking}>Refresh company status</button>
      </div>
      {checking && <p role="status">Checking QuickBooks company and operator access…</p>}
      {error && <p role="alert">Accounting status could not be verified. No report action is available; refresh before trying again.</p>}
      {overview && <p className="text-xs text-muted-foreground">Company status checked {new Date(overview.checkedAt).toLocaleString("en-GB")}.</p>}
      {canWrite === false && <p role="status">Read-only operator access. An authorised OpenFolk administrator must review and capture source evidence.</p>}
      {overview && canWrite === true && !checking && <>
        <OperatorApprovedFy27Pair key={`fy27:${tenantId}:${actorId}`}
          tenantId={tenantId} actorId={actorId} connections={overview.connections}/>
        <OperatorDailyQuickBooksReports key={`daily:${tenantId}:${actorId}`}
          tenantId={tenantId} actorId={actorId} connections={overview.connections}/>
        <OperatorQuickBooksReportCapture key={`${tenantId}:${actorId}`}
          tenantId={tenantId} actorId={actorId} canWrite
          connections={overview.connections} onConnectionRefresh={load}/>
        <OperatorAgedInvoices tenant={tenantId}
          reason="Review saved 91+ invoice source for the selected client MD Money reconciliation" />
      </>}
    </div>
  </section>;
}
