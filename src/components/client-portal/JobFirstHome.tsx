import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, RefreshCw } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { canSeeCompanyJobs, homeJobAction, homeJobState, orderHomeJobs, readOperatorHomePage, type HomeJob, type OperatorHomeJob } from "@/lib/new-dawn-job-home";
import { readSourceHomePage, sourceHomeFlagName, sourceJobAsHomeJob, sourceJobClientAttention, sourceJobLabel, sourceJobReviewCue, type SourceHomeJob, type SourceHomePage } from "@/lib/new-dawn-source-job-home";
import { readLearnCardDetail, type LearnCardDetail } from "@/lib/learn-cards";
import { readOperatorJobSource, type OperatorJobSource } from "@/lib/new-dawn-operator-job-source";
import { parseExactTrialOffer, readExactJobDetail, type ExactJobDetail } from "@/lib/new-dawn-exact-job-detail";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OwnerMoneyPanel } from "./OwnerMoneyPanel";
import { FounderAccountsPreview } from "./FounderAccountsPreview";
import { PublishedOwnerAccountsPanel } from "./PublishedOwnerAccountsPanel";
import { RecentSavedJobReview } from "./RecentSavedJobReview";

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const meaningful = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const checked = (value: string | null) =>
  value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("en-GB") : "not confirmed";
const missingSourceFact = (state: string) => state === "source_null" ? "blank in source"
  : state === "source_unrecognized" ? "source format needs review" : "not supplied";
const sourceTextFact = (fact: { state: string; value: string | null }) =>
  fact.state === "present" ? fact.value?.trim() ? fact.value : "blank in source"
    : missingSourceFact(fact.state);
const latestSaved = (values: Array<string | null>) => {
  const dates = values.filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
  return dates.length ? checked(dates.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest)) : "not confirmed";
};

export function useJobFirstHomeFlag(tenant: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["new-dawn-job-home-flag", user?.id, tenant],
    enabled: !!user && isUuid(tenant),
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", "new_dawn.job_first_home").maybeSingle();
      if (error) throw Error("Job home release flag unavailable.");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
}

function useSourceJobHomeFlag(tenant: string, operator: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["new-dawn-source-job-home-flag", user?.id, tenant, operator],
    enabled: !!user && isUuid(tenant),
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", sourceHomeFlagName(operator)).maybeSingle();
      if (error) throw Error("Source-backed job home flag unavailable.");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
}

async function sourceHome(tenant: string, actor: string, reason?: string): Promise<SourceHomePage> {
  const { data, error } = await getSupabaseClient().rpc("new_dawn_source_job_home", {
    p_tenant: tenant, p_reason: reason ?? null,
  }).abortSignal(AbortSignal.timeout(15_000));
  if (error) throw Error("Source-backed job home unavailable.");
  return readSourceHomePage(data, tenant, actor);
}

