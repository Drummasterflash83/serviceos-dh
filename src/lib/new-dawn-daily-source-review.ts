import { SOURCE_JOB_IDENTITIES, SOURCE_JOB_RELATIONSHIPS } from "./learn-commusoft-source-jobs.ts";
import type { RecentUnlinkedJob } from "./new-dawn-recent-unlinked-jobs.ts";

/** Source-only evidence cannot become a client job or a person assignment. */
export function dailySourceReview(row: RecentUnlinkedJob) {
  return {
    relationship: SOURCE_JOB_RELATIONSHIPS[row.relationship_state],
    identity: SOURCE_JOB_IDENTITIES[row.customer_identity_state],
    nextAction:
      row.version_id === null
        ? "Resolve conflicting source observations before reviewing this job."
        : row.customer_identity_state === "reviewed"
          ? "Verify the job link against this exact source record."
          : "Review the saved customer and site source before confirming a job link.",
  };
}
