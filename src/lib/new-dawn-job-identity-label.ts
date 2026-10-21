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
    shortEvidence: reviewed ? null : "Job match awaiting review",
    detailEvidence: reviewed
      ? "This Commusoft job has a reviewed OpenFolk job link. The customer and site names are from Commusoft; this check does not confirm separate customer or site matches."
      : "These customer and site names are from Commusoft. This job still needs an OpenFolk match review; the names are not confirmed customer or site matches.",
  };
}
