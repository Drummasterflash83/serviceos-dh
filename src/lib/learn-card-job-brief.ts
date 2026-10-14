import type { LearnCardDetail } from "./learn-cards.ts";
import type { BusinessContextPage } from "./learn-customer-business-context.ts";

/** Published canonical statuses only. Neither a completion date, title, missing
 * action nor a historical provider code establishes that a job was completed. */
export function customerJobBrief(page: BusinessContextPage) {
  if (page.collection !== "jobs") throw new Error("Job evidence required");
  const counts = { completed: 0, open: 0, pending: 0, on_hold: 0, closed: 0, unconfirmed: 0 };
  let verificationPending = 0;
  for (const row of page.rows) {
    if (row.fields.verified !== true) verificationPending++;
    const status = row.fields.status;
    if (["completed", "open", "pending", "on_hold", "closed"].includes(status)) {
      counts[status as Exclude<keyof typeof counts, "unconfirmed">]++;
    } else counts.unconfirmed++;
  }
  return {
    ...counts,
    verificationPending,
    shown: page.rows.length,
    total: page.total,
    limited: page.rows.length < page.total || page.next_after !== null,
    observedAt: page.observed_at,
    validUntil: Date.parse(page.observed_at) + 60000,
  };
}
export type CustomerJobBrief = ReturnType<typeof customerJobBrief>;
export type ScopedCustomerJobBrief = { scope: string; brief: CustomerJobBrief };
export function visibleCustomerJobBrief(
  value: ScopedCustomerJobBrief | null,
  scope: string,
  now: number,
): CustomerJobBrief | null {
  return value?.scope === scope &&
    Number.isFinite(now) &&
    now < value.brief.validUntil &&
    now >= Date.parse(value.brief.observedAt) - 60000
    ? value.brief
    : null;
}

/** Own-job status uses the same scoped, expiring read as its evidence. Never
 * infer completion from dates, descriptions, type codes or a verified flag. */
export function visibleJobRecordBrief(data: LearnCardDetail | null, now: number) {
  if (
    !data ||
    data.card.kind !== "job" ||
    !data.jobRecord ||
    !Number.isFinite(now) ||
    now >= Date.parse(data.validUntil) ||
    now < Date.parse(data.observedAt) ||
    !Number.isFinite(Date.parse(data.validUntil)) ||
    !Number.isFinite(Date.parse(data.observedAt))
  )
    return null;
  const labels: Record<string, string> = {
    completed: "Job recorded complete",
    open: "Job recorded as open",
    pending: "Job recorded as pending",
    on_hold: "Job recorded as on hold",
    closed: "Job recorded as closed",
  };
  return {
    headline: Object.hasOwn(labels, data.jobRecord.status ?? "")
      ? labels[data.jobRecord.status!]
      : "Job status needs confirmation",
    verification: data.jobRecord.verified
      ? "Verified job record."
      : "Job record awaits verification.",
    qualification:
      "Recorded status does not establish payment or a completion time. It may lag the provider.",
  };
}
