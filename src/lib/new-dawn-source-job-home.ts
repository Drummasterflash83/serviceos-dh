import { homeJobAction, type HomeJob, type OperatorHomeJob } from "./new-dawn-job-home.ts";

export type SourceHomeState = "reviewed_latest" | "source_changed" | "source_ambiguous";
export type SourceHomeJob = OperatorHomeJob & {
  source_state: SourceHomeState;
  source_observed_at: string;
};
export type SourceHomePage = {
  tenantId: string;
  actorId: string;
  auditId: string;
  observedAt: string;
  reviewedJobCount: number;
  jobs: SourceHomeJob[];
};

export function sourceHomeFlagName(operator: boolean) {
  return operator ? "new_dawn.source_job_home.operator_preview" : "new_dawn.source_job_home";
}

const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function readSourceHomePage(value: unknown, tenant: string, actor: string): SourceHomePage {
  if (!object(value) || value.version !== "new-dawn-source-job-home/1" ||
      value.tenant_id !== tenant || value.actor_id !== actor || !uuid(value.audit_id) ||
      !time(value.observed_at) || Date.parse(value.observed_at as string) < Date.now() - 300_000 ||
      Date.parse(value.observed_at as string) > Date.now() + 60_000 ||
      !Number.isInteger(value.reviewed_job_count) || (value.reviewed_job_count as number) < 0 ||
      !Array.isArray(value.rows) || value.rows.length > 24 ||
      value.rows.length > (value.reviewed_job_count as number)) throw Error("Source-backed job home unavailable");
  const fields = ["address", "customer", "job_number", "postcode", "status", "title", "updated_at", "verified"];
  const seen = new Set<string>();
  for (const row of value.rows) {
    if (!object(row) || !uuid(row.id) || seen.has(row.id) || !object(row.fields) ||
        Object.keys(row).sort().join() !== ["fields", "id", "source_observed_at", "source_state"].join() ||
        Object.keys(row.fields).sort().join() !== fields.join() ||
        !fields.filter((key) => key !== "verified").every((key) => (row.fields as Record<string, unknown>)[key] === null || typeof (row.fields as Record<string, unknown>)[key] === "string") ||
        typeof row.fields.verified !== "boolean" || !time(row.source_observed_at) ||
        !["reviewed_latest", "source_changed", "source_ambiguous"].includes(row.source_state as string))
      throw Error("Source-backed job home unavailable");
    seen.add(row.id);
  }
  return {
    tenantId: tenant, actorId: actor, auditId: value.audit_id as string,
    observedAt: value.observed_at as string,
    reviewedJobCount: value.reviewed_job_count as number, jobs: value.rows as SourceHomeJob[],
  };
}

/** A previously read operator page must not flash into another client or actor's preview. */
export function scopedOperatorSourcePage(page: SourceHomePage | null, tenant: string, actor: string | undefined) {
  return page?.tenantId === tenant && page.actorId === actor ? page : null;
}

export function sourceJobLabel(job: SourceHomeJob) {
  if (job.source_state === "source_changed") return "Source changed since this card was reviewed";
  if (job.source_state === "source_ambiguous") return "Source version needs review";
  return "Reviewed source version is the latest retained";
}

/** A retained observation is evidence of capture, never a current provider check. */
export function sourceJobReviewCue(job: SourceHomeJob, now = Date.now()) {
  if (job.source_state !== "reviewed_latest")
    return { kind: "link_review" as const, label: job.source_state === "source_changed"
      ? "Review changed source link" : "Review ambiguous source version" };
  const age = now - Date.parse(job.source_observed_at);
  if (!Number.isFinite(age) || age < -60_000 || age > 24 * 60 * 60_000)
    return { kind: "aged_observation" as const, label: "Recheck source observation" };
  return { kind: "recent_observation" as const, label: "Recently captured; progress unverified" };
}

/** Keep old or changed source records available without presenting them as today's work. */
export function groupSourceHomeJobs(jobs: SourceHomeJob[], now = Date.now()) {
  const recentlySaved: SourceHomeJob[] = [];
  const needsOpenFolkCheck: SourceHomeJob[] = [];
  for (const job of jobs) {
    (sourceJobReviewCue(job, now).kind === "recent_observation"
      ? recentlySaved : needsOpenFolkCheck).push(job);
  }
  return { recentlySaved, needsOpenFolkCheck };
}

/** Search only the audited, bounded selection already in view; this is not a company-wide job search. */
export function filterSourceHomeJobs(jobs: SourceHomeJob[], query: string) {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  if (!needle) return jobs;
  return jobs.filter((job) => [
    job.fields.job_number, job.fields.title, job.fields.customer,
    job.fields.address, job.fields.postcode,
  ].some((value) => value?.toLocaleLowerCase("en-GB").includes(needle)));
}

/** Plain-language client attention, separate from the operator's source diagnostics. */
export function sourceJobClientAttention(job: SourceHomeJob, now = Date.now()) {
  const cue = sourceJobReviewCue(job, now);
  if (cue.kind === "link_review") return {
    label: "Job details need checking",
    why: "OpenFolk has not confirmed which saved details are current.",
    nextStep: "Ask OpenFolk to confirm this job record before acting on it",
  };
  if (cue.kind === "aged_observation") return {
    label: "Current progress needs checking",
    why: "The last saved update cannot confirm this job's current progress.",
    nextStep: "Confirm current progress before taking the next job step",
  };
  const why = ({
    on_hold: "The last saved status is on hold; the hold reason is not confirmed here.",
    pending: "The last saved status is pending; what it is waiting for is not confirmed here.",
    open: "The last saved status is open; the next owner is not confirmed here.",
    completed: "The last saved status is complete; the final outcome is not confirmed here.",
    closed: "The last saved status is closed; the final outcome is not confirmed here.",
  } as Record<string, string>)[job.fields.status ?? ""] ??
    "The last saved status is not clear enough to guide the next step.";
  return {
    label: "Recorded progress needs confirming",
    why,
    nextStep: homeJobAction({ status: job.fields.status }),
  };
}

export function sourceJobAsHomeJob(job: SourceHomeJob, tenant: string): HomeJob {
  return {
    id: job.id, tenant_id: tenant, job_number: job.fields.job_number,
    title: job.fields.title, status: job.fields.status, verified: job.fields.verified,
    updated_at: job.fields.updated_at, customer: job.fields.customer,
    site: job.fields.address ?? job.fields.postcode,
  };
}
