import type { OpenJobRow } from "./new-dawn-open-job-page";

export type CustomerBlockedJob = {
  connectionId: string;
  externalId: string;
  sourceVersionId: string;
  sourceObservedAt: string;
  status: "on_hold" | "pending";
  sourceDescription: string | null | undefined;
};
export type CustomerBlockerGroup = {
  kind: "company" | "person";
  id: string;
  name: string;
  onHold: number;
  pending: number;
  jobs: CustomerBlockedJob[];
};
export type CustomerBlockers = {
  tenantId: string;
  actorId: string;
  auditId: string;
  observedAt: string;
  snapshotAt: string;
  linkedBlockedJobs: number;
  groups: CustomerBlockerGroup[];
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const time = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2000;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();
const unavailable = () => { throw Error("Confirmed customer jobs unavailable"); };

/** Never turn an incomplete source match into a customer claim. */
export function readCustomerBlockers(value: unknown, tenant: string, actor: string): CustomerBlockers {
  if (!object(value) || !["new-dawn-customer-blockers/1",
    "new-dawn-customer-blockers/2"].includes(String(value.version)) ||
    value.tenant_id !== tenant || value.actor_id !== actor || !uuid(value.audit_id) ||
    !time(value.observed_at) || !time(value.snapshot_at) ||
    Date.parse(value.observed_at) < Date.now() - 300_000 ||
    Date.parse(value.observed_at) > Date.now() + 60_000 ||
    Date.parse(value.snapshot_at) > Date.parse(value.observed_at) ||
    !count(value.linked_blocked_jobs) || !Array.isArray(value.groups) ||
    value.groups.length > 2000) return unavailable();

  const seenCustomers = new Set<string>();
  const seenJobs = new Set<string>();
  let total = 0;
  const groups: CustomerBlockerGroup[] = value.groups.map((raw: unknown) => {
    if (!object(raw) || !exactKeys(raw,
      ["customer_kind", "customer_id", "customer_name", "on_hold", "pending", "jobs"]) ||
      !["company", "person"].includes(String(raw.customer_kind)) || !uuid(raw.customer_id) ||
      typeof raw.customer_name !== "string" || !raw.customer_name.trim() ||
      raw.customer_name.length > 200 || !count(raw.on_hold) || !count(raw.pending) ||
      !Array.isArray(raw.jobs) || raw.jobs.length > 2000 ||
      raw.jobs.length !== raw.on_hold + raw.pending) return unavailable();
    const customerKey = `${raw.customer_kind}:${raw.customer_id}`;
    if (seenCustomers.has(customerKey)) return unavailable();
    seenCustomers.add(customerKey);
    let onHold = 0;
    const jobs: CustomerBlockedJob[] = raw.jobs.map((row: unknown) => {
      const described = value.version === "new-dawn-customer-blockers/2";
      if (!object(row) || !exactKeys(row,
        ["connection_id", "external_id", "source_version_id", "source_observed_at", "status",
          ...(described ? ["source_description"] : [])]) ||
        !uuid(row.connection_id) || !uuid(row.source_version_id) ||
        typeof row.external_id !== "string" || !/^[1-9]\d{0,15}$/.test(row.external_id) ||
        !time(row.source_observed_at) ||
        Date.parse(row.source_observed_at) > Date.parse(value.snapshot_at as string) ||
        !["on_hold", "pending"].includes(String(row.status)) ||
        (described && !(row.source_description === null ||
          (typeof row.source_description === "string" &&
            Array.from(row.source_description).length <= 160 && row.source_description.trim() &&
            row.source_description === row.source_description.trim())))) return unavailable();
      const jobKey = `${row.connection_id}:${row.external_id}`;
      if (seenJobs.has(jobKey)) return unavailable();
      seenJobs.add(jobKey);
      if (row.status === "on_hold") onHold++;
      return { connectionId: row.connection_id as string, externalId: row.external_id as string,
        sourceVersionId: row.source_version_id as string,
        sourceObservedAt: row.source_observed_at as string,
        status: row.status as CustomerBlockedJob["status"],
        sourceDescription: described ? row.source_description as string | null : undefined };
    });
    if (onHold !== raw.on_hold) return unavailable();
    total += jobs.length;
    return { kind: raw.customer_kind as CustomerBlockerGroup["kind"],
      id: raw.customer_id as string, name: raw.customer_name as string,
      onHold: raw.on_hold as number, pending: raw.pending as number, jobs };
  });
  if (total !== value.linked_blocked_jobs) return unavailable();
  return { tenantId: tenant, actorId: actor, auditId: value.audit_id as string,
    observedAt: value.observed_at as string, snapshotAt: value.snapshot_at as string,
    linkedBlockedJobs: total, groups };
}

/** Used solely as an exact-version key for the audited job-detail RPC. */
export function customerBlockedJobDetailKey(job: CustomerBlockedJob): OpenJobRow {
  return {
    connection_id: job.connectionId, external_id: job.externalId,
    source_version_id: job.sourceVersionId, source_observed_at: job.sourceObservedAt,
    job_created_at: null, status_first_saved_at: job.sourceObservedAt,
    status_evidence: "timing_unknown", status: job.status, title: null,
    source_customer: null, source_site: null, source_postcode: null,
    property_external_id: null, customer_external_id: null,
    context_state: "source_property_missing", identity_state: "reviewed_link",
  };
}
