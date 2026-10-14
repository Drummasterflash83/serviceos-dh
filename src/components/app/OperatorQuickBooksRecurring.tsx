import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import type { QuickBooksConnection } from "@/lib/learn-quickbooks";

type Policy = {
  connection_id: string; tenant_id: string; approved_by: string; enabled: boolean;
  revision: number; max_requests: number; interval_hours: number; last_state: string;
  last_completed_at: string | null; next_at: string;
};
const uuid = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const time = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
const states: Record<string, string> = {
  waiting: "Waiting for the next cycle", paused: "Paused", capturing: "Capture in progress",
  manual_capture_active: "Waiting for the current manual import",
  authority_or_module_needs_review: "Access or module setting needs review",
  connection_needs_review: "Connection needs review", checkpoint_needs_review: "Saved checkpoint needs review",
  incomplete_cycle_needs_review: "Incomplete cycle needs review",
};
export function OperatorQuickBooksRecurring({ tenantId, actorId, canWrite, connections }: {
  tenantId: string; actorId: string; canWrite: boolean; connections: QuickBooksConnection[];
}) {
  const [rows, setRows] = useState<Policy[]>([]), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [connectionId, setConnectionId] = useState(""), [reason, setReason] = useState(""), [reviewed, setReviewed] = useState(false);
  const [budget, setBudget] = useState(3000), [hours, setHours] = useState(6), [notice, setNotice] = useState("");
  const generation = useRef(0), working = useRef(false), backend = supabaseConfig.url;
  async function load() {
    const ticket = generation.current;
    setReady(false);
    try {
      const { data, error } = await getSupabaseClient().rpc("learn_quickbooks_recurring_read", { p_tenant: tenantId });
      if (error || !data || data.tenant_id !== tenantId || data.actor_id !== actorId || !time(data.checked_at) || !Array.isArray(data.rows)) throw Error();
      const next: Policy[] = data.rows;
      if (next.some(p => !uuid(p.connection_id) || p.tenant_id !== tenantId || !uuid(p.approved_by) || typeof p.enabled !== "boolean"
        || !Number.isSafeInteger(p.revision) || p.revision < 1 || !Number.isSafeInteger(p.max_requests) || p.max_requests < 1 || p.max_requests > 10000
        || !Number.isSafeInteger(p.interval_hours) || p.interval_hours < 1 || p.interval_hours > 168 || !Object.hasOwn(states,p.last_state)
        || !time(p.next_at) || !(p.last_completed_at === null || time(p.last_completed_at)))) throw Error();
      if (ticket === generation.current) { setRows(next); setReady(true); }
    } catch { if (ticket === generation.current) { setRows([]); setNotice("Refresh status before changing automatic capture."); } }
  }
  useEffect(() => {
    generation.current++; working.current=false; setRows([]); setBusy(false); setReady(false); setConnectionId(""); setReason(""); setReviewed(false); setNotice(""); void load();
    return () => { generation.current++; };
  }, [tenantId,actorId,backend]);
  const selected = connections.find(c => c.id === connectionId), policy = rows.find(p => p.connection_id === connectionId);
  useEffect(() => { if (policy) { setBudget(policy.max_requests); setHours(policy.interval_hours); } }, [policy?.connection_id, policy?.revision]);
  async function save(enabled: boolean) {
    if (!canWrite || working.current || !ready || !selected || !reviewed || reason.trim().length < 3 || reason.trim().length > 500
      || !Number.isInteger(budget) || budget < 1 || budget > 10000 || !Number.isInteger(hours) || hours < 1 || hours > 168) return;
    working.current=true; setBusy(true); setNotice(""); const ticket=generation.current;
    try {
      const { data,error } = await getSupabaseClient().rpc("learn_quickbooks_recurring_control", {
        p_tenant:tenantId,p_connection:selected.id,p_enabled:enabled,p_revision:policy?.revision ?? 0,
        p_max_requests:budget,p_interval_hours:hours,p_reason:reason.trim(),
      });
      if (error || data?.enabled !== enabled || data?.revision !== (policy?.revision ?? 0)+1) throw Error();
      if (ticket === generation.current) { setNotice(enabled ? "Automatic refresh approved. Verify the hosted worker and first completed cycle." : "Automatic refresh paused; captured history remains available."); setReviewed(false); await load(); }
    } catch { if (ticket === generation.current) { setNotice("The change is unconfirmed. Refresh status before trying again. Enabling requires a completed full-source baseline and a confirmed paused connection."); await load(); } }
    finally { if (ticket === generation.current) { working.current=false; setBusy(false); } }
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Automatic QuickBooks refresh">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Automatic QuickBooks refresh</h3><button className="cp-secondary" disabled={busy} onClick={()=>void load()}>Refresh automatic status</button></div>
    <p className="text-sm">Each cycle checks the captured customer, invoice, payment, supplier and other accounting collections. Every cycle has a request limit and pauses on incomplete capture. Figures still need accounting reconciliation.</p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {ready && <>
      <label className="grid gap-1 text-sm">Refresh company<select className="rounded border p-2" value={connectionId} disabled={busy} onChange={e=>{setConnectionId(e.target.value);setReviewed(false);setReason("");}}><option value="">Choose connected company</option>{connections.filter(c=>c.confirmedAt).map(c=><option key={c.id} value={c.id}>{c.companyName ?? c.realmId} · {c.environment === "production" ? "LIVE" : "SANDBOX"}</option>)}</select></label>
      {selected && <>
        <p className="text-sm">{policy ? `${policy.enabled ? "Enabled" : "Paused"} · ${states[policy.last_state]}` : "Automatic refresh not enabled"}</p>
        {policy && <p className="text-xs">Last completed cycle: {policy.last_completed_at ? new Date(policy.last_completed_at).toLocaleString("en-GB") : "Not yet verified"} · Next check: {new Date(policy.next_at).toLocaleString("en-GB")}</p>}
        {canWrite && <>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Hours after a completed cycle<input type="number" min={1} max={168} value={hours} disabled={busy} onChange={e=>setHours(Number(e.target.value))}/></label><label className="grid gap-1 text-sm">Maximum requests per cycle<input type="number" min={1} max={10000} value={budget} disabled={busy} onChange={e=>setBudget(Number(e.target.value))}/></label></div>
          <p className="text-xs">Up to 100 records per request; each cycle expires within 24 hours. Approval persists until paused. An incomplete cycle, changed connection or lost operator authority needs review before another cycle can start.</p>
          <label className="grid gap-1 text-sm">Reason for automatic refresh<input className="rounded border p-2" maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>I have reviewed this company, ongoing read scope and cycle limits.</label>
          <button className="cp-secondary" disabled={busy || !reviewed || reason.trim().length<3 || (policy?.enabled ? false : selected.status !== "paused")} onClick={()=>void save(!policy?.enabled)}>{policy?.enabled ? "Pause automatic QuickBooks refresh" : "Enable automatic QuickBooks refresh"}</button>
        </>}
      </>}
    </>}
  </section>;
}
