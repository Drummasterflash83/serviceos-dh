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
