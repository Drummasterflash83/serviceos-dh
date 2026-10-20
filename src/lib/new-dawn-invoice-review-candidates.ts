/** Saved QuickBooks invoice evidence for OpenFolk operators only. No customer or job link. */
export type InvoiceReviewCandidate = {
  invoiceId: string; versionId: string; documentNumber: string | null;
  balance: string; currency: string; dueDate: string;
  sourceUpdatedAt: string; sourceObservedAt: string; sourceSha256: string;
};
export type InvoiceReviewPage = {
  realmId: string; asOf: string; readAt: string; newestObservedAt: string | null;
  eligibleCount: number; candidates: InvoiceReviewCandidate[]; auditId: string;
};

const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const iso = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v));
const date = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
const positiveDecimal = (v: unknown): v is string => typeof v === "string" &&
  v.length <= 40 && /^(0|[1-9]\d*)(\.\d+)?$/.test(v) && /[1-9]/.test(v);

export function canRequestInvoiceReview(operator: boolean, opened: boolean, flag: boolean,
  reason: string): boolean {
  return operator && opened && flag && reason.trim().length >= 3 && reason.trim().length <= 500;
}

export function readInvoiceReviewCandidates(value: unknown, tenant: string, actor: string): InvoiceReviewPage {
  if (!value || typeof value !== "object") throw Error("Invoice evidence unavailable");
  const v = value as Record<string, unknown>;
  if (v.version !== "quickbooks-invoice-review-candidates/1" ||
    v.audience !== "openfolk_operator_only" || v.tenant_id !== tenant ||
    v.actor_id !== actor || v.environment !== "production" ||
    typeof v.realm_id !== "string" || !/^[1-9]\d{0,29}$/.test(v.realm_id) ||
    typeof v.currency !== "string" || !/^[A-Z]{3}$/.test(v.currency) ||
    !date(v.as_of) || !iso(v.read_at) || !uuid(v.audit_id) ||
    !Number.isSafeInteger(v.eligible_count) || (v.eligible_count as number) < 0 ||
    !Array.isArray(v.candidates) || v.candidates.length > 20 ||
    (v.eligible_count as number) < v.candidates.length ||
    (v.newest_observed_at !== null && !iso(v.newest_observed_at))) {
    throw Error("Invoice evidence unavailable");
  }
  const readAt = Date.parse(v.read_at as string);
  const asOf = v.as_of as string;
  if (new Date(readAt).toISOString().slice(0,10) !== asOf ||
    (v.newest_observed_at && Date.parse(v.newest_observed_at as string) > readAt))
    throw Error("Invoice evidence unavailable");
  const candidates = v.candidates.map((raw: unknown): InvoiceReviewCandidate => {
    if (!raw || typeof raw !== "object") throw Error("Invoice evidence unavailable");
    const row = raw as Record<string, unknown>;
    if (typeof row.invoice_id !== "string" || !/^\d{1,30}$/.test(row.invoice_id) ||
      !uuid(row.source_version_id) ||
      (row.document_number !== null && (typeof row.document_number !== "string" || row.document_number.length > 200)) ||
      !positiveDecimal(row.balance) || row.currency !== v.currency ||
      !date(row.due_date) || row.due_date >= asOf ||
      !iso(row.source_updated_at) || !iso(row.source_observed_at) ||
      typeof row.source_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.source_sha256) ||
      Date.parse(row.source_updated_at) > readAt || Date.parse(row.source_observed_at) > readAt ||
      Date.parse(row.source_updated_at) < readAt - 30 * 86_400_000 ||
      Date.parse(row.source_observed_at) < readAt - 7 * 86_400_000 ||
      row.due_date < new Date(readAt - 30 * 86_400_000).toISOString().slice(0,10))
      throw Error("Invoice evidence unavailable");
    return { invoiceId:row.invoice_id, versionId:row.source_version_id,
      documentNumber:row.document_number, balance:row.balance, currency:row.currency,
      dueDate:row.due_date, sourceUpdatedAt:row.source_updated_at,
      sourceObservedAt:row.source_observed_at, sourceSha256:row.source_sha256 } as InvoiceReviewCandidate;
  });
  if (new Set(candidates.map((row)=>row.versionId)).size !== candidates.length ||
    candidates.some((row,index)=>index>0 && row.dueDate>candidates[index-1].dueDate))
    throw Error("Invoice evidence unavailable");
  return {realmId:v.realm_id, asOf, readAt:v.read_at, newestObservedAt:v.newest_observed_at,
    eligibleCount:v.eligible_count, candidates, auditId:v.audit_id} as InvoiceReviewPage;
}
