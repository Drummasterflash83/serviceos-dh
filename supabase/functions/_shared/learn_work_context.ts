/** Reviewed context is descriptive evidence, never a permission or inferred identity. */
export interface ReviewedWorkContext {
  version: "learn-slack-work-context/1";
  state: "reviewed";
  scope: "company" | "job";
  request_id: string;
  source_version: string;
  job_id: string | null;
  reviewed_by: string;
  reviewed_at: string;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function reviewedWorkContext(input: {
  metadata?: unknown;
  related_job_id?: string | null;
}): ReviewedWorkContext | null {
  const m = input.metadata as Record<string, any> | null;
  const c = m?.work_context;
  if (
    !c ||
    c.version !== "learn-slack-work-context/1" ||
    c.state !== "reviewed" ||
    typeof c.source_version !== "string" ||
    !c.source_version ||
    c.source_version !== m?.source_version ||
    !uuid(c.request_id) ||
    !uuid(c.reviewed_by) ||
    !Number.isFinite(Date.parse(c.reviewed_at)) ||
    !["company", "job"].includes(c.scope) ||
    (c.scope === "company"
      ? c.job_id !== null || input.related_job_id != null
      : !uuid(c.job_id) || c.job_id !== input.related_job_id)
  )
    return null;
  return {
    version: c.version,
    state: c.state,
    scope: c.scope,
    request_id: c.request_id,
    source_version: c.source_version,
    job_id: c.job_id,
    reviewed_by: c.reviewed_by,
    reviewed_at: c.reviewed_at,
  };
}
