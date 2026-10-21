import type { OpenJobRow } from "./new-dawn-open-job-page";

type SourceIdentity = Pick<OpenJobRow, "source_customer" | "source_site" |
  "source_postcode" | "identity_state">;

/** A source label is not a confirmed ServiceOS customer or site identity. */
export function jobSourceIdentity(row: SourceIdentity) {
  const customer = row.source_customer ?? "Customer not recorded";
  const site = row.source_site ?? row.source_postcode ?? "Site not recorded";
  const reviewed = row.identity_state === "reviewed_link";
  return {
    sourceLabel: `${customer} · ${site}`,
    shortEvidence: reviewed ? null : "Customer and site still to confirm",
    detailEvidence: reviewed
      ? "This job has a reviewed job link. The customer and site names come from Commusoft; open the linked details below to check whether the customer and site match is confirmed."
      : "These names are from Commusoft's saved job. The customer and site have not yet been confirmed against the customer records.",
  };
}
