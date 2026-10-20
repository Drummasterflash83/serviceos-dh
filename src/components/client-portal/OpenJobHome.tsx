import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { canSeeCompanyJobs } from "@/lib/new-dawn-job-home";
import { readClientJobRecord } from "@/lib/new-dawn-client-job-record";
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

function SourceJobDetail({ row, tenant, actor, reason }: {
  row: OpenJobRow; tenant: string; actor: string; reason: string | null;
}) {
  const detail = useQuery({
    queryKey: ["new-dawn-client-job-record", tenant, actor, row.connection_id,
      row.external_id, row.source_version_id, reason],
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_client_job_record", {
        p_tenant: tenant, p_connection: row.connection_id,
        p_external: row.external_id, p_version: row.source_version_id,
        p_reason: reason,
      }).abortSignal(AbortSignal.timeout(15_000));
      if (error) throw Error("Saved job detail unavailable");
      return readClientJobRecord(data, tenant, actor, row);
    },
  });
  const record = detail.data;
  const exact = record?.exactDetail;
  return <div className="nd-job-detail space-y-4">
    <div>
      <p><strong>Job {row.external_id}</strong> · {statusLabel[row.status]}</p>
      <p>Customer: {row.source_customer ?? "To confirm"} · Site: {row.source_site ?? row.source_postcode ?? "To confirm"}</p>
      <small>Commusoft record saved {savedAt(row.source_observed_at)}. The job may have changed since then.</small>
    </div>
    {detail.isPending && <p role="status">Opening the saved job record…</p>}
    {detail.isError && <p role="alert">The detailed record could not be checked. Refresh the job list; its saved summary remains available.</p>}
    {record && <>
      <section aria-label="Work and stage">
        <h3>Work and stage</h3>
        <p className="whitespace-pre-wrap break-words">{record.description ?? row.title ?? "No work description was saved."}</p>
        <p>Status: {record.status ?? statusLabel[row.status]}
          {record.priority ? ` · Priority: ${record.priority}` : ""}</p>
        <p>Stage: {exact?.stage ?? "Not enough data yet — this job's current stage has not been checked."}</p>
        {exact?.pipeline && <p>Workstream: {exact.pipeline}</p>}
      </section>
      <section aria-label="People and next step">
        <h3>People and next step</h3>
        {exact?.sourceUsers.length
          ? <p>People listed on this job: {exact.sourceUsers.map((person) => person.name).join(", ")}. We have not confirmed who is the engineer or who attended.</p>
          : <p>Engineer: not enough data yet — no verified engineer or appointment is attached to this record.</p>}
        <p>What it is waiting on: {exact?.holdReason
          ? `${exact.holdReason} (recorded reason; person responsible not yet confirmed)`
          : "not enough data yet — the status does not tell us the cause or person responsible."}</p>
        <p>Next check: {openJobNextStep(row.status)}.</p>
      </section>
      <section aria-label="Contact and visits">
        <h3>Contact and visits</h3>
        <p>Last customer contact: not enough data yet — no call, email or message has been confirmed as belonging to this job.</p>
        <p>Visits: not enough data yet — no confirmed technician appointment is attached to this job.</p>
      </section>
      {row.identity_state !== "reviewed_link" && <p>The customer and site labels come from Commusoft; OpenFolk still needs to confirm the match.</p>}
      <details><summary>Where this information came from</summary>
        <p>Commusoft job {row.external_id}, saved {savedAt(record.sourceObservedAt)}.
          {exact ? ` Exact job detail checked ${savedAt(exact.checkedAt)}.` : " No exact job detail has been checked for this saved version."}
          {exact?.providerUpdatedAt ? ` Commusoft last updated it at ${exact.providerUpdatedAt}.` : ""}
        </p>
        <p>Source people are not confirmed OpenFolk assignments. Office tasks and expected onsite times are not technician visits.</p>
        <small>Read {savedAt(record.readAt)} · Audit {record.auditId}.</small>
      </details>
    </>}
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
  const nextRecordedStatus: OpenJobStatus | null = activeSummary
    ? activeSummary.counts.on_hold > 0 ? "on_hold"
      : activeSummary.counts.pending > 0 ? "pending"
        : activeSummary.counts.open > 0 ? "open" : null
    : null;
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
          <div className="nd-score-ring" aria-label="Company score: not enough data yet">
            <span aria-hidden="true">—</span><small aria-hidden="true">/ 100</small>
          </div>
          <div className="nd-score-hero-copy">
            <p className="of-eyebrow">HOW {company?.toUpperCase() ?? "THE COMPANY"} IS DOING</p>
            <h3>Company score: not enough data yet</h3>
            <p>We can show recorded work now. A fair score still needs confirmed job progress, ownership and commercial outcomes.</p>
            {activeSummary && <>
              <p className="nd-score-source">Commusoft statuses saved as of {savedAt(activeSummary.snapshotAt)}. Counts are not performance scores.</p>
              {nextRecordedStatus ? <button className="cp-secondary" type="button"
                onClick={() => showJobs(nextRecordedStatus)}>
                {nextRecordedStatus === "on_hold" ? `Review ${activeSummary.counts.on_hold.toLocaleString("en-GB")} recorded on-hold jobs`
                  : nextRecordedStatus === "pending" ? `Review ${activeSummary.counts.pending.toLocaleString("en-GB")} recorded pending jobs`
                    : `See ${activeSummary.counts.open.toLocaleString("en-GB")} recorded open jobs`}
              </button> : <p>No open status appears in this saved snapshot; other source gaps may remain.</p>}
            </>}
          </div>
        </div>
        <div className="nd-score-tiles" aria-label="Jobs, customers and team scorecards">
          <article><span>JOBS</span><strong>Not enough data yet</strong>
            <p>{activeSummary
              ? `${activeSummary.counts.total.toLocaleString("en-GB")} jobs have a saved open status. Stage age and ownership still need confirmation before scoring.`
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
          {(["on_hold", "pending"] as const).filter((kind) => activeSummary.counts[kind] > 0).map((kind) => (
            <button key={kind} type="button" onClick={() => showJobs(kind)}>
              <span><b>{statusLabel[kind]}</b><small>{openJobNextStep(kind)}</small></span>
              <strong>{activeSummary.counts[kind].toLocaleString("en-GB")} jobs</strong>
              <ChevronRight size={17} />
            </button>
          ))}
          {activeSummary.counts.on_hold === 0 && activeSummary.counts.pending === 0 &&
            <p>No on-hold or pending statuses appear in this saved snapshot. This does not confirm that every job is progressing.</p>}
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
        <DialogHeader className="pr-10 sm:pr-0"><DialogTitle>Job details</DialogTitle></DialogHeader>
        {selected && user && <SourceJobDetail row={selected} tenant={tenant} actor={user.id}
          reason={operator ? approvedReason : null} />}
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
