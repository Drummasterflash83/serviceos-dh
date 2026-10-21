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
      ? "Job source linked · customer/site labels unverified"
      : "Job source link awaiting review · customer/site labels unverified",
    detailEvidence: reviewed
      ? "This Commusoft job source has a reviewed OpenFolk job link. The customer and site names are Commusoft labels; this check does not confirm their own matches."
      : "These customer and site names are Commusoft source labels. The OpenFolk job source link is still awaiting review; their own matches are not confirmed by this check.",
  };
}
