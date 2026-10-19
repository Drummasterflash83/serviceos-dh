import type { SourceHomePage } from "./new-dawn-source-job-home.ts";

export function canShowScoreReadiness(
  operator: boolean, tenant: string, actor: string | undefined,
  page: SourceHomePage | null, flag: boolean,
) {
  return operator && flag && !!actor && !!page &&
    page.tenantId === tenant && page.actorId === actor;
}

/** Describes the audited, bounded job selection. It never produces a score. */
export function summarizeScoreReadiness(page: SourceHomePage, now = Date.now()) {
  let recent = 0;
  let aged = 0;
  let linkReview = 0;
  let namedCustomerRows = 0;
  for (const job of page.jobs) {
    if (job.source_state !== "reviewed_latest") linkReview++;
    else {
      const age = now - Date.parse(job.source_observed_at);
      if (Number.isFinite(age) && age >= -60_000 && age <= 24 * 60 * 60_000) recent++;
      else aged++;
    }
    if (typeof job.fields.customer === "string" && job.fields.customer.trim()) namedCustomerRows++;
  }
  return {
    selected: page.jobs.length,
    reviewedLinked: page.reviewedJobCount,
    recent,
    aged,
    linkReview,
    namedCustomerRows,
    readAt: page.observedAt,
  };
}
