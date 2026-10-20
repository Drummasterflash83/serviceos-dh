/** Literal retained-source comparison. It never authorises an invoice/job link. */
export type InvoiceJobPairSource = {
  auditId: string;
  readAt: string;
  invoice: {
    realmId: string; invoiceId: string; versionId: string; sourceSha256: string;
    observedAt: string; documentNumber: string | null; customerReference: string | null;
    customFields: { name: string; value: string }[];
  };
  job: {
    jobId: string; connectionId: string; externalId: string; jobNumber: string | null;
    versionId: string; sourceSha256: string; observedAt: string;
    customerReference: string | null;
  };
};

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const iso = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v));
const optionalText = (v: unknown, max: number): v is string | null => v === null ||
  (typeof v === "string" && v.length <= max);
const sha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

export function canInspectInvoiceJobPair(operator: boolean, opened: boolean, flag: boolean,
  reason: string, jobId: string): boolean {
  return operator && opened && flag && reason.trim().length >= 3 &&
    reason.trim().length <= 500 && uuid(jobId.trim());
}

export function readInvoiceJobPairSource(value: unknown, tenant: string, actor: string,
  expectedInvoiceVersion: string, expectedJob: string): InvoiceJobPairSource {
  if (!object(value) || value.version !== "new-dawn-invoice-job-pair-source/1" ||
    value.audience !== "openfolk_operator_only" || value.tenant_id !== tenant ||
    value.actor_id !== actor || value.relationship !== "unverified" ||
    !uuid(value.audit_id) || !iso(value.read_at) ||
    !object(value.invoice) || !object(value.job)) throw Error("Exact pair source unavailable");
  const i = value.invoice, j = value.job;
  if (typeof i.realm_id !== "string" || !/^[1-9]\d{0,29}$/.test(i.realm_id) ||
    typeof i.invoice_id !== "string" || !/^\d{1,30}$/.test(i.invoice_id) ||
    i.version_id !== expectedInvoiceVersion || !uuid(i.version_id) || !sha(i.source_sha256) ||
    !iso(i.observed_at) || !optionalText(i.document_number, 200) ||
    !optionalText(i.customer_reference, 100) ||
    !Array.isArray(i.custom_fields) || i.custom_fields.length > 20 ||
    i.custom_fields.some((f: unknown) => !object(f) || typeof f.name !== "string" ||
      typeof f.value !== "string" || f.name.length > 100 || f.value.length > 200) ||
    j.job_id !== expectedJob || !uuid(j.job_id) || !uuid(j.connection_id) ||
    typeof j.external_id !== "string" || !/^[1-9]\d{0,15}$/.test(j.external_id) ||
    !optionalText(j.job_number, 200) || !uuid(j.version_id) || !sha(j.source_sha256) ||
    !iso(j.observed_at) || !optionalText(j.customer_reference, 200) ||
    Date.parse(i.observed_at as string) > Date.parse(value.read_at as string) ||
    Date.parse(j.observed_at as string) > Date.parse(value.read_at as string))
    throw Error("Exact pair source unavailable");
  return {
    auditId: value.audit_id as string, readAt: value.read_at as string,
    invoice: { realmId: i.realm_id, invoiceId: i.invoice_id, versionId: i.version_id,
      sourceSha256: i.source_sha256, observedAt: i.observed_at,
      documentNumber: i.document_number, customerReference: i.customer_reference,
      customFields: i.custom_fields },
    job: { jobId: j.job_id, connectionId: j.connection_id, externalId: j.external_id,
      jobNumber: j.job_number, versionId: j.version_id, sourceSha256: j.source_sha256,
      observedAt: j.observed_at, customerReference: j.customer_reference },
  } as InvoiceJobPairSource;
}