async function clientJobs(tenant: string): Promise<HomeJob[]> {
  const db = getSupabaseClient();
  const columns = "id,tenant_id,job_number,title,status,verified,updated_at,customer_person_id,customer_company_id,site_id";
  const [active, recent] = await Promise.all([
    db.from("jobs").select(columns).eq("tenant_id", tenant)
      .in("status", ["open", "pending", "on_hold"])
      .order("updated_at", { ascending: false }).limit(12),
    db.from("jobs").select(columns).eq("tenant_id", tenant)
      .order("updated_at", { ascending: false }).limit(12),
  ]);
  if (active.error || recent.error || !Array.isArray(active.data) || !Array.isArray(recent.data))
    throw Error("Saved jobs could not be read safely.");
  const data = [...new Map([...active.data, ...recent.data].map((row) => [row.id, row])).values()].slice(0, 12);
  if (data.some((row) => row.tenant_id !== tenant || !isUuid(row.id)))
    throw Error("Saved jobs could not be read safely.");
  const ids = (key: "customer_person_id" | "customer_company_id" | "site_id") =>
    [...new Set(data.map((row) => row[key]).filter(isUuid))];
  const related = await Promise.all([
    ids("customer_person_id").length ? db.from("people").select("id,tenant_id,display_name").eq("tenant_id", tenant).in("id", ids("customer_person_id")) : Promise.resolve({ data: [], error: null }),
    ids("customer_company_id").length ? db.from("companies").select("id,tenant_id,name").eq("tenant_id", tenant).in("id", ids("customer_company_id")) : Promise.resolve({ data: [], error: null }),
    ids("site_id").length ? db.from("sites").select("id,tenant_id,label,address_text").eq("tenant_id", tenant).in("id", ids("site_id")) : Promise.resolve({ data: [], error: null }),
  ]);
  if (related.some((part) => part.error || !Array.isArray(part.data) || part.data.some((row: any) => row.tenant_id !== tenant)))
    throw Error("Job customer or site context could not be read safely.");
  const [people, companies, sites] = related.map((part) => new Map((part.data ?? []).map((row: any) => [row.id, row])));
  return orderHomeJobs(data.map((row): HomeJob => ({
    id: row.id, tenant_id: tenant,
    job_number: meaningful(row.job_number), title: meaningful(row.title),
    status: meaningful(row.status), verified: row.verified === true,
    updated_at: meaningful(row.updated_at),
    customer: meaningful((people.get(row.customer_person_id) as any)?.display_name) ??
      meaningful((companies.get(row.customer_company_id) as any)?.name),
    site: meaningful((sites.get(row.site_id) as any)?.label) ??
      meaningful((sites.get(row.site_id) as any)?.address_text),
  })));
}

function JobDetail({ tenant, job, source }: { tenant: string; job: HomeJob; source?: SourceHomeJob }) {
  const detail = useQuery<LearnCardDetail>({
    queryKey: ["new-dawn-job-detail", tenant, job.id],
    queryFn: () => readLearnCardDetail(getSupabaseClient(), tenant, "job", job.id),
    staleTime: 30_000,
  });
  if (detail.isPending) return <p role="status">Reading saved job evidence…</p>;
  if (detail.isError || !detail.data) return <p role="alert">Job evidence is unavailable. Try again later.</p>;
  const row = detail.data;
  return (
    <div className="nd-job-detail">
      <p><strong>{row.card.jobStatus ?? "Status needs confirmation"}</strong> · {row.card.recordState}</p>
      <p>{job.customer ?? "Customer not confirmed"} · {job.site ?? "Site not confirmed"}</p>
      {!job.verified && <p>Some job details are awaiting confirmation.</p>}
      <p>Saved record updated {checked(row.card.updatedAt)}. This may lag Commusoft.</p>
      {source && <p>OpenFolk saved this job information on {checked(source.source_observed_at)}. {source.source_state === "reviewed_latest" ? "This is the newest saved record OpenFolk can confirm, but it may not reflect current Commusoft progress." : "The saved details need checking before anyone relies on this status."}</p>}
      <h3>Next step</h3><p>{source ? `${sourceJobClientAttention(source).nextStep}.` : `${homeJobAction(job)}.`}</p>
      {row.gaps.length > 0 && <p>OpenFolk is checking some of this job’s details. This job is not scored yet.</p>}
      <small>Evidence checked {checked(row.observedAt)}. This is saved information, not a live provider check or a score.</small>
    </div>
  );
}

