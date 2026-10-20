import { customerSourceForReview, type SourceJob } from "./learn-commusoft-source-jobs.ts";
import type { RecentUnlinkedJob } from "./new-dawn-recent-unlinked-jobs.ts";
import type { WorkDraft, WorkReceipt, WorkSource } from "./learn-commusoft-work.ts";

export type GuidedJobReview = {
  connection: string;
  job: string;
  jobVersion: string;
  customer: string;
  site: string | null;
};

/** Navigation only. The existing audited reviews still make every identity/link decision. */
export function planGuidedJobReview(
  connection: string,
  recent: RecentUnlinkedJob,
  exact: SourceJob | undefined,
): GuidedJobReview {
  if (!exact || !recent.version_id || exact.external_id !== recent.external_id ||
      exact.version_id !== recent.version_id || exact.reviewed_job_id ||
      exact.relationship_state !== recent.relationship_state ||
      exact.customer_identity_state !== recent.customer_identity_state) {
    throw Error("The saved job changed. Refresh its source before reviewing identity.");
  }
  const customer = customerSourceForReview(exact);
  const site = exact.relationship_state === "site_customer_source_retained"
    ? exact.property_reference : null;
  if (!customer || (exact.relationship_state === "site_customer_source_retained" &&
      (!site || !/^[1-9]\d{0,15}$/.test(site)))) {
    throw Error("The exact customer or site source is unavailable for review.");
  }
  return { connection, job: exact.external_id, jobVersion: recent.version_id,
    customer, site };
}

/** A saved batch can advance a guided site review only for its one exact linked version. */
export function exactSiteWasLinked(
  site: { connection: string; external: string },
  source: WorkSource | undefined,
  draft: WorkDraft,
  receipt: WorkReceipt,
): boolean {
  return !!source && source.external_id === site.external && !!source.version_id &&
    draft.connection === site.connection && draft.kind === "site" &&
    draft.items.length === 1 && draft.items[0].version_id === source.version_id &&
    receipt.connection_id === site.connection && receipt.kind === "site" &&
    receipt.state === "recorded" && receipt.linked === 1 && receipt.held === 0 &&
    receipt.items.length === 1 && receipt.items[0].version_id === source.version_id &&
    receipt.items[0].outcome.state === "linked";
}
