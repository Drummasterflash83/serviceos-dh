import type { OperatorJobSource } from "./new-dawn-operator-job-source.ts";
import type { SourceHomeJob } from "./new-dawn-source-job-home.ts";

/** Only the exact, still-current reviewed link may add source facts to the MD preview. */
export function mdPreviewJobFacts(
  tenant: string,
  job: SourceHomeJob,
  read: OperatorJobSource | null,
) {
  if (
    job.source_state !== "reviewed_latest" ||
    read?.tenant_id !== tenant ||
    read.job_id !== job.id ||
    read.state !== "linked" ||
    read.source?.current !== true ||
    read.source.tenant_id !== tenant
  )
    return null;

  const saved = read.source;
  const work = saved.fields.description.value?.trim() || null;
  const outcome = saved.fields.closedOutcome.value?.trim() || null;
  return {
    work,
    workShortened: saved.fields.description.shortened,
    reported: saved.dates.reported.source,
    completed: saved.dates.completed.source,
    outcome,
    observedAt: saved.observed_at,
  };
}
