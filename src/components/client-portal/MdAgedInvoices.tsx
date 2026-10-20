import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { readMdAgedInvoicePage, type AgedInvoice, type AgedInvoicePage } from
  "@/lib/new-dawn-md-aged-invoices";

/** Only mounted within Chris's guarded, short-lived Drummonds MD session. */
export function MdAgedInvoices({ tenant, reason }: { tenant: string; reason: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<AgedInvoice[]>([]);
  const [page, setPage] = useState<AgedInvoicePage | null>(null);
  const [auditIds, setAuditIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const working = useRef(false);
  useEffect(() => {
    generation.current++;
    working.current = false;
    setRows([]); setPage(null); setAuditIds([]); setBusy(false); setError("");
    return () => { generation.current++; };
  }, [tenant, user?.id, reason]);
  const flag = useQuery({
    queryKey: ["md-aged-invoices-flag", tenant, user?.id],
    enabled: !!user,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", "new_dawn.invoice_review_candidates_preview").maybeSingle();
      if (error) throw Error("Invoice review release unavailable");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
  if (!user || flag.data !== true || reason.trim().length < 3) return null;

  async function readPage(next: boolean) {
    if (!user || working.current || (next && (!page?.hasMore || rows.length === 0))) return;
    const after = next ? rows[rows.length - 1] : null;
    const ticket = ++generation.current;
    working.current = true; setBusy(true); setError("");
    try {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_md_aged_invoice_review", {
        p_tenant: tenant, p_reason: reason.trim(),
        p_after_due: after?.dueDate ?? null, p_after_version: after?.versionId ?? null,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Aged invoice read unavailable");
      const checked = readMdAgedInvoicePage(data, tenant, user.id, after);
      if (next && page && (checked.asOf !== page.asOf || checked.realmId !== page.realmId ||
        checked.candidates.some(candidate => rows.some(row => row.versionId === candidate.versionId))))
        throw Error("Aged invoice page changed");
      if (ticket === generation.current) {
        setRows(next ? [...rows, ...checked.candidates] : checked.candidates);
        setPage(checked);
        setAuditIds(next ? [...auditIds, checked.auditId] : [checked.auditId]);
      }
    } catch {
      if (ticket === generation.current)
        setError("The saved 91+ invoice source could not be checked. No new records were shown.");
    } finally {
      if (ticket === generation.current) { working.current = false; setBusy(false); }
    }
  }
  return <details className="md-money-aged" aria-label="91-day invoice source review">
    <summary>Inspect saved invoice records</summary>
    <p>Saved QuickBooks invoice leads due 91 days or more ago. The balances are original invoice snapshots, not a reconciled debt total, customer chase list or Commusoft job link.</p>
    <button className="cp-secondary" type="button" disabled={busy}
      onClick={() => void readPage(false)}>
      {busy && rows.length === 0 ? "Checking saved invoices…" : "Review saved 91+ invoices"}
    </button>
    {error && <p role="alert">{error}</p>}
    {page && <>
      <p className="md-money-source">QuickBooks production company {page.realmId} · as of {page.asOf} · {page.eligibleCount} source candidates · showing {rows.length}{page.hasMore ? " so far" : ""}. Only invoices observed within seven days are eligible.</p>
      {rows.length === 0 ? <p>No qualifying saved invoice sources are available. This does not establish that debt is zero.</p> :
        <ol className="md-money-aged-list">{rows.map(row => <li key={row.versionId}>
          <strong>Invoice {row.documentNumber || row.invoiceId}</strong>
          <span>Due {row.dueDate} · saved balance {financeAmount(row.balance, row.currency)}</span>
          <small>Observed {row.sourceObservedAt.slice(0, 16).replace("T", " ")} UTC · source updated {row.sourceUpdatedAt.slice(0, 10)}</small>
          <details><summary>Source proof</summary>Invoice ID {row.invoiceId}; version {row.versionId}; SHA-256 {row.sourceSha256}.</details>
        </li>)}</ol>}
      {page.hasMore && <button className="cp-secondary" type="button" disabled={busy}
        onClick={() => void readPage(true)}>{busy ? "Checking next page…" : "Show 20 more"}</button>}
      <details className="md-money-proof"><summary>Read audits</summary>{auditIds.join(" · ")}</details>
    </>}
  </details>;
}
