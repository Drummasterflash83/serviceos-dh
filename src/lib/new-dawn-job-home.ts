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

export type OperatorHomeJob = {
  id: string;
  fields: {
    job_number: string | null;
    title: string | null;
    status: string | null;
    customer: string | null;
    address: string | null;
    postcode: string | null;
    verified: boolean;
    updated_at: string | null;
  };
};

const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function readOperatorHomePage(value: unknown, tenant: string, actor: string): OperatorHomeJob[] {
  if (!object(value) || value.version !== "new-dawn-operator-job-home/1" ||
      value.tenant_id !== tenant || value.actor_id !== actor || !uuid(value.audit_id) ||
      typeof value.observed_at !== "string" || !Number.isFinite(Date.parse(value.observed_at)) ||
      Date.parse(value.observed_at) < Date.now() - 300000 ||
      Date.parse(value.observed_at) > Date.now() + 60000 ||
      !Array.isArray(value.rows) || value.rows.length > 12) throw Error("Audited job preview unavailable");
  const keys = ["address", "customer", "job_number", "postcode", "status", "title", "updated_at", "verified"];
  for (const row of value.rows) {
    if (!object(row) || !uuid(row.id) || !object(row.fields)) throw Error("Audited job preview unavailable");
    const fields = row.fields;
    if (Object.keys(fields).sort().join() !== keys.join() ||
        !keys.filter((key) => key !== "verified").every((key) => fields[key] === null || typeof fields[key] === "string") ||
        typeof fields.verified !== "boolean") throw Error("Audited job preview unavailable");
  }
  return value.rows as OperatorHomeJob[];
}

/** Team work waits for confirmed person-to-job evidence; tenant membership alone is not assignment. */
export function canSeeCompanyJobs(role: unknown) {
  return role === "owner" || role === "admin";
}

const statuses: Record<string, string> = {
  open: "Recorded open",
  pending: "Recorded pending",
  on_hold: "Recorded on hold",
  completed: "Recorded complete",
  closed: "Recorded closed",
};

export function homeJobState(job: Pick<HomeJob, "status">) {
  return statuses[job.status ?? ""] ?? "Status needs confirmation";
}

export function homeJobAction(job: Pick<HomeJob, "status">) {
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
