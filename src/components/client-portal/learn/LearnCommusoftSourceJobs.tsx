import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { loadCommusoftReviewConnections, type ReviewClient, type ReviewConnection } from "@/lib/learn-commusoft-review";
import { loadSourceJobPage, SOURCE_JOB_IDENTITIES, SOURCE_JOB_RELATIONSHIPS, type SourceJobPage } from "@/lib/learn-commusoft-source-jobs";
import { LearnCommusoftJobDetails } from "./LearnCommusoftJobDetails";

/** Read-only source cards: unresolved identity never hides a retained job. */
export function LearnCommusoftSourceJobs({ tenantId, actorId, client, onOpenJob }: {
  tenantId: string; actorId: string; client?: ReviewClient; onOpenJob?: (id: string) => void;
}) {
  const db = client ?? getSupabaseClient();
  const [connections, setConnections] = useState<ReviewConnection[]>([]);
  const [connection, setConnection] = useState("");
  const [draft, setDraft] = useState(""), [query, setQuery] = useState("");
  const [view, setView] = useState<"all" | "holds" | "review">("all");
  const [openOnly, setOpenOnly] = useState(true), [revision, setRevision] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [result, setResult] = useState<{ key: string; data: SourceJobPage } | null>(null);
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const after = cursors[cursors.length - 1];
  const viewQuery = view === "holds" ? "status:on-hold" : view === "review" ? "status:needs-review" : query;
  const key = JSON.stringify([tenantId, actorId, connection, viewQuery, openOnly, after, revision]);
  const visible = !hidden && result?.key === key ? result.data : null;
  useEffect(() => {
    let active = true;
    setConnections([]); setConnection(""); setResult(null); setNotice(""); setBusy(false);
    void loadCommusoftReviewConnections(db, tenantId).then(rows => {
      if (active) { setConnections(rows); setConnection(rows[0]?.id ?? ""); if (!rows.length) setNotice("No verified Commusoft connection is available."); }
    }).catch(() => { if (active) setNotice("Commusoft connections are unavailable. Refresh to check access."); });
    return () => { active = false; };
  }, [tenantId, actorId, db, revision]);
  useEffect(() => {
    let active = true;
    setResult(null);
    if (!connection || hidden) return () => { active = false; };
    setBusy(true); setNotice("");
    void loadSourceJobPage(db, { tenant: tenantId, actor: actorId, connection, query: viewQuery, openOnly, after }).then(data => {
      if (active) setResult({ key, data });
    }).catch(() => { if (active) setNotice("Captured jobs are unavailable. Refresh or ask OpenFolk to check access."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [key, hidden, db]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { setHidden(true); setResult(null); setBusy(false); setNotice("Refresh to recheck access to captured jobs."); } };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => { setHidden(true); setResult(null); setNotice("Refresh to check the latest captured jobs."); }, 180000);
    return () => clearTimeout(timer);
  }, [visible]);
  return <section className="space-y-4" aria-label="Commusoft source job cards">
    <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">Jobs captured from Commusoft</h3>
      <p>Browse the work already captured, including jobs whose customer identity is still unresolved.</p></div>
      <button className="cp-secondary" onClick={() => { setHidden(false); setCursors([null]); setRevision(n => n + 1); }}>Refresh captured jobs</button></div>
    <div className="flex flex-wrap gap-2" aria-label="Captured job review views">
      <button className="cp-secondary" aria-pressed={view === "all"} onClick={() => { setView("all"); setCursors([null]); }}>All captured jobs</button>
      <button className="cp-secondary" aria-pressed={view === "holds"} onClick={() => { setView("holds"); setOpenOnly(true); setCursors([null]); }}>Recorded on hold</button>
      <button className="cp-secondary" aria-pressed={view === "review"} onClick={() => { setView("review"); setOpenOnly(true); setCursors([null]); }}>Needs source review</button>
    </div>
    <p className="text-sm">These views prioritise saved source evidence for operator review. They do not assign a team member or confirm the provider’s current job status.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setCursors([null]); setQuery(draft.trim()); setView("all"); }}>
      <label className="min-w-0 flex-1 text-sm">Connection<select className="mt-1 block min-h-11 w-full rounded-lg border border-[#cbbada] bg-white px-3 py-2" value={connection} onChange={e => { setConnection(e.target.value); setCursors([null]); }}><option value="">Choose a connection</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="min-w-0 flex-[2] text-sm">Find captured jobs<input type="search" className="mt-1 block min-h-11 w-full rounded-lg border border-[#cbbada] bg-white px-3 py-2" maxLength={200} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Job, customer/site reference or work description" /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={e => { setOpenOnly(e.target.checked); setCursors([null]); }} /> Open, pending and on-hold work</label>
      <button className="cp-secondary" type="submit" disabled={busy || hidden}>Find jobs</button>
    </form>
    {busy && <p role="status">Reading captured jobs…</p>}{notice && <p role="status">{notice}</p>}
    {visible && <>
      <p>{visible.counts.matching_jobs.toLocaleString()} matching jobs · {visible.counts.retained_jobs.toLocaleString()} retained in total · {visible.counts.open_jobs.toLocaleString()} recorded open/pending/on hold.</p>
      <p className="text-sm">Latest jobs check: {visible.latest_job_page_at ? new Date(visible.latest_job_page_at).toLocaleString("en-GB") : "Not established"}. Individual records can be older. Captured history may be incomplete.</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Captured job cards">{visible.rows.map(row => <article key={`${connection}:${row.external_id}:${row.version_id}`} className="cp-card min-w-0 space-y-3">
        <h4 className="break-words font-semibold">{row.title}</h4><p>Commusoft job {row.external_id} · Recorded status: {row.source_status ?? "Unresolved"}</p>
        {row.business_unit && <p>Source business unit: {row.business_unit}</p>}
        <p>Customer/site reference: {row.property_reference ?? "Not supplied"}{row.customer_reference && ` · Customer reference: ${row.customer_reference}`}</p>
        {row.company_name && <p>Source company name: {row.company_name}</p>}{row.contact_name && <p>Source primary contact: {row.contact_name}</p>}
        <p>{SOURCE_JOB_RELATIONSHIPS[row.relationship_state]}</p><p>{SOURCE_JOB_IDENTITIES[row.customer_identity_state]}</p>
        <p className="text-sm">Source observation: {new Date(row.observed_at).toLocaleString("en-GB")}. This does not verify job progress or completion.</p>
        {row.reviewed_job_id && onOpenJob ? <button className="cp-secondary" onClick={() => onOpenJob(row.reviewed_job_id!)}>Open linked job card</button> : <p className="text-sm">Communications and performance assessment are not established for this source view.</p>}
        {row.version_id && <LearnCommusoftJobDetails tenant={tenantId} connection={connection} version={row.version_id} external={row.external_id} client={db} />}
      </article>)}</div>
      {!visible.rows.length && <p>No captured jobs match this view. Clear the open-work filter to include closed work and conflicting source records.</p>}
      <div className="flex justify-between"><button className="cp-secondary" disabled={busy || cursors.length < 2} onClick={() => setCursors(v => v.slice(0, -1))}>Previous captured jobs</button><button className="cp-secondary" disabled={busy || !visible.next_after} onClick={() => visible.next_after && setCursors(v => [...v, visible.next_after])}>Next captured jobs</button></div>
    </>}
  </section>;
}
