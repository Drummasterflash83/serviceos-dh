import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { loadCommusoftReviewConnections, type ReviewClient, type ReviewConnection } from "@/lib/learn-commusoft-review";
import { createSourceJobReviewAction, customerSourceForReview, loadSourceJobPage, SOURCE_JOB_IDENTITIES, SOURCE_JOB_RELATIONSHIPS, type SourceJobPage } from "@/lib/learn-commusoft-source-jobs";
import { loadRecentUnlinkedJobs, type RecentUnlinkedJob, type RecentUnlinkedPage } from "@/lib/new-dawn-recent-unlinked-jobs";
import { planGuidedJobReview, type GuidedJobReview } from "@/lib/new-dawn-guided-job-review";
import { LearnCommusoftJobDetails } from "./LearnCommusoftJobDetails";
import { ExactLinkReviewQueue } from "./ExactLinkReviewQueue";

function ReviewTaskButton({ db, tenant, connection, external, version }: {
  db: ReviewClient; tenant: string; connection: string; external: string; version: string;
}) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [taskId, setTaskId] = useState("");
  return <div className="space-y-2 rounded-lg border border-[#cbbada] p-3 text-sm">
    <p>An OpenFolk review task can be assigned to a confirmed team member. It is not a Commusoft appointment or technician assignment.</p>
    {taskId ? <p role="status">Review task {taskId} is in the Command Centre. <a href="/app#/command" className="underline">Open work queue to accept it</a>.</p> :
      open ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); setBusy(true); setNotice("");
        void createSourceJobReviewAction(db, { tenant, connection, external, version, reason })
          .then(r => { setTaskId(r.id); setOpen(false); })
          .catch(e => setNotice(e instanceof Error ? e.message : "Review task unavailable"))
          .finally(() => setBusy(false)); }}>
        <label className="block">Reason for human source review<input className="mt-1 block w-full rounded-md border border-[#cbbada] p-2"
          maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. Verify the recorded hold against the latest provider status" /></label>
        <div className="flex gap-2"><button type="submit" className="cp-secondary" disabled={busy || !reason.trim()}>
          {busy ? "Creating…" : "Create audited review task"}</button>
          <button type="button" className="cp-secondary" disabled={busy} onClick={() => { setOpen(false); setReason(""); }}>Cancel</button></div>
        {notice && <p role="alert">{notice}</p>}
      </form> : <button type="button" className="cp-secondary" onClick={() => setOpen(true)}>Prepare OpenFolk review task</button>}
  </div>;
}

