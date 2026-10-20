export type ExactLinkReviewRow = {
  externalId: string;
  state: "ready" | "review";
  reason: string | null;
  sourceVersionId: string | null;
};
export type ExactLinkReviewPage = {
  rows: ExactLinkReviewRow[];
  nextCursor: string | null;
  observedAt: string;
  auditId: string;
};

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const sourceId = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v);
const instant = (v: unknown): v is string =>
  typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const reasonCode = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z][a-z_]{0,79}$/.test(v);
const unavailable = () => Error("Exact job review could not be verified.");

/** The server classifies exact IDs. A withheld or conflicting row never becomes link-ready. */
export function readExactLinkReviewPage(
  raw: unknown, scope: { tenant: string; connection: string; actor: string },
  now = Date.now(),
): ExactLinkReviewPage {
  if (!object(raw) || raw.version !== "new-dawn-exact-link-review/1" ||
    raw.tenant_id !== scope.tenant || raw.connection_id !== scope.connection ||
    raw.actor_id !== scope.actor || !uuid(raw.audit_id) || !instant(raw.observed_at) ||
    Math.abs(now - Date.parse(raw.observed_at)) > 120_000 ||
    !Array.isArray(raw.rows) || raw.rows.length > 50 ||
    !(raw.next_cursor === null || sourceId(raw.next_cursor))) throw unavailable();
  const rows: ExactLinkReviewRow[] = [];
  let previous = "";
  for (const value of raw.rows) {
    if (!object(value) || !sourceId(value.external_id) ||
      (previous && value.external_id <= previous) ||
      !["ready", "review"].includes(String(value.state)) ||
      !(value.reason === null || reasonCode(value.reason)) ||
      !(value.source_version_id === null || uuid(value.source_version_id)) ||
      (value.state === "ready" && (value.reason !== null || !uuid(value.source_version_id))) ||
      (value.state === "review" && value.reason === null)) throw unavailable();
    previous = value.external_id;
    rows.push({ externalId: value.external_id, state: value.state as "ready" | "review",
      reason: value.reason as string | null,
      sourceVersionId: value.source_version_id as string | null });
  }
  if (raw.next_cursor !== null && (!rows.length || raw.next_cursor !== rows.at(-1)?.externalId))
    throw unavailable();
  return { rows, nextCursor: raw.next_cursor as string | null,
    observedAt: raw.observed_at as string, auditId: raw.audit_id as string };
}

export function exactLinkReviewAction(row: ExactLinkReviewRow):
  "job" | "customer_site" | "hold" {
  if (row.state === "ready") return "job";
  if (["customer_mapping_missing_or_stale", "site_mapping_missing_or_stale", "customer_mapping_missing_or_ambiguous", "site_mapping_missing_or_ambiguous"]
    .includes(row.reason ?? "")) return "customer_site";
  return "hold";
}

/** A current reviewed customer may proceed directly to its exact work-site review. */
export function exactSourceReviewDestination(
  row: ExactLinkReviewRow,
  customerIdentity: string,
  site: string | null,
): "site" | "customer" {
  return row.state === "review" && row.reason === "site_mapping_missing_or_stale" &&
    customerIdentity === "reviewed" && site && /^[1-9][0-9]{0,15}$/.test(site)
    ? "site" : "customer";
}

export function exactLinkReviewLabel(row: ExactLinkReviewRow): string {
  if (row.state === "ready") return "Exact customer and site IDs are ready for a version-checked job link.";
  const labels: Record<string, string> = {
    site_mapping_missing_or_stale: "The exact work site needs a current reviewed link.",
    site_mapping_missing_or_ambiguous: "The exact work site has no single current mapping. Review its source and conflicts.",
    customer_mapping_missing_or_ambiguous: "The exact customer has no single current mapping. Review its source and conflicts.",
    customer_mapping_missing_or_stale: "The exact customer needs a current reviewed link.",
    property_not_exact_work_site: "This property is outside the exact work-address route. A customer's own address needs a separately reviewed site and job link.",
    property_source_missing_or_ambiguous: "The source property is missing or ambiguous.",
    customer_source_missing_or_ambiguous: "The source customer is missing or ambiguous.",
    customer_site_conflict: "Customer and site records conflict; hold for review.",
    existing_job_needs_review: "An existing job identity needs review before linking.",
    prior_auto_link_reversed: "A previous exact link was reversed; hold for review.",
  };
  return labels[row.reason ?? ""] ?? "The exact source IDs need review before linking.";
}

export async function loadExactLinkReviewPage(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> },
  scope: { tenant: string; connection: string; actor: string; reason: string; after: string | null },
) {
  if (![scope.tenant, scope.connection, scope.actor].every(uuid) ||
    scope.reason.trim().length < 3 || scope.reason.trim().length > 500 ||
    !(scope.after === null || sourceId(scope.after))) throw unavailable();
  const { data, error } = await db.rpc("new_dawn_m2_link_review_page", {
    p_tenant: scope.tenant, p_connection: scope.connection, p_after: scope.after,
    p_limit: 50, p_reason: scope.reason.trim(),
  });
  if (error) throw unavailable();
  return readExactLinkReviewPage(data, scope);
}
