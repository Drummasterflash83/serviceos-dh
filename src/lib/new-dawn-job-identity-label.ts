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
    shortEvidence: reviewed
      ? "Customer/site IDs reviewed" : "Customer/site match awaiting review",
    detailEvidence: reviewed
      ? "Customer and site IDs have a reviewed OpenFolk link. The names shown are from Commusoft."
      : "These are Commusoft source labels. The OpenFolk customer and site match is still awaiting review.",
  };
}