function OperatorJobDetail({ tenant, actor, reason, job }: {
  tenant: string; actor: string; reason: string; job: OperatorHomeJob;
}) {
  const [source, setSource] = useState<OperatorJobSource | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<ExactJobDetail | null>(null);
  const [freshBusy, setFreshBusy] = useState(false);
  const [freshError, setFreshError] = useState("");
  const detail = source?.source;
  const trialOffer = useQuery({
    queryKey: ["new-dawn-exact-job-trial-offer", actor, tenant, job.id, detail?.version_id],
    enabled: detail?.current === true,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_commusoft_job_trial_offer", {
        p_tenant: tenant, p_job: job.id,
      }).abortSignal(AbortSignal.timeout(15_000));
      if (error) throw Error("Exact job trial offer unavailable.");
      return parseExactTrialOffer(data, { tenant, job: job.id, actor,
        sourceVersion: detail!.version_id, externalId: detail!.external_id });
    },
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    let active = true;
    setSource(null); setBusy(true); setError(""); setFresh(null); setFreshError("");
    void readOperatorJobSource(getSupabaseClient(), tenant, actor, job.id, reason)
      .then((value) => { if (active) setSource(value); })
      .catch(() => { if (active) setError("The audited source read is unavailable. Reopen this job to retry."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [tenant, actor, job.id, reason]);
  async function checkCurrentDetail() {
    if (!detail?.current || !trialOffer.data || freshBusy ||
      Date.parse(trialOffer.data.expiresAt) <= Date.now()) return;
    setFreshBusy(true); setFreshError(""); setFresh(null);
    try {
      setFresh(await readExactJobDetail(getSupabaseClient(), tenant, job.id,
        detail.version_id, detail.external_id, reason, trialOffer.data.requestId));
    } catch { setFreshError("The permitted check has not completed. If Commusoft is busy, retry this same check before the permit expires; saved evidence remains above."); }
    finally { setFreshBusy(false); }
  }
  return <div className="nd-job-detail space-y-3">
    <p><strong>{job.fields.job_number ? `Job ${job.fields.job_number}` : job.fields.title ?? "Saved job"}</strong> · {homeJobState({ status: job.fields.status })}</p>
    <p>{job.fields.customer ?? "Customer not confirmed"} · {job.fields.address ?? job.fields.postcode ?? "Site not confirmed"}</p>
    <p>Next review: {"source_observed_at" in job
      ? sourceJobReviewCue(job as SourceHomeJob).label
      : homeJobAction({ status: job.fields.status })}. An assigned person is not verified in OpenFolk.</p>
    <p>Saved card updated {checked(job.fields.updated_at)}. The saved card can lag its Commusoft source.</p>
    {busy && <p role="status">Checking this job’s reviewed source link…</p>}
    {error && <p role="alert">{error}</p>}
    {source?.state === "unlinked" && <p role="status">This saved job has no reviewed Commusoft source link. OpenFolk must verify its identity before source details can appear here.</p>}
    {source?.state === "review_required" && <p role="status">The saved job and reviewed source link differ or conflict. OpenFolk must review the link before source details can appear here.</p>}
    {detail && <section aria-label={`Commusoft source job ${detail.external_id}`} className="space-y-2">
      <h3>Commusoft source job {detail.external_id}</h3>
      <p>Selected reviewed version observed {checked(detail.observed_at)}. {detail.current ? "This is the latest unambiguous retained version." : "A newer or ambiguous source version exists; this saved card may need review."}</p>
      <dl>
        {(["description", "status", "priority", "customerReference", "customerContactName", "siteContactName", "quotedAmount", "completedBySourceUser", "closedOutcome"] as const)
          .filter((key) => detail.fields[key].value)
          .map((key) => <div key={key}><dt><strong>{({ description: "Work", status: "Recorded source status", priority: "Source priority", customerReference: "Customer reference", customerContactName: "Customer contact", siteContactName: "Site contact", quotedAmount: "Quoted amount (source text)", completedBySourceUser: "Completed by (source user)", closedOutcome: "Closure outcome" } as const)[key]}</strong></dt>
            <dd className="whitespace-pre-wrap break-words">{detail.fields[key].value}{detail.fields[key].shortened && " [excerpt shortened]"}</dd></div>)}
      </dl>
      <p>Reported: {detail.dates.reported.source ?? "not provided"} · Completed: {detail.dates.completed.source ?? "not provided"}</p>
      {(detail.dates.reported.state === "timezone_required" || detail.dates.completed.state === "timezone_required") && <p>One or more source times have no timezone; no elapsed duration has been inferred.</p>}
      <p className="text-sm">A source completion name is not a verified engineer visit. The quote is not an invoice or paid value. Diary, parts and costs are not captured in this job record.</p>
      {detail.current && trialOffer.data && <button className="cp-secondary" disabled={freshBusy || Date.parse(trialOffer.data.expiresAt) <= Date.now()} onClick={() => void checkCurrentDetail()}>
        {freshBusy ? "Checking Commusoft…" : "Check current Commusoft job details"}
      </button>}
      {freshError && <p role="alert">{freshError}</p>}
      {fresh && <section aria-label="Fresh Commusoft job detail" className="space-y-2">
        <h3>Current source detail · checked {checked(fresh.checkedAt)}</h3>
        <p>Exact Commusoft job {fresh.externalId}; read only. Its source version is linked to this saved job. The saved card has not been rewritten.</p>
        {fresh.status && <p>Source status: {fresh.status}</p>}
        {fresh.pipeline && <p>Source pipeline: {fresh.pipeline}</p>}
        {fresh.stage && <p>Source stage: {fresh.stage}</p>}
        {fresh.expectedOnsite && <p>Expected onsite (source text): {fresh.expectedOnsite}</p>}
        {fresh.expectedCompletion && <p>Expected completion (source text): {fresh.expectedCompletion}</p>}
        {fresh.sourceQuotedAmount && <p>Current job quote (Commusoft source text): {sourceTextFact(fresh.sourceQuotedAmount)}. No currency, acceptance or estimate document is verified by this field.</p>}
        {fresh.sourceClosureFacts && <div className="space-y-1" aria-label="Source closure facts">
          <p><strong>Job closure · Commusoft source</strong></p>
          <p>Closure outcome: {sourceTextFact(fresh.sourceClosureFacts.closedOutcome)}.</p>
          <p>Closure time (source text): {sourceTextFact(fresh.sourceClosureFacts.closedOnDateTime)}.</p>
          {fresh.sourceClosureFacts.focReason.state === "present" &&
            <p>Free-of-charge reason (source text): {fresh.sourceClosureFacts.focReason.value}.</p>}
          <p>This does not verify an invoice, payment, job cost or a completed visit.</p>
        </div>}
        {fresh.sourceUsers.length > 0 && <p>Source users currently listed: {fresh.sourceUsers.map((user) => user.name).join(", ")}. Their OpenFolk identities and appointments are not confirmed.</p>}
        {fresh.sourceOperationalFacts && <div className="space-y-1" aria-label="Source operational facts">
          <p><strong>Job holds and service level · Commusoft source</strong></p>
          <p>On hold: {fresh.sourceOperationalFacts.isJobOnHold.state === "present"
            ? fresh.sourceOperationalFacts.isJobOnHold.value ? "Yes" : "No"
            : missingSourceFact(fresh.sourceOperationalFacts.isJobOnHold.state)}.</p>
          <p>Hold reason: {sourceTextFact(fresh.sourceOperationalFacts.onHoldReasonDescription)}.</p>
          <p>SLA recorded: {fresh.sourceOperationalFacts.hasSLA.state === "present"
            ? fresh.sourceOperationalFacts.hasSLA.value ? "Yes" : "No"
            : missingSourceFact(fresh.sourceOperationalFacts.hasSLA.state)}.
            {" "}Source SLA status: {sourceTextFact(fresh.sourceOperationalFacts.SLAStatus)}.</p>
          <p>Source contract ID: {sourceTextFact(fresh.sourceOperationalFacts.contractID)}.
            {" "}This does not verify a maintenance contract in OpenFolk.</p>
        </div>}
        <small>Provider last updated: {fresh.providerUpdatedAt ?? "not supplied"}. Expected dates are not verified visits. Audit {fresh.auditId}.</small>
      </section>}
    </section>}
    {!busy && !source && !error && <p role="status">Saved source evidence is unavailable.</p>}
  </div>;
}

export function JobFirstHome({ tenant, operator = false, onOpenInformation }: {
  tenant: string;
  operator?: boolean;
  onOpenInformation?: () => void;
}) {
  const { user, profile } = useAuth();
  const [selected, setSelected] = useState<HomeJob | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<OperatorHomeJob | null>(null);
  const [reason, setReason] = useState("");
  const [operatorPage, setOperatorPage] = useState<OperatorHomeJob[] | null>(null);
  const [operatorSourcePage, setOperatorSourcePage] = useState<SourceHomePage | null>(null);
  const [operatorError, setOperatorError] = useState("");
  const [operatorBusy, setOperatorBusy] = useState(false);
  useEffect(() => { setSelected(null); setSelectedOperator(null); setOperatorPage(null); setOperatorSourcePage(null); }, [tenant, user?.id]);
  const sourceFlag = useSourceJobHomeFlag(tenant, operator);
  const authorisedClient = !operator && !!user && profile?.tenant_id === tenant && canSeeCompanyJobs(profile.role);
  const client = useQuery({
    queryKey: ["new-dawn-job-home", user?.id, tenant],
    enabled: authorisedClient && sourceFlag.isSuccess && sourceFlag.data === false,
    queryFn: () => clientJobs(tenant),
    staleTime: 30_000,
  });
  const clientSource = useQuery({
    queryKey: ["new-dawn-source-job-home", user?.id, tenant],
    enabled: authorisedClient && sourceFlag.data === true,
    queryFn: () => sourceHome(tenant, user!.id),
    staleTime: 30_000,
  });
  const sourceJobs = clientSource.data?.jobs.map((row) => ({ job: sourceJobAsHomeJob(row, tenant), source: row })) ?? [];
  const displayedOperatorJobs = operatorSourcePage?.jobs ?? operatorPage;
  const sourceReviewCounts = operatorSourcePage?.jobs.reduce((counts, job) => {
    counts[sourceJobReviewCue(job).kind] += 1;
    return counts;
  }, { link_review: 0, aged_observation: 0, recent_observation: 0 }) ?? null;
  async function loadOperatorJobs() {
    if (!user || !sourceFlag.isSuccess || reason.trim().length < 3 || operatorBusy) return;
    setOperatorBusy(true); setOperatorError(""); setOperatorPage(null); setOperatorSourcePage(null);
    try {
      if (sourceFlag.data === true) setOperatorSourcePage(await sourceHome(tenant, user.id, reason.trim()));
      else {
        const { data, error } = await getSupabaseClient().rpc("new_dawn_operator_job_home", {
          p_tenant: tenant, p_reason: reason.trim(),
        }).abortSignal(AbortSignal.timeout(15000));
        if (error) throw Error("Audited job preview unavailable");
        setOperatorPage(readOperatorHomePage(data, tenant, user.id));
      }
    } catch { setOperatorError("Audited job preview is unavailable. Check your operator access."); }
    finally { setOperatorBusy(false); }
  }
  return (
    <>
    <section className="nd-job-home" aria-label="Jobs needing review">
      <div className="nd-job-heading">
        <div>
          <p className="of-eyebrow">JOB OVERVIEW</p>
          <h2>Jobs to review</h2>
          <p>Start with the work that may need a decision.</p>
        </div>
        {!operator && authorisedClient && <button className="cp-secondary" onClick={() => void (sourceFlag.data ? clientSource.refetch() : client.refetch())}><RefreshCw size={15} /> Refresh jobs</button>}
        {operator && onOpenInformation && <button className="cp-secondary" onClick={onOpenInformation}>Browse captured source jobs</button>}
      </div>
      {operator && <div className={`nd-operator-preview${displayedOperatorJobs ? " nd-operator-preview--active" : ""}`}>
        <strong>{displayedOperatorJobs ? "Drummonds job home · OpenFolk read-only preview" : "Review Drummonds job home · OpenFolk read-only"}</strong>
        {displayedOperatorJobs ? <>
          <p>You are still signed in as OpenFolk. This job read was logged.</p>
          <button className="cp-secondary" onClick={() => { setSelectedOperator(null); setOperatorPage(null); setOperatorSourcePage(null); }}>Change access reason</button>
        </> : <>
          <p>You remain signed in as OpenFolk. State why you are opening this company’s jobs; the server checks and logs each read.</p>
          <label>Access reason <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Review client job experience" /></label>
          <button className="cp-secondary" disabled={!sourceFlag.isSuccess || operatorBusy || reason.trim().length < 3} onClick={() => void loadOperatorJobs()}>{operatorBusy ? "Checking access…" : "Open audited preview"}</button>
          {sourceFlag.isError && <p role="alert">Job release settings are unavailable. Try again later.</p>}
          {operatorError && <p role="alert">{operatorError}</p>}
        </>}
      </div>}
      {!operator && !authorisedClient && <p role="status">Your personal work list is being prepared. It will appear when job assignments are confirmed.</p>}
      {!operator && authorisedClient && (sourceFlag.isPending || (sourceFlag.data ? clientSource.isPending : client.isPending)) && <p role="status">Reading your saved jobs…</p>}
      {!operator && authorisedClient && (sourceFlag.isError || client.isError || clientSource.isError) && <p role="alert">Saved jobs are unavailable. Refresh to try again.</p>}
      {!operator && authorisedClient && client.isSuccess && <div className="nd-job-scope">
        <strong>{client.data.length} saved jobs shown</strong> · Latest saved {latestSaved(client.data.map((job) => job.updated_at))}
        <details><summary>About this view</summary><p>This is a limited saved selection, not a complete workload or live Commusoft status. Recorded on-hold, pending and open work leads; other recent jobs follow. Job ownership is not verified yet.</p></details>
      </div>}
      {!operator && clientSource.isSuccess && <div className="nd-job-scope">
        <strong>{sourceJobs.length} saved jobs shown</strong> · Most recently saved {latestSaved(clientSource.data.jobs.map((job) => job.source_observed_at))}
        <details><summary>About this view</summary><p>This is a limited selection from {clientSource.data.reviewedJobCount} jobs that OpenFolk has matched to saved Commusoft records. It is not the full workload or a live Commusoft check. Other jobs may be absent while their records are checked. Job ownership and scores are not confirmed.</p></details>
      </div>}
      {displayedOperatorJobs && <div className="nd-job-scope">
        <strong>{displayedOperatorJobs.length} saved jobs shown{operatorSourcePage ? ` from ${operatorSourcePage.reviewedJobCount} linked records` : ""}</strong> · {operatorSourcePage ? "Latest observation among shown jobs" : "Latest saved"} {latestSaved(operatorSourcePage ? operatorSourcePage.jobs.map((job) => job.source_observed_at) : displayedOperatorJobs.map((job) => job.fields.updated_at))}
        {sourceReviewCounts && <p role="status">In this saved selection: {sourceReviewCounts.link_review} source versions or links need review · {sourceReviewCounts.aged_observation} job observations over 24 hours old · {sourceReviewCounts.recent_observation} recently captured. None confirms current Commusoft progress.</p>}
        <details><summary>About this view</summary><p>This audited preview is a limited saved selection, not the full current workload or a staff login. Job cards can lag Commusoft; ownership and next actions still need source review.</p></details>
      </div>}
      {!operator && client.isSuccess && client.data.length === 0 && <p>No saved job records are visible yet. OpenFolk can check the connection and source review.</p>}
      {!operator && clientSource.isSuccess && sourceJobs.length === 0 && <p>No confirmed job records are visible yet. OpenFolk can check the saved jobs.</p>}
      <div className="nd-job-list">
        {!operator && authorisedClient && client.data?.map((job) => <button key={job.id} className="nd-job-row" onClick={() => setSelected(job)}>
          <BriefcaseBusiness size={20} />
          <span className="nd-job-main"><strong>{job.job_number ? `Job ${job.job_number}` : job.title ?? "Job number not confirmed"}</strong><small>{job.title && job.job_number ? `${job.title} · ` : ""}{job.customer ?? "Customer not confirmed"} · {job.site ?? "Site not confirmed"}</small></span>
          <span className="nd-job-review"><b>{homeJobState(job)}</b><small>{homeJobAction(job)} · Assignee unconfirmed</small></span>
          <ArrowRight size={17} />
        </button>)}
        {!operator && sourceJobs.map(({ job, source }) => <button key={job.id} className="nd-job-row" onClick={() => setSelected(job)}>
          <BriefcaseBusiness size={20} />
          <span className="nd-job-main"><strong>{job.job_number ? `Job ${job.job_number}` : job.title ?? "Job number not confirmed"}</strong><small>{job.customer ?? "Customer not confirmed"} · {job.site ?? "Site not confirmed"}</small></span>
          <span className="nd-job-review"><b>{sourceJobClientAttention(source).label}</b><small>{homeJobState(job)} · {sourceJobClientAttention(source).nextStep} · Saved {checked(source.source_observed_at)} · Next owner not confirmed</small></span>
          <ArrowRight size={17} />
        </button>)}
        {displayedOperatorJobs?.map((job) => <div key={job.id} className="nd-job-row">
          <BriefcaseBusiness size={20} />
          <span className="nd-job-main"><strong>{job.fields.job_number ? `Job ${job.fields.job_number}` : job.fields.title ?? "Job number not confirmed"}</strong><small>{job.fields.title && job.fields.job_number ? `${job.fields.title} · ` : ""}{job.fields.customer ?? "Customer not confirmed"} · {job.fields.address ?? job.fields.postcode ?? "Site not confirmed"}</small></span>
          <span className="nd-job-review"><b>{homeJobState({ status: job.fields.status })}</b><small>{operatorSourcePage ? `${sourceJobReviewCue(job as SourceHomeJob).label} · ${sourceJobLabel(job as SourceHomeJob)} · Captured ${checked((job as SourceHomeJob).source_observed_at)}` : homeJobAction({ status: job.fields.status })} · Assignee unconfirmed</small></span>
          <button className="cp-secondary" onClick={() => setSelectedOperator(job)}>Open this job</button>
        </div>)}
      </div>
      {operator && operatorSourcePage && user && <RecentSavedJobReview
        key={`${tenant}:${user.id}:${reason}`}
        tenant={tenant} actor={user.id} reason={reason.trim()}
        onOpenInformation={onOpenInformation} />}
      <p className="nd-job-scope">Performance scores: not enough data yet.</p>
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="cp-dialog max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Saved job record</DialogTitle></DialogHeader>
          {selected && <JobDetail key={`${tenant}:${selected.id}`} tenant={tenant} job={selected}
            source={clientSource.data?.jobs.find((row) => row.id === selected.id)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!selectedOperator} onOpenChange={(open) => { if (!open) setSelectedOperator(null); }}>
        <DialogContent className="cp-dialog max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Saved job and source</DialogTitle></DialogHeader>
          {selectedOperator && user && <OperatorJobDetail key={`${tenant}:${selectedOperator.id}`} tenant={tenant} actor={user.id} reason={reason} job={selectedOperator} />}
        </DialogContent>
      </Dialog>
    </section>
    <PublishedOwnerAccountsPanel tenant={tenant} operator={operator} />
    <OwnerMoneyPanel tenant={tenant} operator={operator} operatorReason={reason} />
    {operator && <FounderAccountsPreview tenant={tenant} operator={operator}
      jobPreviewOpened={!!displayedOperatorJobs} reason={reason} />}
    </>
  );
}
