import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { canSeeCompanyJobs } from "@/lib/new-dawn-job-home";
import { drummondsTenantId } from "@/lib/new-dawn-md-view";
import { jobSourceIdentity } from "@/lib/new-dawn-job-identity-label";
import { readClientJobRecord } from "@/lib/new-dawn-client-job-record";
import { inspectJobScoreEvidence } from "@/lib/new-dawn-job-score-evidence";
import { customerBlockedJobDetailKey, readCustomerBlockers, type CustomerBlockedJob } from "@/lib/new-dawn-customer-blockers";
import { dailyStatusGapState, readDailyStatusCoverage } from "@/lib/new-dawn-daily-status-coverage";
import {
  openJobNextStep, openJobPageFlagName, openJobStatusEvidence,
  readOpenJobPage, readOpenJobStatusSummary,
  type OpenJobPage, type OpenJobRow, type OpenJobStatus,
} from "@/lib/new-dawn-open-job-page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JobFirstHome } from "./JobFirstHome";

const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const savedAt = (value: string) => new Date(value).toLocaleString("en-GB");
const jobDate = (value: string) => new Date(value).toLocaleDateString("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric",
});
const statusDay = (value: string) => new Date(`${value}T00:00:00Z`)
  .toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const jobAgeDays = (created: string, snapshot: string) =>
  Math.max(0, Math.floor((Date.parse(snapshot) - Date.parse(created)) / 86_400_000));
