import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { canSeeCompanyJobs } from "@/lib/new-dawn-job-home";
import {
  openJobNextStep, openJobPageFlagName, readOpenJobPage, readOpenJobStatusSummary,
  type OpenJobPage, type OpenJobRow, type OpenJobStatus,
} from "@/lib/new-dawn-open-job-page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JobFirstHome } from "./JobFirstHome";

const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const savedAt = (value: string) => new Date(value).toLocaleString("en-GB");
const filters: Array<{ value: OpenJobStatus | null; label: string }> = [
  { value: null, label: "All recorded open" },
  { value: "on_hold", label: "On hold" },
  { value: "pending", label: "Pending" },
  { value: "open", label: "Open" },
];
const statusLabel: Record<OpenJobStatus, string> = {
  on_hold: "On hold", pending: "Pending", open: "Open",
};

export function useOpenJobPageFlag(tenant: string, operator: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["new-dawn-open-job-page-flag", user?.id, tenant, operator],
    enabled: !!user && uuid(tenant),
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", openJobPageFlagName(operator)).maybeSingle();
      if (error) throw Error("Open job release setting unavailable");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
}

function SourceJobDetail({ row }: { row: OpenJobRow }) {
  return <div className="nd-job-detail">
    <p><strong>Commusoft job {row.external_id}</strong> · Saved status {statusLabel[row.status]}</p>
    <p>{row.title ?? "Work description not recorded in this view"}</p>
    <p>Source customer: {row.source_customer ?? "not identified"} · Source site: {row.source_site ?? row.source_postcode ?? "not identified"}</p>
    <p>{row.identity_state === "reviewed_link"
      ? "OpenFolk has a reviewed job link for this saved version."
      : "The source job has not been linked to a confirmed OpenFolk customer and site. Its source labels need review."}</p>
    <p>Last observed by OpenFolk {savedAt(row.source_observed_at)}. This is not a current Commusoft check or a confirmed assignment.</p>
    <h3>Next useful check</h3><p>{openJobNextStep(row.status)}.</p>
  </div>;
}

