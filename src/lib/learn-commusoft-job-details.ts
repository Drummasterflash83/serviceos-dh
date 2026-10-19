import type { ReviewClient } from "./learn-commusoft-review.ts";
export const JOB_DETAIL_FIELDS = {
  description: "Description",
  status: "Source status",
  priority: "Priority",
  customerReference: "Customer reference",
  businessUnit: "Business unit",
  userGroup: "Source user group",
  closedOutcome: "Source closure outcome",
  quotedAmount: "Quoted amount (source text)",
  customerContactName: "Customer contact named on source job",
  siteContactName: "Site contact named on source job",
  completedBySourceUser: "Completed by (source user)",
  closedBySourceUser: "Closed by (source user)",
} as const;
export const JOB_DETAIL_DATES = {
  created: "Created",
  reported: "Reported",
  completed: "Completed",
  closed: "Closed",
} as const;
type FieldKey = keyof typeof JOB_DETAIL_FIELDS;
type DateKey = keyof typeof JOB_DETAIL_DATES;
export type JobDate = {
  state: "absent" | "invalid" | "timezone_required" | "zoned";
  source: string | null;
  instant: string | null;
};
export type JobDetails = {
  version: "commusoft-job-detail/2";
  tenant_id: string;
  connection_id: string;
  version_id: string;
  external_id: string;
  observed_at: string;
  current: boolean;
  property_reference: string | null;
  fields: Record<FieldKey, { value: string | null; shortened: boolean }>;
  dates: Record<DateKey, JobDate>;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const keys = (v: any, allowed: string[]) =>
  object(v) &&
  Object.keys(v).length === allowed.length &&
  allowed.every((k) => Object.hasOwn(v, k));
const codepoints = (v: string) => [...v].length;
function instantMicros(v: unknown): bigint | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) return null;
  const utc = Date.parse(m[1] + "Z"),
    base = Date.parse(m[1] + m[3]);
  if (
    !Number.isFinite(utc) ||
    !Number.isFinite(base) ||
    new Date(utc).toISOString().slice(0, 19) !== m[1]
  )
    return null;
  return BigInt(base) * 1000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}
const zoned = (v: unknown) => instantMicros(v) !== null;
const unavailable = () =>
  Error("Retained job details could not be verified. Retry or ask OpenFolk to check access.");
export function parseCommusoftJobDetails(
  value: unknown,
  tenant: string,
  connection: string,
  version: string,
  external: string,
): JobDetails {
  const d = value as JobDetails;
  if (
    !keys(d, [
      "version",
      "tenant_id",
      "connection_id",
      "version_id",
      "external_id",
      "observed_at",
      "current",
      "property_reference",
      "fields",
      "dates",
    ]) ||
    d.version !== "commusoft-job-detail/2" ||
    d.tenant_id !== tenant ||
    d.connection_id !== connection ||
    d.version_id !== version ||
    d.external_id !== external ||
    !zoned(d.observed_at) ||
    typeof d.current !== "boolean" ||
    !(
      d.property_reference === null ||
      (typeof d.property_reference === "string" &&
        /^[1-9]\d{0,15}$/.test(d.property_reference) &&
        Number(d.property_reference) <= Number.MAX_SAFE_INTEGER)
    ) ||
    !keys(d.fields, Object.keys(JOB_DETAIL_FIELDS)) ||
    !keys(d.dates, Object.keys(JOB_DETAIL_DATES))
  )
    throw unavailable();
  for (const f of Object.values(d.fields)) {
    if (
      !keys(f, ["value", "shortened"]) ||
      typeof f.shortened !== "boolean" ||
      !(f.value === null || (typeof f.value === "string" && codepoints(f.value) <= 4000)) ||
      (f.shortened && (f.value === null || codepoints(f.value) !== 4000))
    )
      throw unavailable();
  }
  for (const date of Object.values(d.dates)) parseJobDate(date);
  return d;
}
export async function loadCommusoftJobDetails(
  db: ReviewClient,
  tenant: string,
  connection: string,
  version: string,
  external: string,
) {
  if (
    ![tenant, connection, version].every(uuid) ||
    !/^[1-9]\d{0,15}$/.test(external) ||
    Number(external) > Number.MAX_SAFE_INTEGER
  )
    throw unavailable();
  try {
    const { data, error } = await db.rpc("learn_commusoft_job_details", {
      p_tenant: tenant,
      p_connection: connection,
      p_version: version,
    });
    if (error) throw unavailable();
    return parseCommusoftJobDetails(data, tenant, connection, version, external);
  } catch {
    throw unavailable();
  }
}

/** Shared source-date validator. An unzoned value never becomes an instant. */
export function parseJobDate(value: unknown): JobDate {
  const date = value as JobDate;
  if (
    !keys(date, ["state", "source", "instant"]) ||
    !["absent", "invalid", "timezone_required", "zoned"].includes(date.state) ||
    !(date.source === null || (typeof date.source === "string" && codepoints(date.source) <= 100))
  )
    throw unavailable();
  if (date.state === "zoned") {
    if (
      !zoned(date.source) ||
      !zoned(date.instant) ||
      instantMicros(date.source) !== instantMicros(date.instant)
    )
      throw unavailable();
  } else if (
    date.instant !== null ||
    (date.state === "absent" && date.source !== null) ||
    (date.state === "timezone_required" &&
      (typeof date.source !== "string" ||
        !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(date.source) ||
        !zoned(date.source.replace(" ", "T") + "Z")))
  )
    throw unavailable();

  return date;
}
export function sameJobInstant(left: unknown, right: unknown): boolean {
  const a = instantMicros(left),
    b = instantMicros(right);
  return a !== null && b !== null && a === b;
}
