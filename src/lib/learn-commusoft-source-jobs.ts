import type { ReviewClient } from "./learn-commusoft-review.ts";

export const SOURCE_JOB_RELATIONSHIPS = {
  customer_source_retained: "Customer source record available",
  site_customer_source_retained: "Site and customer source records available",
  job_source_conflict: "Conflicting latest job observations — refresh or ask OpenFolk to check",
  property_reference_missing: "Job has no usable customer/site reference",
  property_source_missing: "Referenced customer/site record has not been captured",
  property_source_conflict: "Referenced customer/site has conflicting latest observations",
  property_type_unresolved: "Customer/site source structure needs review",
  customer_reference_missing: "Site has no usable customer reference",
  customer_source_missing: "Site’s customer record has not been captured",
  customer_source_conflict: "Site’s customer has conflicting latest observations",
  customer_type_unresolved: "Site’s parent is not identified as a customer source record",
} as const;
export const SOURCE_JOB_IDENTITIES = {
  reviewed: "Customer identity reviewed",
  unreviewed: "Customer identity not yet classified — source job remains visible",
  review_changed: "Customer source changed since identity review",
  unresolved: "Customer identity unresolved",
} as const;
export type SourceJob = {
  external_id: string;
  version_id: string | null;
  observed_at: string;
  title: string;
  source_status: string | null;
  business_unit: string | null;
  property_reference: string | null;
  customer_reference: string | null;
  company_name: string | null;
  contact_name: string | null;
  relationship_state: keyof typeof SOURCE_JOB_RELATIONSHIPS;
  customer_identity_state: keyof typeof SOURCE_JOB_IDENTITIES;
  reviewed_job_id: string | null;
};
export type SourceJobScope = { tenant: string; actor: string; connection: string; query: string; openOnly: boolean; after: string | null };
export type SourceJobPage = {
  rows: SourceJob[];
  counts: { retained_jobs: number; open_jobs: number; matching_jobs: number; reviewed_jobs: number; source_relationship_gaps: number; unreviewed_customer_identities: number };
  next_after: string | null;
  latest_job_page_at: string | null;
  observed_at: string;
};
/** Navigation clue only: never an identity match or permission to link a job. */
export function customerSourceForReview(row: SourceJob): string | null {
  return row.version_id &&
    (row.relationship_state === "customer_source_retained" ||
      row.relationship_state === "site_customer_source_retained") &&
    row.customer_reference && /^[1-9]\d{0,15}$/.test(row.customer_reference)
      ? row.customer_reference
      : null;
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const reference = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,15}$/.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const failure = () => Error("Captured jobs could not be verified. Refresh or ask OpenFolk to check access.");
export function readSourceJobPage(value: unknown, scope: SourceJobScope, now = Date.now()): SourceJobPage {
  const d = value as any;
  if (!object(d) || d.version !== "commusoft-source-job-cards/1" || d.tenant_id !== scope.tenant ||
      d.actor_id !== scope.actor || d.connection_id !== scope.connection || d.query !== scope.query.trim() ||
      d.open_only !== scope.openOnly || d.after !== scope.after || !uuid(d.audit_id) ||
      !instant(d.observed_at) || Math.abs(now - Date.parse(d.observed_at)) > 120000 ||
      !(d.latest_job_page_at === null || instant(d.latest_job_page_at)) ||
      !(d.next_after === null || reference(d.next_after)) || !object(d.counts) || !Array.isArray(d.rows) || d.rows.length > 25) throw failure();
  for (const name of ["retained_jobs", "open_jobs", "matching_jobs", "reviewed_jobs", "source_relationship_gaps", "unreviewed_customer_identities"])
    if (!Number.isSafeInteger(d.counts[name]) || d.counts[name] < 0 || d.counts[name] > d.counts.retained_jobs) throw failure();
  let previous = scope.after ?? "";
  for (const r of d.rows) {
    if (!object(r) || !reference(r.external_id) || r.external_id <= previous ||
        !(r.version_id === null || uuid(r.version_id)) || !instant(r.observed_at) ||
        typeof r.title !== "string" || [...r.title].length > 1000 ||
        !Object.hasOwn(SOURCE_JOB_RELATIONSHIPS, r.relationship_state) || !Object.hasOwn(SOURCE_JOB_IDENTITIES, r.customer_identity_state) ||
        !(r.reviewed_job_id === null || uuid(r.reviewed_job_id))) throw failure();
    for (const key of ["source_status", "business_unit", "company_name", "contact_name"])
      if (!(r[key] === null || (typeof r[key] === "string" && [...r[key]].length <= (key === "contact_name" ? 2001 : 1000)))) throw failure();
    for (const key of ["property_reference", "customer_reference"])
      if (!(r[key] === null || reference(r[key]))) throw failure();
    if ((r.version_id === null) !== (r.relationship_state === "job_source_conflict") ||
        (r.version_id === null && (r.source_status !== null || r.reviewed_job_id !== null)) ||
        (scope.openOnly && !["Open", "ongoing", "pending", "on_hold"].includes(r.source_status))) throw failure();
    previous = r.external_id;
  }
  if (d.rows.length > d.counts.matching_jobs || (d.next_after !== null && (d.rows.length !== 25 || d.next_after !== previous))) throw failure();
  return { rows: d.rows, counts: d.counts, next_after: d.next_after, latest_job_page_at: d.latest_job_page_at, observed_at: d.observed_at };
}
export async function loadSourceJobPage(db: ReviewClient, scope: SourceJobScope) {
  if (![scope.tenant, scope.actor, scope.connection].every(uuid) || typeof scope.openOnly !== "boolean" ||
      typeof scope.query !== "string" || scope.query.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(scope.query) ||
      !(scope.after === null || reference(scope.after))) throw failure();
  const { data, error } = await db.rpc("learn_commusoft_source_job_cards", {
    p_tenant: scope.tenant, p_connection: scope.connection, p_query: scope.query.trim(), p_open_only: scope.openOnly, p_after: scope.after,
  });
  if (error) throw failure();
  return readSourceJobPage(data, scope);
}

/** Creates an audited OpenFolk review task for this exact retained source version.
 * Assignment is a separate, authorised Command Centre work transition. */
export async function createSourceJobReviewAction(db: ReviewClient, input: {
  tenant: string; connection: string; external: string; version: string; reason: string;
}): Promise<{ id: string; created: boolean }> {
  if (!uuid(input.tenant) || !uuid(input.connection) || !uuid(input.version) ||
      !reference(input.external) || !input.reason.trim() || input.reason.length > 1000) throw failure();
  const { data, error } = await db.rpc("learn_commusoft_create_job_review_action", {
    p_tenant: input.tenant, p_connection: input.connection, p_external_id: input.external,
    p_version: input.version, p_reason: input.reason.trim(),
  });
  const result = data as Record<string, unknown> | null;
  if (error || result === null || !uuid(result.id) || typeof result.created !== "boolean" ||
      !uuid(result.source_version_id)) throw Error("The review task could not be verified. Refresh the source job and retry.");
  return { id: result.id, created: result.created };
}