/** Source-first job list: all uniquely retained open jobs are reachable by page. */
export function OpenJobHome({ tenant, company, operator = false, mdReason }: {
  tenant: string; company?: string; operator?: boolean; mdReason?: string;
}) {
  const { user, profile } = useAuth();
  const [reason, setReason] = useState("");
  const [approvedReason, setApprovedReason] = useState<string | null>(mdReason ?? null);
  const [status, setStatus] = useState<OpenJobStatus | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [selected, setSelected] = useState<OpenJobRow | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const jobsRef = useRef<HTMLDivElement>(null);
  const authorisedClient = !operator && !!user && profile?.tenant_id === tenant &&
    canSeeCompanyJobs(profile.role);
  const enabled = !!user && uuid(tenant) && (operator ? approvedReason !== null : authorisedClient);
  useEffect(() => {
    setApprovedReason(mdReason ?? null); setReason(""); setStatus(null); setPageIndex(0);
    setCursors([null]); setSelected(null);
  }, [tenant, user?.id, operator, mdReason]);
  const summary = useQuery({
    queryKey: ["new-dawn-open-job-status-summary", tenant, user?.id, operator,
      approvedReason, refreshTick],
    enabled,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_open_job_status_summary", {
        p_tenant: tenant, p_reason: operator ? approvedReason : null,
      }).abortSignal(AbortSignal.timeout(25_000));
      if (error) throw Error("Open job status summary unavailable");
      return readOpenJobStatusSummary(data, tenant, user!.id);
    },
  });
  const page = useQuery<OpenJobPage>({
    queryKey: ["new-dawn-open-job-page", tenant, user?.id, operator,
      approvedReason, status, cursors[pageIndex], refreshTick],
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_open_job_page", {
        p_tenant: tenant, p_reason: operator ? approvedReason : null,
        p_cursor: cursors[pageIndex], p_status: status, p_page_size: 40,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Open job page unavailable");
      return readOpenJobPage(data, tenant, user!.id, status);
    },
  });
  const active = page.data?.tenantId === tenant && page.data.actorId === user?.id
    && !page.isFetching ? page.data : null;
  const rows = active?.rows ?? [];
  const activeSummary = summary.data?.tenantId === tenant && summary.data.actorId === user?.id
    && !summary.isFetching ? summary.data : null;
  function changeFilter(next: OpenJobStatus | null) {
    setStatus(next); setPageIndex(0); setCursors([null]); setSelected(null);
  }
  function showJobs(next: OpenJobStatus | null) {
    changeFilter(next);
    requestAnimationFrame(() => jobsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function nextPage() {
    if (!active?.nextCursor) return;
    setCursors((prior) => [...prior.slice(0, pageIndex + 1), active.nextCursor]);
    setPageIndex((prior) => prior + 1); setSelected(null);
  }
  function refresh() {
    setPageIndex(0); setCursors([null]); setSelected(null);
    setRefreshTick((tick) => tick + 1);
  }
  return <section className="nd-job-home" aria-label="Company scorecard and recorded open jobs">
    <div className="nd-job-heading">
      <div>
        <p className="of-eyebrow">YOUR COMPANY</p>
        <h2>At a glance</h2>
        <p>Start with the work that may need attention.</p>
      </div>
      {enabled && <button className="cp-secondary" onClick={refresh} disabled={page.isFetching}>
        <RefreshCw size={15} /> Refresh saved jobs
      </button>}
    </div>
    {operator && mdReason === undefined && <div className="nd-operator-preview">
      <strong>{company ?? "Client"} · OpenFolk read-only MD presentation preview</strong>
      <p>You remain signed in as OpenFolk. Each source page read is checked and logged; no client staff login is used.</p>
      {approvedReason === null ? <>
        <label>Access reason
          <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)}
            placeholder="Review Drummonds open jobs" />
        </label>
        <button className="cp-secondary" disabled={reason.trim().length < 3}
          onClick={() => setApprovedReason(reason.trim())}>Open audited job preview</button>
      </> : <button className="cp-secondary" onClick={() => {
        setApprovedReason(null); setPageIndex(0); setCursors([null]); setSelected(null);
      }}>Change access reason</button>}
    </div>}
    {!operator && !authorisedClient && <p role="status">Your work list is being prepared. Confirmed assignments are not available yet.</p>}
    {enabled && <>
      <section className="nd-score-home" aria-label="Company scorecard">
        <div className="nd-score-hero">
          <p className="of-eyebrow">HOW {company?.toUpperCase() ?? "THE COMPANY"} IS DOING</p>
          <h3>Not enough data yet</h3>
          <p>A company score needs confirmed job progress, commercial outcomes and ownership. Saved job status alone cannot provide a fair score.</p>
          {activeSummary && <button className="cp-secondary" type="button" onClick={() => showJobs(null)}>
            See recorded open jobs
          </button>}
        </div>
        <div className="nd-score-tiles" aria-label="Jobs, customers and team scorecards">
          <article><span>JOBS</span><strong>Not enough data yet</strong>
            <p>{activeSummary
              ? `${activeSummary.counts.total.toLocaleString("en-GB")} jobs have a saved open status; stage age and ownership still need confirmation.`
              : "Checking recorded open jobs; stage age and ownership still need confirmation."}</p>
            {activeSummary && <button type="button" onClick={() => showJobs(null)}>See open jobs →</button>}
          </article>
          <article><span>CUSTOMERS</span><strong>Not enough data yet</strong>
            <p>Customer and site links need review before job outcomes can show customer health.</p>
          </article>
          <article><span>TEAM</span><strong>Not enough data yet</strong>
            <p>Confirmed assignments and worked hours are needed before a team score is fair.</p>
          </article>
        </div>
        {summary.isPending && <p role="status">Checking saved job status totals…</p>}
        {summary.isError && <p role="alert">Saved status totals are unavailable. The job list can still be opened.</p>}
        {activeSummary && <div className="nd-score-bottlenecks">
          <div><h3>Where work may be held up</h3>
            <p>Commusoft statuses saved by OpenFolk as of {savedAt(activeSummary.snapshotAt)}. These counts do not identify the person or cause yet.</p></div>
          {(["on_hold", "pending", "open"] as const).filter((kind) => activeSummary.counts[kind] > 0).map((kind) => (
            <button key={kind} type="button" onClick={() => showJobs(kind)}>
              <span><b>{statusLabel[kind]}</b><small>{openJobNextStep(kind)}</small></span>
              <strong>{activeSummary.counts[kind].toLocaleString("en-GB")} jobs</strong>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>}
      </section>
      <div ref={jobsRef} className="nd-open-jobs-heading">
        <h3>Recorded open jobs</h3>
        <p>Source statuses saved from Commusoft. Open a job to see its recorded details and next check.</p>
      </div>
      <div className="nd-open-page-filters" aria-label="Filter saved job status">
        {filters.map((filter) => <button key={filter.value ?? "all"}
          type="button" aria-pressed={status === filter.value}
          onClick={() => changeFilter(filter.value)}>{filter.label}</button>)}
      </div>
      {page.isPending || page.isFetching ? <p role="status">Reading saved open jobs…</p> : null}
      {page.isError && <p role="alert">Saved open jobs are unavailable. Refresh to retry.</p>}
      {active && <>
        <p className="nd-job-scope">
          <strong>Page {pageIndex + 1} · {rows.length} jobs</strong> · Source snapshot {savedAt(active.snapshotAt)}.
          These are saved Commusoft statuses, not live progress or confirmed assignments.
          {active.nextCursor ? " More jobs follow." : " End of this saved status selection."}
        </p>
        {rows.length === 0 && <p>No uniquely retained source jobs have this saved status in this snapshot. Source gaps still need review.</p>}
        <div className="nd-job-list">
          {rows.map((row) => <button key={`${row.connection_id}:${row.external_id}`}
            type="button" className="nd-job-row" onClick={() => setSelected(row)}>
            <BriefcaseBusiness size={20} />
            <span className="nd-job-main"><strong>Commusoft job {row.external_id}</strong>
              <small>{row.title ?? "Work description not recorded"}</small>
              <small>Source customer: {row.source_customer ?? "not identified"} · Site: {row.source_site ?? row.source_postcode ?? "not identified"}</small>
            </span>
            <span className="nd-job-review"><b>{statusLabel[row.status]}</b>
              <small>{row.identity_state === "reviewed_link" ? "Job link reviewed" : "Customer and site link awaiting review"}</small>
              <small>Saved {savedAt(row.source_observed_at)} · Owner not confirmed</small>
              <small className="nd-job-next">Next: {openJobNextStep(row.status)}</small>
            </span>
            <ChevronRight size={17} />
          </button>)}
        </div>
        <nav className="nd-open-page-controls" aria-label="Open job pages">
          <button className="cp-secondary" disabled={pageIndex === 0}
            onClick={() => { setPageIndex(pageIndex - 1); setSelected(null); }}>
            <ChevronLeft size={16} /> Previous page
          </button>
          <span>Page {pageIndex + 1}</span>
          <button className="cp-secondary" disabled={!active.nextCursor}
            onClick={nextPage}>Next page <ChevronRight size={16} /></button>
        </nav>
      </>}
    </>}
    <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <DialogContent overlayClassName="z-[90]" className="cp-dialog z-[91] max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-10 sm:pr-0"><DialogTitle>Saved Commusoft job</DialogTitle></DialogHeader>
        {selected && <SourceJobDetail row={selected} />}
      </DialogContent>
    </Dialog>
  </section>;
}

/** Keep the existing audited reviewed-card and source-detail routes reachable. */
export function OpenJobHomeWithEvidence({ tenant, company, operator = false, onOpenInformation }: {
  tenant: string; company?: string; operator?: boolean;
  onOpenInformation?: () => void;
}) {
  const [showReviewed, setShowReviewed] = useState(false);
  useEffect(() => setShowReviewed(false), [tenant, operator]);
  return <>
    <OpenJobHome tenant={tenant} company={company} operator={operator} />
    <div className="nd-open-reviewed-route">
      <button className="cp-secondary" type="button" aria-expanded={showReviewed}
        onClick={() => setShowReviewed((open) => !open)}>
        {showReviewed ? "Close reviewed job details" : "Open reviewed job details and evidence"}
      </button>
      {showReviewed && <JobFirstHome tenant={tenant} company={company} operator={operator}
        presentationFirst={operator} onOpenInformation={onOpenInformation} />}
    </div>
  </>;
}
