type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{64}$/.test(value);
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  /(?:Z|[+-]\d\d:\d\d)$/.test(value);

export interface FocClosureCandidate {
  jobId: string;
  jobNumber: string | null;
  externalId: string;
  connectionId: string;
  sourceVersionId: string;
  sourceSha256: string;
  detailSha256: string;
  checkedAt: string;
  closedAtSource: string | null;
  focReasonSource: string | null;
}
export interface FocClosureReview {
  checkedAt: string;
  auditId: string;
  candidateCount: number;
  rows: FocClosureCandidate[];
}

/** A dated source closure, never an uninvoiced, paid or margin conclusion. */
export function readFocClosureReview(
  value: unknown,
  tenant: string,
  actor: string,
): FocClosureReview {
  if (
    !object(value) ||
    value.version !== "new-dawn-foc-closure-review/1" ||
    value.audience !== "openfolk_operator_only" ||
    value.tenant_id !== tenant ||
    value.actor_id !== actor ||
    value.source !== "Commusoft exact job detail" ||
    value.scope !== "recorded_free_of_charge_closure_not_invoice_or_payment" ||
    !timestamp(value.checked_at) ||
    !uuid(value.audit_id) ||
    !Number.isInteger(value.candidate_count) ||
    (value.candidate_count as number) < 0 ||
    !Array.isArray(value.rows) ||
    value.rows.length > 20 ||
    value.rows.length > (value.candidate_count as number)
  )
    throw Error("foc_closure_review_invalid");
  const seen = new Set<string>();
  const rows = value.rows.map((row): FocClosureCandidate => {
    if (
      !object(row) ||
      !uuid(row.job_id) ||
      seen.has(row.job_id) ||
      !sourceId(row.external_id) ||
      !uuid(row.connection_id) ||
      !uuid(row.source_version_id) ||
      !hash(row.source_sha256) ||
      !hash(row.detail_sha256) ||
      !timestamp(row.checked_at) ||
      Date.parse(row.checked_at) > Date.parse(value.checked_at as string) ||
      !(
        row.job_number === null ||
        (typeof row.job_number === "string" && row.job_number.length <= 100)
      ) ||
      !(
        row.closed_at_source === null ||
        (typeof row.closed_at_source === "string" && row.closed_at_source.length <= 80)
      ) ||
      !(
        row.foc_reason_source === null ||
        (typeof row.foc_reason_source === "string" &&
          new TextEncoder().encode(row.foc_reason_source).length <= 200)
      )
    )
      throw Error("foc_closure_review_invalid");
    seen.add(row.job_id);
    return {
      jobId: row.job_id,
      jobNumber: row.job_number,
      externalId: row.external_id,
      connectionId: row.connection_id,
      sourceVersionId: row.source_version_id,
      sourceSha256: row.source_sha256,
      detailSha256: row.detail_sha256,
      checkedAt: row.checked_at,
      closedAtSource: row.closed_at_source,
      focReasonSource: row.foc_reason_source,
    };
  });
  return {
    checkedAt: value.checked_at as string,
    auditId: value.audit_id as string,
    candidateCount: value.candidate_count as number,
    rows,
  };
}
