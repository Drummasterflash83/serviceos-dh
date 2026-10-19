import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, RefreshCw } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { homeJobAction, homeJobState, orderHomeJobs, type HomeJob } from "@/lib/new-dawn-job-home";
import { readLearnCardDetail, type LearnCardDetail } from "@/lib/learn-cards";
import { searchOperatorJobs } from "@/lib/learn-operator-job-search";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const meaningful = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const checked = (value: string | null) =>
  value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("en-GB") : "not confirmed";

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

function JobDetail({ tenant, job }: { tenant: string; job: HomeJob }) {
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
      <h3>Next step</h3><p>{homeJobAction(job)}.</p>
      {row.gaps.length > 0 && <p>OpenFolk is checking some of this job’s details. This job is not scored yet.</p>}
      <small>Evidence checked {checked(row.observedAt)}. This is saved information, not a live provider check or a score.</small>
    </div>
  );
}

export function JobFirstHome({ tenant, operator = false, onOpenInformation }: {
  tenant: string;
  operator?: boolean;
  onOpenInformation?: () => void;
}) {
  const { user, profile } = useAuth();
  const [selected, setSelected] = useState<HomeJob | null>(null);
  const [reason, setReason] = useState("");
  const [operatorPage, setOperatorPage] = useState<Awaited<ReturnType<typeof searchOperatorJobs>> | null>(null);
  const [operatorError, setOperatorError] = useState("");
  const [operatorBusy, setOperatorBusy] = useState(false);
  const client = useQuery({
    queryKey: ["new-dawn-job-home", user?.id, tenant],
    enabled: !operator && !!user && profile?.tenant_id === tenant,
    queryFn: () => clientJobs(tenant),
    staleTime: 30_000,
  });
  const authorisedClient = !operator && !!user && profile?.tenant_id === tenant;
  async function loadOperatorJobs() {
    if (!user || reason.trim().length < 3 || operatorBusy) return;
    setOperatorBusy(true); setOperatorError(""); setOperatorPage(null);
    try {
      setOperatorPage(await searchOperatorJobs(getSupabaseClient(), {
        tenant, actor: user.id, query: "", reason: reason.trim(),
      }, AbortSignal.timeout(15000)));
    } catch { setOperatorError("Audited job preview is unavailable. Check your operator access."); }
    finally { setOperatorBusy(false); }
  }
  return (
    <section className="nd-job-home" aria-label="Jobs needing review">
      <div className="nd-job-heading">
        <div>
          <p className="of-eyebrow">YOUR WORK TODAY</p>
          <h2>Start with the jobs.</h2>
          <p>See what is recorded for each job, who it is for, and what to check next.</p>
        </div>
        {!operator && authorisedClient && <button className="cp-secondary" onClick={() => void client.refetch()}><RefreshCw size={15} /> Refresh jobs</button>}
      </div>
      {operator && <div className="nd-operator-preview">
        <strong>View as Drummonds MD · read-only preview</strong>
        <p>You remain signed in as OpenFolk. State why you are opening this company’s jobs; the server checks and logs each read.</p>
        <label>Access reason <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Review client job experience" /></label>
        <button className="cp-secondary" disabled={operatorBusy || reason.trim().length < 3} onClick={() => void loadOperatorJobs()}>{operatorBusy ? "Checking access…" : "Open audited preview"}</button>
        {operatorError && <p role="alert">{operatorError}</p>}
      </div>}
      {!operator && !authorisedClient && <p role="status">Job cards are available only in your company’s signed-in workspace.</p>}
      {!operator && authorisedClient && client.isPending && <p role="status">Reading your saved jobs…</p>}
      {!operator && authorisedClient && client.isError && <p role="alert">Saved jobs are unavailable. Refresh to try again.</p>}
      {!operator && authorisedClient && client.isSuccess && <p className="nd-job-scope">Up to 12 saved jobs: recorded open, pending or held work first, then recent other records. This is not a complete workload count or live Commusoft status.</p>}
      {operatorPage && <p className="nd-job-scope">Audited first page of {operatorPage.rows.length} published jobs, ordered by record ID. This preview is not a complete workload count or a staff login.</p>}
      {!operator && client.isSuccess && client.data.length === 0 && <p>No saved job records are visible yet. OpenFolk can check the connection and source review.</p>}
      <div className="nd-job-list">
        {!operator && authorisedClient && client.data?.map((job) => <button key={job.id} className="nd-job-row" onClick={() => setSelected(job)}>
          <BriefcaseBusiness size={20} />
          <span><strong>{job.job_number ? `Job ${job.job_number}` : job.title ?? "Job number not confirmed"}</strong><small>{job.title && job.job_number ? `${job.title} · ` : ""}{job.customer ?? "Customer not confirmed"} · {job.site ?? "Site not confirmed"}</small></span>
          <span><b>{homeJobState(job)}</b><small>{homeJobAction(job)} · {job.verified ? "details reviewed" : "details awaiting confirmation"} · saved {checked(job.updated_at)}</small></span>
          <ArrowRight size={17} />
        </button>)}
        {operatorPage?.rows.map((job) => <div key={job.id} className="nd-job-row">
          <BriefcaseBusiness size={20} />
          <span><strong>{job.fields.job_number ? `Job ${job.fields.job_number}` : job.fields.title ?? "Job number not confirmed"}</strong><small>{job.fields.title && job.fields.job_number ? `${job.fields.title} · ` : ""}{job.fields.customer ?? "Customer not confirmed"} · {job.fields.address ?? job.fields.postcode ?? "Site not confirmed"}</small></span>
          <span><b>{job.fields.status ? `Saved status: ${job.fields.status}` : "Status needs confirmation"}</b><small>Open source record for the next step</small></span>
          {onOpenInformation && <button className="cp-secondary" onClick={onOpenInformation}>Source record</button>}
        </div>)}
      </div>
      <p className="nd-job-scope">Meaningful health and performance scores will appear when source coverage, sample size and freshness support them. Not enough data yet.</p>
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="cp-dialog max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Saved job record</DialogTitle></DialogHeader>
          {selected && <JobDetail key={`${tenant}:${selected.id}`} tenant={tenant} job={selected} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
