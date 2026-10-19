export type HomeJob = {
  id: string;
  tenant_id: string;
  job_number: string | null;
  title: string | null;
  status: string | null;
  verified: boolean;
  updated_at: string | null;
  customer: string | null;
  site: string | null;
};

const statuses: Record<string, string> = {
  open: "Recorded open",
  pending: "Recorded pending",
  on_hold: "Recorded on hold",
  completed: "Recorded complete",
  closed: "Recorded closed",
};

export function homeJobState(job: HomeJob) {
  return statuses[job.status ?? ""] ?? "Status needs confirmation";
}

export function homeJobAction(job: HomeJob) {
  if (job.status === "on_hold" || job.status === "pending") return "Check what is holding this job";
  if (job.status === "completed" || job.status === "closed") return "Review the recorded outcome";
  if (job.status === "open") return "Confirm this job’s next step";
  return "Confirm this job’s status with its source";
}

/** Attention is a review order over a bounded saved page, never a provider priority or score. */
export function orderHomeJobs(jobs: HomeJob[]) {
  const rank = (job: HomeJob) =>
    job.status === "on_hold" ? 0 : job.status === "pending" ? 1 :
    job.status === "open" ? 2 : !job.status ? 3 : 4;
  const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return [...jobs].sort((a, b) => rank(a) - rank(b) ||
    time(b.updated_at) - time(a.updated_at) || a.id.localeCompare(b.id));
}
