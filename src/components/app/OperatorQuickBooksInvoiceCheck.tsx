import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import type { QuickBooksConnection } from "@/lib/learn-quickbooks";
import { readInvoiceCheckCandidates, readInvoiceCheckOutcome,
  type InvoiceCheckCandidates, type InvoiceCheckOutcome } from "@/lib/learn-quickbooks-invoice-check";

/** A deliberate, operator-only readback. The server chooses invoice IDs from
 * current retained source versions; the browser never receives OAuth tokens. */
export function OperatorQuickBooksInvoiceCheck({ tenantId, actorId, canWrite, connections }: {
  tenantId: string; actorId: string; canWrite: boolean; connections: QuickBooksConnection[];
}) {
  const [connectionId, setConnectionId] = useState("");
  const [reason, setReason] = useState("");
  const [candidates, setCandidates] = useState<InvoiceCheckCandidates | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<InvoiceCheckOutcome | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0), working = useRef(false);
  useEffect(() => {
    generation.current++;
    working.current = false;
    setConnectionId(""); setReason(""); setCandidates(null); setChosen([]);
    setReviewed(false); setResult(null); setNotice(""); setBusy(false);
    return () => { generation.current++; };
  }, [tenantId, actorId]);
  if (!canWrite) return null;
  const available = connections.filter(c => c.confirmedAt && c.realmId && ["active","paused"].includes(c.status));
  const selected = available.find(c => c.id === connectionId);
  async function load() {
    if (!selected || working.current || reason.trim().length < 3 || reason.trim().length > 500) return;
    const ticket = generation.current;
    working.current = true; setBusy(true); setNotice(""); setCandidates(null); setChosen([]); setResult(null); setReviewed(false);
    try {
      const { data, error } = await getSupabaseClient().rpc("learn_quickbooks_invoice_check_candidates", {
        p_tenant: tenantId, p_connection: selected.id, p_reason: reason.trim(),
      }).abortSignal(AbortSignal.timeout(15000));
      if (error) throw Error();
      const next = readInvoiceCheckCandidates(data, tenantId, actorId, selected.id);
      if (next.realm_id !== selected.realmId || next.environment !== selected.environment) throw Error();
      if (ticket === generation.current) setCandidates(next);
    } catch {
      if (ticket === generation.current) setNotice("Saved invoice samples could not be verified. Check the selected company and operator access.");
    } finally {
      if (ticket === generation.current) { working.current = false; setBusy(false); }
    }
  }
  async function compare() {
    if (!selected || !candidates || !reviewed || working.current || chosen.length < 2 || chosen.length > 3 ||
      reason.trim().length < 3 || reason.trim().length > 500 ||
      candidates.connection_id !== selected.id || candidates.realm_id !== selected.realmId ||
      chosen.some(id => !candidates.rows.some(row => row.version_id === id))) return;
    const ticket = generation.current, requestId = crypto.randomUUID();
    working.current = true; setBusy(true); setNotice(""); setResult(null);
    try {
      const { data, error } = await getSupabaseClient().functions.invoke("learn-quickbooks-invoice-check", {
        body: { tenantId, connectionId: selected.id, requestId, versionIds: chosen, reason: reason.trim() },
      });
      if (error) throw Error();
      const checked = readInvoiceCheckOutcome(data, {
        tenant: tenantId, realm: candidates.realm_id, environment: candidates.environment,
        request: requestId, versions: chosen,
      });
      if (ticket === generation.current) { setResult(checked); setReviewed(false); }
    } catch {
      if (ticket === generation.current) {
        setNotice(`The one-use check was not confirmed (request ${requestId}). Do not repeat it automatically; inspect its saved audit/result first.`);
        setReviewed(false);
      }
    } finally {
      if (ticket === generation.current) { working.current = false; setBusy(false); }
    }
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="QuickBooks invoice verification">
    <h4 className="font-semibold">Invoice source check · OpenFolk only</h4>
    <p className="text-sm text-muted-foreground">Compare two or three saved invoices with current QuickBooks. This makes read-only provider requests and records an audit; it does not update saved invoices or publish the money panel.</p>
    <label className="grid gap-1 text-sm">Connected company
      <select className="rounded-lg border bg-background p-2" disabled={busy} value={connectionId}
        onChange={e => { setConnectionId(e.target.value); setCandidates(null); setChosen([]); setResult(null); setReviewed(false); }}>
        <option value="">Choose company</option>
        {available.map(c => <option key={c.id} value={c.id}>{c.companyName ?? c.realmId} · {c.environment === "production" ? "LIVE" : "Sandbox"}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm">Reason for this source check
      <input className="rounded-lg border bg-background p-2" maxLength={500} disabled={busy} value={reason}
        onChange={e => { setReason(e.target.value); setCandidates(null); setChosen([]); setResult(null); setReviewed(false); }}/>
    </label>
    <button className="cp-secondary" disabled={busy || !selected || reason.trim().length < 3 || reason.trim().length > 500}
      onClick={() => void load()}>Find current saved invoice samples</button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {candidates && <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Saved candidates checked {new Date(candidates.checked_at).toLocaleString("en-GB")} · candidate audit {candidates.audit_id}. Select exactly two or three from company {candidates.realm_id}.</p>
      {candidates.rows.length === 0 && <p className="text-sm">No comparable saved invoices were found for this connection.</p>}
      <div className="grid gap-2 sm:grid-cols-2">{candidates.rows.map(row => <label key={row.version_id} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
        <input type="checkbox" disabled={busy || (!chosen.includes(row.version_id) && chosen.length >= 3)}
          checked={chosen.includes(row.version_id)} onChange={e => { setChosen(previous => e.target.checked ? [...previous,row.version_id] : previous.filter(id => id !== row.version_id)); setReviewed(false); setResult(null); }}/>
        <span>Invoice {row.document_number ?? row.invoice_id} · due {row.due_date}<br/><span className="text-xs text-muted-foreground">Saved {new Date(row.observed_at).toLocaleString("en-GB")}</span></span>
      </label>)}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || chosen.length < 2}
        onChange={e => setReviewed(e.target.checked)}/>I reviewed this client, company, reason and {chosen.length} exact invoices for a read-only check.</label>
      <button className="cp-secondary" disabled={busy || !reviewed || chosen.length < 2 || chosen.length > 3}
        onClick={() => void compare()}>Compare selected invoices once</button>
    </div>}
    {result && <div role="status" className="rounded-lg border p-3 text-sm">
      <p>Compared {new Date(result.comparedAt).toLocaleString("en-GB")} · audit {result.auditId}</p>
      <ul>{result.rows.map((row, i) => <li key={row.versionId}>Invoice {i+1}: balance {row.balanceMatches ? "matches" : "differs"}; due date {row.dueDateMatches ? "matches" : "differs"}.</li>)}</ul>
      <p className="text-xs text-muted-foreground">A difference may reflect newer QuickBooks changes. This check does not establish complete accounts receivable or profit.</p>
    </div>}
  </section>;
}