const sourceLabel = (value: string) => value.replace(/[_-]+/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function SourceJobDetail({ row, tenant, actor, reason, operator, customerLinkOnly = false }: {
  row: OpenJobRow; tenant: string; actor: string; reason: string | null; operator: boolean;
  customerLinkOnly?: boolean;
}) {
  const scoreReviewFlag = useQuery({
    queryKey: ["new-dawn-score-readiness-flag", actor, tenant],
    enabled: operator,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", "new_dawn.score_readiness.operator_preview").maybeSingle();
      if (error) throw Error("Score readiness setting unavailable");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
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
  const sourceIdentity = jobSourceIdentity(row);
  return <div className="nd-job-detail space-y-4">
    <div>
      <p><strong>Job {row.external_id}</strong> · {statusLabel[row.status]}</p>
      {customerLinkOnly ? <p>Opened from a confirmed customer and site link. The exact saved job is checked below.</p> : <>
        <p>Commusoft customer and site: {sourceIdentity.sourceLabel}</p>
        <p className="nd-job-identity-state">{sourceIdentity.detailEvidence}</p>
      </>}
      <small>Commusoft record saved {savedAt(row.source_observed_at)}. The job may have changed since then.</small>
      {!customerLinkOnly && <>
        <p>{row.job_created_at ? `Job created in Commusoft ${jobDate(row.job_created_at)}.`
          : "Job creation date could not be verified."} This is not time spent in the current status.</p>
        <p>{openJobStatusEvidence(row, savedAt)}</p>
      </>}
    </div>
    {detail.isPending && <p role="status">Opening the saved job record…</p>}
    {detail.isError && <p role="alert">The detailed record could not be checked. Refresh the job list; its saved summary remains available.</p>}
    {record && <>
      <section aria-label="Linked customer and site">
        <h3>Linked customer and site</h3>
        {record.contactCounts ? <>
          <p>Customer: {record.linkedCustomer ?? "Name not recorded on the linked customer."}</p>
          <p>Site: {record.linkedSite ?? "Address not recorded on the linked site."}</p>
          <p>These are the saved ServiceOS links for this exact Commusoft job version.</p>
        </> : <p>{row.identity_state === "reviewed_link"
          ? "Linked customer and site details could not be verified for this read. Refresh the job before relying on the match."
          : "The exact customer and site link is awaiting review. Commusoft source details above are not a verified ServiceOS match."}</p>}
      </section>
      <section aria-label="Work and stage">
        <h3>Work and stage</h3>
        <p className="whitespace-pre-wrap break-words">{record.description ?? row.title ?? "No work description was saved."}</p>
        <p>Status: {record.status ? sourceLabel(record.status) : statusLabel[row.status]}
          {record.priority ? ` · Priority: ${sourceLabel(record.priority)}` : ""}</p>
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
        {record.contactCounts ? <p>{record.contactCounts.phone.toLocaleString("en-GB")} calls · {record.contactCounts.email.toLocaleString("en-GB")} emails confirmed as linked to this job in LEARN.
          {record.contactCounts.latestAt ? ` Latest recorded contact ${savedAt(record.contactCounts.latestAt)}.` : " No job-linked contact is retained yet."} Unlinked contact history may still exist.</p>
          : <p>Job-linked contact counts are unavailable until the exact job identity is confirmed.</p>}
        <p>Visits: not enough data yet — no confirmed technician appointment is attached to this job.</p>
      </section>
      {operator && !customerLinkOnly && scoreReviewFlag.data === true && <section className="nd-job-score-evidence"
        aria-label="OpenFolk private job score evidence review">
        <p className="of-eyebrow">OPENFOLK · PRIVATE SCORE REVIEW</p>
        <h3>What this job needs before a score</h3>
        <p>The seven proposed measures below come from the New Dawn review pack. A source fragment is not a verified measurement. This panel does not publish a score or policy.</p>
        <p>Saved source {savedAt(record.sourceObservedAt)} · audited read {savedAt(record.readAt)}.</p>
        <ol>{inspectJobScoreEvidence(row, record).map((measure) => <li key={measure.key}>
          <strong>{measure.label}</strong> <small>Proposed weight {measure.proposedWeight}/100</small>
          <p>{measure.state === "source_fragment" ? "Source fragment only" :
            measure.state === "not_yet_applicable" ? "Not assessable while open" : "Evidence missing"}
            {measure.sourceCue ? ` · ${measure.sourceCue}` : ""}</p>
          <p>Needed: {measure.missing}. Next: {measure.next}.</p>
        </li>)}</ol>
      </section>}
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
export function OpenJobHome({ tenant, company, operator = false, mdReason, mdMoney }: {
  tenant: string; company?: string; operator?: boolean; mdReason?: string;
  mdMoney?: ReactNode;
}) {
  const { user, profile } = useAuth();
  const [reason, setReason] = useState("");
  const [approvedReason, setApprovedReason] = useState<string | null>(mdReason ?? null);
  const [status, setStatus] = useState<OpenJobStatus | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [selected, setSelected] = useState<OpenJobRow | null>(null);
  const [selectedCustomerJob, setSelectedCustomerJob] = useState<CustomerBlockedJob | null>(null);
  const [showOldest, setShowOldest] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const jobsRef = useRef<HTMLDivElement>(null);
  const customersRef = useRef<HTMLElement>(null);
  const authorisedClient = !operator && !!user && profile?.tenant_id === tenant &&
    canSeeCompanyJobs(profile.role);
  const enabled = !!user && uuid(tenant) && (operator ? approvedReason !== null : authorisedClient);
  useEffect(() => {
    setApprovedReason(mdReason ?? null); setReason(""); setStatus(null); setPageIndex(0);
    setCursors([null]); setSelected(null); setSelectedCustomerJob(null); setShowOldest(false);
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
  const dailyCoverage = useQuery({
    queryKey: ["new-dawn-daily-status-coverage", tenant, user?.id, operator,
      approvedReason, refreshTick],
    enabled,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_daily_status_coverage", {
        p_tenant: tenant, p_reason: operator ? approvedReason : null,
      }).abortSignal(AbortSignal.timeout(15_000));
      if (error) throw Error("Daily job status coverage unavailable");
      return readDailyStatusCoverage(data, tenant, user!.id);
    },
  });
  const customerBlockers = useQuery({
    queryKey: ["new-dawn-customer-blockers", tenant, user?.id, operator,
      approvedReason, refreshTick],
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_customer_blockers", {
        p_tenant: tenant, p_reason: operator ? approvedReason : null,
      }).abortSignal(AbortSignal.timeout(25_000));
      if (error) throw Error("Confirmed customer jobs unavailable");
      return readCustomerBlockers(data, tenant, user!.id);
    },
  });
  // The unfiltered first page is already ordered with On-hold records first.
  // Reuse it for the ten oldest rows instead of issuing a second expensive
  // snapshot request during the initial Home load.
  const firstPage = useQuery<OpenJobPage>({
    queryKey: ["new-dawn-open-job-first-page", tenant, user?.id, operator,
      approvedReason, refreshTick],
    enabled,
    staleTime: 0,
    // A bounded retry absorbs an intermittent database/request timeout on the
    // expensive saved-source page. Never retry a malformed response.
    retry: (failures, error) => failures < 1 && error instanceof Error && error.message === "request",
    retryDelay: 500,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_open_job_page", {
        p_tenant: tenant, p_reason: operator ? approvedReason : null,
        p_cursor: null, p_status: null, p_page_size: 40,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("request");
      try { return readOpenJobPage(data, tenant, user!.id, null); }
      catch { throw Error("response"); }
    },
  });
  const additionalPage = useQuery<OpenJobPage>({
    queryKey: ["new-dawn-open-job-page", tenant, user?.id, operator,
      approvedReason, status, cursors[pageIndex], refreshTick],
    enabled: enabled && (status !== null || pageIndex > 0) && !firstPage.isFetching,
    staleTime: 0,
    retry: (failures, error) => failures < 1 && error instanceof Error && error.message === "request",
    retryDelay: 500,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_open_job_page", {
        p_tenant: tenant, p_reason: operator ? approvedReason : null,
        p_cursor: cursors[pageIndex], p_status: status, p_page_size: 40,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("request");
      try { return readOpenJobPage(data, tenant, user!.id, status); }
      catch { throw Error("response"); }
    },
  });
  const page = status === null && pageIndex === 0 ? firstPage : additionalPage;
  const active = page.data?.tenantId === tenant && page.data.actorId === user?.id
    && !page.isFetching ? page.data : null;
  const rows = active?.rows ?? [];
  const activeSummary = summary.data?.tenantId === tenant && summary.data.actorId === user?.id
    && !summary.isFetching ? summary.data : null;
  const attentionStatus: OpenJobStatus | null = activeSummary?.counts.on_hold
    ? "on_hold" : activeSummary?.counts.pending ? "pending" : null;
  const checkedDay = dailyCoverage.data?.tenantId === tenant &&
    dailyCoverage.data.actorId === user?.id && !dailyCoverage.isFetching
    ? dailyCoverage.data : null;
  const linkedCustomers = customerBlockers.data?.tenantId === tenant &&
    customerBlockers.data.actorId === user?.id && !customerBlockers.isFetching
    ? customerBlockers.data : null;
  const dailyGapState = dailyStatusGapState(checkedDay);
  const listHeading = status === null ? "All recorded open jobs" : `${statusLabel[status]} jobs`;
  const listCount = activeSummary
    ? (status === null ? activeSummary.counts.total : activeSummary.counts[status]) : null;
  const listSummary = activeSummary && listCount !== null
    ? `${listCount.toLocaleString("en-GB")} in the saved status summary checked ${savedAt(activeSummary.snapshotAt)}. `
    : "";
  const oldestHeldRows = firstPage.data?.tenantId === tenant &&
    firstPage.data.actorId === user?.id && !firstPage.isFetching &&
    firstPage.data.creationOrderAvailable
    ? firstPage.data.rows.filter((row) => row.status === "on_hold").slice(0, 10) : [];
  function changeFilter(next: OpenJobStatus | null) {
    setStatus(next); setPageIndex(0); setCursors([null]); setSelected(null);
    setSelectedCustomerJob(null);
  }
  function showJobs(next: OpenJobStatus | null) {
    changeFilter(next);
    requestAnimationFrame(() => {
      jobsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      jobsRef.current?.focus({ preventScroll: true });
    });
  }
  function nextPage() {
    if (!active?.nextCursor) return;
    setCursors((prior) => [...prior.slice(0, pageIndex + 1), active.nextCursor]);
    setPageIndex((prior) => prior + 1); setSelected(null);
  }
  function refresh() {
    setPageIndex(0); setCursors([null]); setSelected(null); setSelectedCustomerJob(null);
    setRefreshTick((tick) => tick + 1);
  }
  return <section className="nd-job-home" aria-label={`${company ?? "Company"} open jobs`}>
    <div className="nd-job-heading">
      <div>
        <p className="of-eyebrow">{company ?? "YOUR COMPANY"} · WORK</p>
        <h2>Jobs needing attention</h2>
        <p>Start with work that is On hold or Pending. Open a job to see what is recorded.</p>
      </div>
      {enabled && <button type="button" className="cp-secondary" aria-label="Refresh saved jobs"
        onClick={refresh} disabled={page.isFetching || firstPage.isFetching}>
        <RefreshCw size={15} /> Refresh list
      </button>}
    </div>
    {operator && mdReason === undefined && <div className={`nd-operator-preview${approvedReason === null ? "" : " nd-operator-preview--active"}`}>
      <strong>{approvedReason === null
        ? `${company ?? "Client"} · OpenFolk read-only MD presentation preview`
        : "OpenFolk preview · audited"}</strong>
      {approvedReason === null ? <>
        <p>You remain signed in as OpenFolk. Each source page read is checked and logged; no client staff login is used.</p>
        <label>Access reason
          <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)}
            placeholder="Review Drummonds open jobs" />
        </label>
        <button className="cp-secondary" disabled={reason.trim().length < 3}
          onClick={() => setApprovedReason(reason.trim())}>Open audited job preview</button>
      </> : <>
        <p>Access reason: {approvedReason}</p>
        <button className="cp-secondary" onClick={() => {
          setApprovedReason(null); setPageIndex(0); setCursors([null]); setSelected(null);
        }}>Change reason</button>
      </>}
    </div>}
    {!operator && !authorisedClient && <p role="status">Your work list is being prepared. Confirmed assignments are not available yet.</p>}
    {enabled && <>
      <section className="nd-score-hero nd-score-hero--pending" aria-label="Jobs needing attention">
        <div className="nd-work-count"><strong>{activeSummary
          ? (activeSummary.counts.on_hold + activeSummary.counts.pending).toLocaleString("en-GB") : "…"}</strong>
          <small>jobs to check</small></div>
        <div className="nd-score-hero-copy">
          <p className="of-eyebrow">{company ?? "YOUR COMPANY"} · TODAY</p>
          <h3>How {company ?? "your company"} is doing</h3>
          <p>{activeSummary ? `${activeSummary.counts.on_hold.toLocaleString("en-GB")} On hold · ${activeSummary.counts.pending.toLocaleString("en-GB")} Pending · ${activeSummary.counts.open.toLocaleString("en-GB")} Open.`
            : summary.isError ? "Job totals are unavailable." : "Checking workload…"}</p>
          <button type="button" onClick={() => showJobs(attentionStatus)}>
            {activeSummary?.counts.on_hold ? "Review On-hold jobs" : activeSummary?.counts.pending
              ? "Review Pending jobs" : "See all open jobs"} →</button>
          {activeSummary && <small>{activeSummary.counts.total.toLocaleString("en-GB")} open jobs in saved Commusoft records · checked {savedAt(activeSummary.snapshotAt)}</small>}
          {activeSummary?.identity && <small>{activeSummary.identity.linked.toLocaleString("en-GB")} jobs have confirmed customer and site links · {activeSummary.identity.awaitingReview.toLocaleString("en-GB")} need matching.</small>}
        </div>
      </section>
      {operator && mdReason && !summary.isPending && !firstPage.isPending && mdMoney}
      <div className="nd-score-tiles" aria-label="Jobs, customer and team overview">
        <article><span>JOBS</span><strong>{activeSummary ? `${activeSummary.counts.total.toLocaleString("en-GB")} open jobs` : "Checking workload"}</strong>
          {activeSummary && <p>{activeSummary.counts.on_hold.toLocaleString("en-GB")} On hold · {activeSummary.counts.pending.toLocaleString("en-GB")} Pending in saved Commusoft statuses.</p>}
          {activeSummary?.identity && <p>{activeSummary.identity.linked.toLocaleString("en-GB")} jobs linked to a customer and site · {activeSummary.identity.awaitingReview.toLocaleString("en-GB")} need matching.</p>}
          <p>{dailyCoverage.isError
            ? "Job score withheld: daily progress could not be checked."
            : checkedDay?.earliestMovingReviewDay
              ? `Job score withheld. Earliest evidence review ${statusDay(checkedDay.earliestMovingReviewDay)}, if daily checks continue.`
              : "Job score withheld while daily observations build."}</p>
          {activeSummary && <><button type="button" onClick={() => showJobs(attentionStatus)}>
            {attentionStatus === "on_hold" ? "Review recorded On-hold jobs"
              : attentionStatus === "pending" ? "Review recorded Pending jobs"
                : "See all recorded open jobs"} →
          </button><small>Counts checked {savedAt(activeSummary.snapshotAt)}</small></>}
        </article>
        <article><span>CUSTOMERS</span><strong>{linkedCustomers
          ? `${linkedCustomers.groups.length.toLocaleString("en-GB")} to check`
          : customerBlockers.isError ? "Customer view unavailable" : "Checking linked work"}</strong>
          <p>{linkedCustomers
            ? `${linkedCustomers.linkedBlockedJobs.toLocaleString("en-GB")} confirmed linked jobs are On hold or Pending. Other jobs may still be awaiting a customer match.`
            : "Checking which saved jobs have confirmed customer and site links."}</p>
          <p>Customer score is withheld until job measures and contact history are ready.</p>
          {linkedCustomers && <button type="button" onClick={() => customersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            See customers to check →</button>}
        </article>
        <article><span>TEAM</span><strong>Not enough data yet</strong>
          <p>Needs verified visits and owners of next actions before a team score.</p>
        </article>
      </div>
      <section className="nd-work-priority" aria-label="Review saved job statuses">
        <div><h3>What needs a check</h3>
          <p>{activeSummary
            ? `Status counts checked ${savedAt(activeSummary.snapshotAt)}.`
            : "Choose a job status below."}</p></div>
        {activeSummary && (["on_hold", "pending"] as const)
          .filter((kind) => activeSummary.counts[kind] > 0).map((kind) => (
            <button key={kind} type="button" onClick={() => showJobs(kind)}>
              <span><b>{statusLabel[kind]}</b><small>{openJobNextStep(kind)}</small></span>
              <strong>{activeSummary.counts[kind].toLocaleString("en-GB")} jobs</strong>
              <ChevronRight size={17} />
            </button>
          ))}
        {activeSummary && activeSummary.counts.on_hold === 0 && activeSummary.counts.pending === 0 &&
          <p>No on-hold or pending status appears in this snapshot. That does not confirm every job is progressing.</p>}
        {summary.isPending && <p role="status">Checking saved job status totals…</p>}
        {summary.isError && <p role="alert">Saved status totals are unavailable. The job list can still be opened.</p>}
      </section>
      <section className="nd-oldest-jobs" aria-label="Oldest On-hold jobs by creation date">
        <h3>Oldest On-hold jobs to check</h3>
        <p>These jobs were created earliest. Creation age is not time On hold or proof of urgency; office and internal jobs can appear here.</p>
        {firstPage.isPending && <p role="status">Checking the oldest recorded jobs…</p>}
        {firstPage.isError && <p role="alert">The oldest On-hold jobs could not be checked. Refresh to retry.</p>}
        {firstPage.isSuccess && oldestHeldRows.length === 0 && <p>No verified creation-order On-hold jobs are available in this saved snapshot.</p>}
        {oldestHeldRows.length > 0 && <>
          <ol>{oldestHeldRows.slice(0, showOldest ? 10 : 5).map((row) => <li key={`${row.connection_id}:${row.external_id}`}>
            <button type="button" onClick={() => setSelected(row)}>
              <strong>Job {row.external_id}</strong>
              <span>{row.title ?? "Work description not recorded"}<em>Commusoft: {jobSourceIdentity(row).sourceLabel}
                {jobSourceIdentity(row).shortEvidence ? ` · ${jobSourceIdentity(row).shortEvidence}` : ""}</em></span>
              <small>{row.job_created_at ? `Created ${jobAgeDays(row.job_created_at, firstPage.data!.snapshotAt)} days before this read` : "Creation date not verified"}<br />Source saved {savedAt(row.source_observed_at)}
                {row.status_evidence === "repeat_saved_checks" && <><br />{openJobStatusEvidence(row, savedAt)}</>}
              </small>
              <ChevronRight size={16} />
            </button>
          </li>)}</ol>
          {oldestHeldRows.length > 5 && <button type="button" className="nd-oldest-toggle"
            aria-expanded={showOldest} onClick={() => setShowOldest((shown) => !shown)}>
            {showOldest ? "Show five jobs" : "Show ten jobs"} →
          </button>}
          <button type="button" className="nd-oldest-toggle" onClick={() => showJobs("on_hold")}>See all On-hold jobs →</button>
        </>}
      </section>
      <section ref={customersRef} className="nd-customer-blockers" aria-label="Customers with linked jobs to check">
        <div className="nd-customer-blockers-heading">
          <h3>Customers with jobs to check</h3>
          <p>Confirmed customer and site links with a saved job status of On hold or Pending. The status alone does not prove why work stopped or who owns the next action.</p>
        </div>
        {customerBlockers.isPending && <p role="status">Checking linked customer jobs…</p>}
        {customerBlockers.isError && <p role="alert">Linked customer jobs could not be checked. Refresh to retry.</p>}
        {linkedCustomers && <>
          {linkedCustomers.groups.length === 0 && <p>No confirmed linked customer jobs are On hold or Pending in this snapshot. Jobs awaiting matching are not included.</p>}
          {linkedCustomers.groups.map((group) => <details key={`${group.kind}:${group.id}`}>
            <summary><span><strong>{group.name}</strong><small>{group.onHold} On hold · {group.pending} Pending</small></span>
              <ChevronRight size={17} aria-hidden="true" /></summary>
            <div className="nd-customer-blocker-jobs">{group.jobs.map((job) => <button type="button"
              key={`${job.connectionId}:${job.externalId}`}
              onClick={() => { setSelected(null); setSelectedCustomerJob(job); }}>
              <span>Job {job.externalId}</span><small>{statusLabel[job.status]} · saved {savedAt(job.sourceObservedAt)}</small>
              <ChevronRight size={16} aria-hidden="true" />
            </button>)}</div>
          </details>)}
          <small>{linkedCustomers.linkedBlockedJobs.toLocaleString("en-GB")} exactly linked jobs · checked {savedAt(linkedCustomers.snapshotAt)}. Jobs without confirmed links are excluded.</small>
        </>}
        <div className="nd-customer-blocker-all-work">
          <p>The full work list also includes jobs without a confirmed customer group.</p>
          <button type="button" onClick={() => showJobs("on_hold")}>See all On-hold jobs →</button>
          <button type="button" onClick={() => showJobs("pending")}>See all Pending jobs →</button>
        </div>
      </section>
      {operator && <details className="nd-job-context"><summary>OpenFolk source and score checks</summary>
        {tenant === drummondsTenantId && activeSummary?.identity &&
          activeSummary.identity.awaitingReview > 0 &&
          <p><a href="/openfolk/drummonds?module=information&tools=false&view=today#open-job-identity-review">
            Review {activeSummary.identity.awaitingReview.toLocaleString("en-GB")} open jobs awaiting customer or site identity in OpenFolk →
          </a></p>}
        <p>These counts use the latest saved Commusoft job statuses. On hold and Pending identify work to check; status alone does not prove urgency, the cause of a hold or who owns the next action.</p>
        {checkedDay?.day && <p>For the frozen {statusDay(checkedDay.day)} open-job roster, {checkedDay.observedCount?.toLocaleString("en-GB")}/{checkedDay.rosterCount?.toLocaleString("en-GB")} jobs were checked with Commusoft
          {dailyGapState === "pending_today" ? `; ${checkedDay.missingCount} still to check today`
            : dailyGapState === "past_gap" ? `; ${checkedDay.missingCount} had no observation that day` : ""}.
          {checkedDay.lastProviderCheckAt && ` Last check ${savedAt(checkedDay.lastProviderCheckAt)}.`}</p>}
        {dailyCoverage.isError && <p role="alert">Daily provider-check coverage is unavailable. Scores remain withheld.</p>}
        <p>Job, customer and team scores remain unpublished. A day qualifies for the Moving measure when at least 99% of its frozen open-job roster is checked; any gaps are logged. Each scored job still needs its own 14 daily observations. Customer and team measures need confirmed links and visits.</p>
      </details>}
      <div ref={jobsRef} className="nd-open-jobs-heading" tabIndex={-1} aria-live="polite">
        <h3>{listHeading}</h3>
        <p>{listSummary}
          {status === null
            ? "Browse by recorded status and open a job to see its details."
            : `These were last saved as ${statusLabel[status]}. Open a job to check its recorded stage and next step.`}
        </p>
      </div>
      <fieldset className="nd-open-page-filters">
        <legend>Show jobs by status</legend>
        {filters.map((filter) => <label key={filter.value ?? "all"}>
          <input type="radio" name={`nd-open-job-status-${tenant}-${operator ? "operator" : "client"}`}
            checked={status === filter.value} onChange={() => changeFilter(filter.value)} />
          <span>{filter.label}</span>
        </label>)}
      </fieldset>
      {page.isPending || page.isFetching ? <p role="status">Reading saved open jobs…</p> : null}
      {page.isError && <p role="alert" data-open-job-failure={
        page.error instanceof Error && ["request", "response"].includes(page.error.message)
          ? page.error.message : "unknown"
      }>Saved open jobs are unavailable. {page.error instanceof Error && page.error.message === "response"
        ? "Refresh this page to load the latest OpenFolk version."
        : "Refresh to retry."}</p>}
      {active && <>
        <p className="nd-job-scope">
          <strong>Page {pageIndex + 1} · {rows.length} jobs</strong> · Read {savedAt(active.snapshotAt)}.
          These are saved Commusoft statuses, not live progress or confirmed assignments.
          {active.nextCursor ? " More jobs follow." : " End of this saved status selection."}
        </p>
        {rows.length === 0 && <p>No uniquely retained source jobs have this saved status in this snapshot. Source gaps still need review.</p>}
        <div className="nd-job-list">
          {rows.map((row) => <button key={`${row.connection_id}:${row.external_id}`}
            type="button" className="nd-job-row" onClick={() => setSelected(row)}>
            <BriefcaseBusiness size={20} />
            <span className="nd-job-main"><strong>Job {row.external_id}</strong>
              <small>{row.title ?? "Work description not recorded"}</small>
              <small>Commusoft: {jobSourceIdentity(row).sourceLabel}</small>
              {jobSourceIdentity(row).shortEvidence &&
                <small className="nd-job-identity-state">{jobSourceIdentity(row).shortEvidence}</small>}
            </span>
            <span className="nd-job-review"><b>{statusLabel[row.status]}</b>
              <small className="nd-job-next">{openJobNextStep(row.status)}</small>
              <small>{row.job_created_at ? `Created ${jobDate(row.job_created_at)}`
                : "Creation date unverified"}</small>
              {row.status_evidence === "repeat_saved_checks" &&
                <small>{openJobStatusEvidence(row, savedAt)}</small>}
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
    <Dialog open={!!selected || !!selectedCustomerJob} onOpenChange={(open) => {
      if (!open) { setSelected(null); setSelectedCustomerJob(null); }
    }}>
      <DialogContent overlayClassName="z-[90]" className="cp-dialog z-[91] max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-10 sm:pr-0"><DialogTitle>Job details</DialogTitle></DialogHeader>
        {selected && user && <SourceJobDetail row={selected} tenant={tenant} actor={user.id}
          reason={operator ? approvedReason : null} operator={operator} />}
        {selectedCustomerJob && user && <SourceJobDetail
          row={customerBlockedJobDetailKey(selectedCustomerJob)} tenant={tenant} actor={user.id}
          reason={operator ? approvedReason : null} operator={operator} customerLinkOnly />}
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
