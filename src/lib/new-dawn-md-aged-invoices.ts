/** Saved QuickBooks invoice-source leads for an audited MD review, never a debt ledger. */
export type AgedInvoice = {
  invoiceId: string; versionId: string; documentNumber: string | null;
  balance: string; currency: string; dueDate: string;
  sourceUpdatedAt: string; sourceObservedAt: string; sourceSha256: string;
};
export type AgedInvoicePage = {
  asOf: string; readAt: string; realmId: string; eligibleCount: number;
  hasMore: boolean; candidates: AgedInvoice[]; auditId: string;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const date = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const time = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const amount = (v: unknown): v is string => typeof v === "string" &&
  v.length <= 40 && /^(0|[1-9]\d*)(?:\.\d+)?$/.test(v) && /[1-9]/.test(v);

export function readMdAgedInvoicePage(value: unknown, tenant: string, actor: string,
  after: Pick<AgedInvoice, "dueDate" | "versionId"> | null = null): AgedInvoicePage {
  if (!object(value) || value.version !== "new-dawn-md-aged-invoice-review/1" ||
    value.audience !== "openfolk_operator_only" || value.tenant_id !== tenant ||
    value.actor_id !== actor || value.environment !== "production" ||
    typeof value.realm_id !== "string" || !/^[1-9]\d{0,29}$/.test(value.realm_id) ||
    !date(value.as_of) || !time(value.read_at) || !uuid(value.audit_id) ||
    !Number.isSafeInteger(value.eligible_count) || (value.eligible_count as number) < 0 ||
    typeof value.has_more !== "boolean" || !Array.isArray(value.candidates) ||
    value.candidates.length > 20 || value.candidates.length > (value.eligible_count as number) ||
    new Date(value.read_at as string).toISOString().slice(0, 10) !== value.as_of)
    throw Error("Aged invoice evidence unavailable");
  const readAt = Date.parse(value.read_at as string);
  const latestDue = new Date(Date.parse((value.as_of as string) + "T00:00:00Z") -
    91 * 86_400_000).toISOString().slice(0, 10);
  const candidates = value.candidates.map((raw: unknown): AgedInvoice => {
    if (!object(raw) || typeof raw.invoice_id !== "string" ||
      !/^\d{1,30}$/.test(raw.invoice_id) || !uuid(raw.source_version_id) ||
      (raw.document_number !== null && (typeof raw.document_number !== "string" ||
        raw.document_number.length > 200)) || !amount(raw.balance) ||
      typeof raw.currency !== "string" || !/^[A-Z]{3}$/.test(raw.currency) ||
      !date(raw.due_date) || raw.due_date > latestDue ||
      !time(raw.source_updated_at) || !time(raw.source_observed_at) ||
      Date.parse(raw.source_updated_at as string) > readAt ||
      Date.parse(raw.source_observed_at as string) > readAt ||
      Date.parse(raw.source_observed_at as string) < readAt - 7 * 86_400_000 ||
      typeof raw.source_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.source_sha256))
      throw Error("Aged invoice evidence unavailable");
    return {
      invoiceId: raw.invoice_id, versionId: raw.source_version_id,
      documentNumber: raw.document_number as string | null,
      balance: raw.balance, currency: raw.currency, dueDate: raw.due_date,
      sourceUpdatedAt: raw.source_updated_at, sourceObservedAt: raw.source_observed_at,
      sourceSha256: raw.source_sha256,
    };
  });
  if (value.has_more && candidates.length !== 20 ||
    new Set(candidates.map(row => row.versionId)).size !== candidates.length ||
    candidates.some((row, index) => index > 0 &&
      (row.dueDate < candidates[index - 1].dueDate ||
        (row.dueDate === candidates[index - 1].dueDate &&
          row.versionId <= candidates[index - 1].versionId))) ||
    (after && candidates.some(row => row.dueDate < after.dueDate ||
      row.dueDate === after.dueDate && row.versionId <= after.versionId)))
    throw Error("Aged invoice evidence unavailable");
  return {
    asOf: value.as_of as string, readAt: value.read_at as string,
    realmId: value.realm_id as string, eligibleCount: value.eligible_count as number,
    hasMore: value.has_more, candidates, auditId: value.audit_id as string,
  };
}