/** Read-only source cards: unresolved identity never hides a retained job. */
export function LearnCommusoftSourceJobs({ tenantId, actorId, client, onOpenJob, onReviewJob, onReviewCustomer, onReviewSite, operatorReason }: {
  tenantId: string; actorId: string; client?: ReviewClient; onOpenJob?: (id: string) => void;
  onReviewJob?: (connection: string, external: string) => void;
  onReviewCustomer?: (review: GuidedJobReview) => void;
  onReviewSite?: (review: GuidedJobReview) => void;
  operatorReason?: string;
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
  const [recent, setRecent] = useState<{ key: string; data: RecentUnlinkedPage } | null>(null);
  const [recentBusy, setRecentBusy] = useState(false), [recentNotice, setRecentNotice] = useState("");
  const [selectedRecent, setSelectedRecent] = useState<string | null>(null);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(!operatorReason);
  const browseSearch = useRef<HTMLInputElement>(null);
  const recentKey = JSON.stringify([tenantId, actorId, connection, operatorReason, revision]);
  const visibleRecent = !hidden && recent?.key === recentKey ? recent.data : null;
  const after = cursors[cursors.length - 1];
  const viewQuery = view === "holds" ? "status:on-hold" : view === "review" ? "status:needs-review" : query;
  const key = JSON.stringify([tenantId, actorId, connection, viewQuery, openOnly, after, revision]);
  const visible = browseOpen && !hidden && result?.key === key ? result.data : null;
  async function reviewExactCustomer(recentJob: RecentUnlinkedJob) {
    if (!onReviewCustomer || !connection || hidden) return;
    setRecentBusy(true); setRecentNotice("");
    try {
      const page = await loadSourceJobPage(db, {
        tenant: tenantId, actor: actorId, connection, query: recentJob.external_id, openOnly: false, after: null,
      });
      const exact = page.rows.find(row => row.external_id === recentJob.external_id);
      onReviewCustomer(planGuidedJobReview(connection, recentJob, exact));
    } catch {
      setRecentNotice("The exact job/customer source could not be verified. Refresh the captured job before reviewing identity.");
    } finally { setRecentBusy(false); }
  }
  function reviewCardCustomer(row: SourceJobPage["rows"][number]) {
    if (!onReviewCustomer || !connection || hidden) return;
    try {
      onReviewCustomer(planGuidedJobReview(connection, {
        external_id: row.external_id, version_id: row.version_id,
        source_observed_at: row.observed_at, source_status: row.source_status,
        relationship_state: row.relationship_state,
        customer_identity_state: row.customer_identity_state,
      }, row));
    } catch {
      setNotice("This source changed or lacks an exact customer/site reference. Refresh before reviewing identity.");
    }
  }
  function openCapturedJob(job: string) {
    setView("all"); setDraft(job); setQuery(job); setOpenOnly(false); setCursors([null]);
    setBrowseOpen(true);
    requestAnimationFrame(() => browseSearch.current?.focus());
  }
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
    if (!connection || hidden || !browseOpen) return () => { active = false; };
    setBusy(true); setNotice("");
    void loadSourceJobPage(db, { tenant: tenantId, actor: actorId, connection, query: viewQuery, openOnly, after }).then(data => {
      if (active) setResult({ key, data });
    }).catch(() => { if (active) setNotice("Captured jobs are unavailable. Refresh or ask OpenFolk to check access."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [key, hidden, browseOpen, db]);
  useEffect(() => {
    let active = true;
    setRecent(null); setSelectedRecent(null); setShowAllRecent(false);
    if (!operatorReason || !connection || hidden) return () => { active = false; };
    setRecentBusy(true); setRecentNotice("");
    void loadRecentUnlinkedJobs(getSupabaseClient(), {
      tenant: tenantId, connection, actor: actorId, reason: operatorReason,
    }).then(data => { if (active) setRecent({ key: recentKey, data }); })
      .catch(() => { if (active) setRecentNotice("Recent unlinked jobs are unavailable. Refresh the OpenFolk review."); })
      .finally(() => { if (active) setRecentBusy(false); });
    return () => { active = false; };
  }, [recentKey, hidden]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { setHidden(true); setResult(null); setRecent(null); setBusy(false); setRecentBusy(false); setNotice("Refresh to recheck access to captured jobs."); } };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => { setHidden(true); setResult(null); setNotice("Refresh to check the latest captured jobs."); }, 180000);
    return () => clearTimeout(timer);
  }, [visible]);
  return <section className="space-y-4" aria-label="Commusoft source job cards">
    <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{operatorReason ? "Review recent saved jobs" : "Jobs captured from Commusoft"}</h3>
      <p>{operatorReason ? "Start with the newest jobs awaiting identity review. The full captured archive is available below." : "Browse the work already captured, including jobs whose customer identity is still unresolved."}</p></div>
      <button className="cp-secondary" onClick={() => { setHidden(false); setCursors([null]); setRevision(n => n + 1); }}>{operatorReason ? "Refresh source review" : "Refresh captured jobs"}</button></div>
    {operatorReason && connection && <ExactLinkReviewQueue tenant={tenantId} actor={actorId}
      connection={connection} reason={operatorReason} db={db}
      onReviewJob={onReviewJob} onReviewCustomer={onReviewCustomer} onReviewSite={onReviewSite} />}
    {operatorReason && <section className="rounded-xl border border-[#cbbada] bg-white p-4 space-y-3" aria-label="Recent unlinked jobs for OpenFolk review">
      <h4 className="font-semibold">Recently captured jobs awaiting a reviewed link</h4>
      <p className="text-sm">OpenFolk review only. These are saved Commusoft records, not current job progress or automatic customer matches.</p>
      {recentBusy && <p role="status">Checking recent source records…</p>}
      {recentNotice && <p role="alert">{recentNotice}</p>}
      {visibleRecent && <>
        <p><strong>{visibleRecent.unlinkedCount.toLocaleString()} unlinked jobs observed in the past 24 hours</strong> · Latest actual job observation: {visibleRecent.latestSourceObservedAt ? new Date(visibleRecent.latestSourceObservedAt).toLocaleString("en-GB") : "None"}</p>
        <p className="text-sm">Latest import checkpoint: {visibleRecent.latestCheckpointAt ? new Date(visibleRecent.latestCheckpointAt).toLocaleString("en-GB") : "Not established"}. A checkpoint can contain no job records; use the actual observation time above for freshness.</p>
        <p className="text-sm">Showing {Math.min(visibleRecent.rows.length, showAllRecent ? 25 : 8)} of the {visibleRecent.rows.length} most recently observed unlinked records. Review the source before linking any customer or job identity.</p>
        <div className="space-y-2">{visibleRecent.rows.slice(0, showAllRecent ? 25 : 8).map(row => <div key={row.external_id} className="min-w-0 break-words rounded-lg border border-[#e5dbe9] p-3 space-y-2">
          <p><strong>Commusoft job {row.external_id}</strong> · Recorded status: {row.source_status ?? "Unresolved"} · Observed {new Date(row.source_observed_at).toLocaleString("en-GB")}</p>
          <p className="text-sm">{SOURCE_JOB_RELATIONSHIPS[row.relationship_state]} · {SOURCE_JOB_IDENTITIES[row.customer_identity_state]}</p>
          <button className="cp-secondary max-w-full whitespace-normal text-left" aria-expanded={selectedRecent === row.external_id} onClick={() => setSelectedRecent(current => current === row.external_id ? null : row.external_id)}>{selectedRecent === row.external_id ? "Close source review" : "Review this source record"}</button>
          {selectedRecent === row.external_id && <div className="space-y-3 border-t pt-3">
            {row.version_id ? <><ReviewTaskButton db={db} tenant={tenantId} connection={connection} external={row.external_id} version={row.version_id} />
              <LearnCommusoftJobDetails tenant={tenantId} connection={connection} version={row.version_id} external={row.external_id} client={db} /></> : <p role="status">This source has conflicting latest versions. Resolve that conflict before preparing a review task.</p>}
            <div className="flex flex-wrap gap-2">
              <button className="cp-secondary max-w-full whitespace-normal text-left" onClick={() => openCapturedJob(row.external_id)}>Find this ID in captured job cards</button>
              {onReviewCustomer && row.version_id && (row.relationship_state === "customer_source_retained" || row.relationship_state === "site_customer_source_retained") && <button className="cp-secondary max-w-full whitespace-normal text-left" disabled={recentBusy} onClick={() => void reviewExactCustomer(row)}>Review customer{row.relationship_state === "site_customer_source_retained" ? ", site" : ""} and job in order</button>}
              {onReviewJob && row.version_id && <button className="cp-secondary max-w-full whitespace-normal text-left" onClick={() => onReviewJob(connection, row.external_id)}>Review job link</button>}
            </div>
          </div>}
        </div>)}</div>
        {visibleRecent.rows.length > 8 && <button className="cp-secondary max-w-full whitespace-normal text-left" aria-expanded={showAllRecent} onClick={() => setShowAllRecent(value => !value)}>{showAllRecent ? "Show fewer recent jobs" : `Show all ${visibleRecent.rows.length} recent jobs`}</button>}
      </>}
    </section>}
    {operatorReason && <button className="cp-secondary max-w-full whitespace-normal text-left" aria-expanded={browseOpen} aria-controls={browseOpen ? "captured-job-browser" : undefined} onClick={() => setBrowseOpen(value => !value)}>{browseOpen ? "Close captured-job archive" : "Browse or search all captured jobs"}</button>}
    {browseOpen && <section id="captured-job-browser" className="space-y-4" aria-label="Captured-job archive">
    <div className="flex flex-wrap gap-2" aria-label="Captured job review views">
      <button className="cp-secondary" aria-pressed={view === "all"} onClick={() => { setView("all"); setDraft(""); setQuery(""); setCursors([null]); }}>All captured jobs</button>
      <button className="cp-secondary" aria-pressed={view === "holds"} onClick={() => { setView("holds"); setDraft(""); setQuery(""); setOpenOnly(true); setCursors([null]); }}>Recorded on hold</button>
      <button className="cp-secondary" aria-pressed={view === "review"} onClick={() => { setView("review"); setDraft(""); setQuery(""); setOpenOnly(true); setCursors([null]); }}>Needs source review</button>
    </div>
    <p className="text-sm">These views prioritise saved source evidence for operator review. They do not assign a team member or confirm the provider’s current job status.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setCursors([null]); setQuery(draft.trim()); setView("all"); }}>
      <label className="min-w-0 flex-1 text-sm">Connection<select className="mt-1 block min-h-11 w-full rounded-lg border border-[#cbbada] bg-white px-3 py-2" value={connection} onChange={e => { setConnection(e.target.value); setCursors([null]); }}><option value="">Choose a connection</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="min-w-0 flex-[2] text-sm">Find captured jobs<input ref={browseSearch} type="search" className="mt-1 block min-h-11 w-full rounded-lg border border-[#cbbada] bg-white px-3 py-2" maxLength={200} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Job, customer/site reference or work description" /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={e => { setOpenOnly(e.target.checked); setCursors([null]); }} /> Open, pending and on-hold work</label>
      <button className="cp-secondary" type="submit" disabled={busy || hidden}>Find jobs</button>
    </form>
    {busy && <p role="status">Reading captured jobs…</p>}{notice && <p role="status">{notice}</p>}
    {visible && <>
      <p>{visible.counts.matching_jobs.toLocaleString()} matching jobs · {visible.counts.retained_jobs.toLocaleString()} retained in total · {visible.counts.open_jobs.toLocaleString()} recorded open/pending/on hold.</p>
      <p className="text-sm">Latest import checkpoint: {visible.latest_job_page_at ? new Date(visible.latest_job_page_at).toLocaleString("en-GB") : "Not established"}. A checkpoint can contain no job records. Check each card’s source observation for its actual age; captured history may be incomplete.</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Captured job cards">{visible.rows.map(row => <article key={`${connection}:${row.external_id}:${row.version_id}`} className="cp-card min-w-0 space-y-3">
        <h4 className="break-words font-semibold">{row.title}</h4><p>Commusoft job {row.external_id} · Recorded status: {row.source_status ?? "Unresolved"}</p>
        {row.business_unit && <p>Source business unit: {row.business_unit}</p>}
        <p>Customer/site reference: {row.property_reference ?? "Not supplied"}{row.customer_reference && ` · Customer reference: ${row.customer_reference}`}</p>
        {row.company_name && <p>Source company name: {row.company_name}</p>}{row.contact_name && <p>Source primary contact: {row.contact_name}</p>}
        <p>{SOURCE_JOB_RELATIONSHIPS[row.relationship_state]}</p><p>{SOURCE_JOB_IDENTITIES[row.customer_identity_state]}</p>
        {onReviewCustomer && customerSourceForReview(row) && row.version_id && !row.reviewed_job_id && <button className="cp-secondary" onClick={() => reviewCardCustomer(row)}>Review customer{row.relationship_state === "site_customer_source_retained" ? ", site" : ""} and job in order</button>}
        <p className="text-sm">Source observation: {new Date(row.observed_at).toLocaleString("en-GB")}. This does not verify job progress or completion.</p>
        {row.reviewed_job_id && onOpenJob ? <button className="cp-secondary" onClick={() => onOpenJob(row.reviewed_job_id!)}>Open linked job card</button> : <p className="text-sm">Communications and performance assessment are not established for this source view.</p>}
        {row.version_id && <ReviewTaskButton db={db} tenant={tenantId} connection={connection} external={row.external_id} version={row.version_id} />}
        {row.version_id && <LearnCommusoftJobDetails tenant={tenantId} connection={connection} version={row.version_id} external={row.external_id} client={db} />}
      </article>)}</div>
      {!visible.rows.length && <p>No captured jobs match this view. Clear the open-work filter to include closed work and conflicting source records.</p>}
      <div className="flex justify-between"><button className="cp-secondary" disabled={busy || cursors.length < 2} onClick={() => setCursors(v => v.slice(0, -1))}>Previous captured jobs</button><button className="cp-secondary" disabled={busy || !visible.next_after} onClick={() => visible.next_after && setCursors(v => [...v, visible.next_after])}>Next captured jobs</button></div>
    </>}
    </section>}
  </section>;
}
