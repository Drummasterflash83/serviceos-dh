export type OpenJobStatus = "on_hold" | "pending" | "open";
export type OpenJobRow = {
  connection_id: string;
  external_id: string;
  source_version_id: string;
  source_observed_at: string;
  status: OpenJobStatus;
  title: string | null;
  source_customer: string | null;
  source_site: string | null;
  source_postcode: string | null;
  property_external_id: string | null;
  customer_external_id: string | null;
  context_state: "source_customer_and_property" | "source_property_only" | "source_property_missing";
  identity_state: "reviewed_link" | "awaiting_review";
};
export type OpenJobPage = {
  tenantId: string;
  actorId: string;
  auditId: string;
  observedAt: string;
  snapshotAt: string;
  statusFilter: OpenJobStatus | null;
  rows: OpenJobRow[];
  nextCursor: string | null;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const nullableText = (value: unknown, max: number) =>
  value === null || (typeof value === "string" && value.length <= max);
const statuses = ["on_hold", "pending", "open"];
const contextStates = ["source_customer_and_property", "source_property_only", "source_property_missing"];
const identityStates = ["reviewed_link", "awaiting_review"];

export function openJobPageFlagName(operator: boolean) {
  return operator ? "new_dawn.open_job_page.operator_preview" : "new_dawn.open_job_page";
}

export function readOpenJobPage(
  value: unknown, tenant: string, actor: string, status: OpenJobStatus | null,
): OpenJobPage {
  if (!object(value) || value.version !== "new-dawn-open-job-page/1" ||
    value.tenant_id !== tenant || value.actor_id !== actor || !uuid(value.audit_id) ||
    !time(value.observed_at) || !time(value.snapshot_at) ||
    value.status_filter !== status || !Array.isArray(value.rows) || value.rows.length > 50 ||
    typeof value.has_more !== "boolean" ||
    !nullableText(value.next_cursor, 512) ||
    (value.has_more !== (value.next_cursor !== null)) ||
    Date.parse(value.observed_at as string) < Date.now() - 300_000 ||
    Date.parse(value.observed_at as string) > Date.now() + 60_000 ||
    Date.parse(value.snapshot_at as string) > Date.parse(value.observed_at as string))
    throw Error("Open job page unavailable");
  const seen = new Set<string>();
  for (const row of value.rows) {
    if (!object(row) || !uuid(row.connection_id) || !uuid(row.source_version_id) ||
      typeof row.external_id !== "string" || !/^\d{1,16}$/.test(row.external_id) ||
      !time(row.source_observed_at) || !statuses.includes(row.status as string) ||
      (status !== null && row.status !== status) ||
      !nullableText(row.title, 500) || !nullableText(row.source_customer, 500) ||
      !nullableText(row.source_site, 1000) || !nullableText(row.source_postcode, 40) ||
      !nullableText(row.property_external_id, 16) ||
      !nullableText(row.customer_external_id, 16) ||
      !contextStates.includes(row.context_state as string) ||
      !identityStates.includes(row.identity_state as string) ||
      Object.keys(row).sort().join() !== ["connection_id", "context_state", "customer_external_id", "external_id", "identity_state", "property_external_id", "source_customer", "source_observed_at", "source_postcode", "source_site", "source_version_id", "status", "title"].sort().join() ||
      seen.has(`${row.connection_id}:${row.external_id}`))
      throw Error("Open job page unavailable");
    seen.add(`${row.connection_id}:${row.external_id}`);
  }
  return {
    tenantId: tenant, actorId: actor, auditId: value.audit_id as string,
    observedAt: value.observed_at as string, snapshotAt: value.snapshot_at as string,
    statusFilter: status, rows: value.rows as OpenJobRow[],
    nextCursor: value.next_cursor as string | null,
  };
}

export function openJobNextStep(status: OpenJobStatus) {
  if (status === "on_hold") return "Check what is holding this job";
  if (status === "pending") return "Confirm what this job is waiting for";
  return "Confirm the next job step and owner";
}
