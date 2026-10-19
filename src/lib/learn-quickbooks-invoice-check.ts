const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const time = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
export interface InvoiceCheckCandidate {
  version_id: string;
  invoice_id: string;
  document_number: string | null;
  due_date: string;
  observed_at: string;
}
export interface InvoiceCheckCandidates {
  tenant_id: string;
  actor_id: string;
  connection_id: string;
  environment: "production" | "sandbox";
  realm_id: string;
  rows: InvoiceCheckCandidate[];
  audit_id: string;
  checked_at: string;
}
export interface InvoiceCheckOutcome {
  auditId: string;
  comparedAt: string;
  rows: { versionId: string; balanceMatches: boolean; dueDateMatches: boolean }[];
}
export function readInvoiceCheckCandidates(value: unknown, tenant: string, actor: string, connection: string): InvoiceCheckCandidates {
  if (!object(value) || value.version !== "quickbooks-invoice-candidates/1" ||
    value.tenant_id !== tenant || value.actor_id !== actor || value.connection_id !== connection ||
    !uuid(tenant) || !uuid(actor) || !uuid(connection) || !uuid(value.audit_id) ||
    !["production", "sandbox"].includes(String(value.environment)) ||
    typeof value.realm_id !== "string" || !/^[1-9][0-9]{0,29}$/.test(value.realm_id) ||
    !time(value.checked_at) || !Array.isArray(value.rows) || value.rows.length > 20)
    throw Error("Invoice candidates could not be verified.");
  const seen = new Set<string>();
  for (const row of value.rows) {
    if (!object(row) || !uuid(row.version_id) || seen.has(row.version_id) ||
      typeof row.invoice_id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(row.invoice_id) ||
      !(row.document_number === null || typeof row.document_number === "string" && row.document_number.length <= 80) ||
      typeof row.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.due_date) ||
      !time(row.observed_at)) throw Error("Invoice candidates could not be verified.");
    seen.add(row.version_id);
  }
  return value as unknown as InvoiceCheckCandidates;
}
export function readInvoiceCheckOutcome(value: unknown, scope: {
  tenant: string; realm: string; environment: "production" | "sandbox"; request: string; versions: string[];
}): InvoiceCheckOutcome {
  if (!object(value) || value.version !== "quickbooks-invoice-check/1" ||
    value.tenant_id !== scope.tenant || value.realm_id !== scope.realm || value.environment !== scope.environment ||
    value.request_id !== scope.request || !uuid(value.audit_id) || !time(value.compared_at) ||
    !Array.isArray(value.rows) || value.rows.length !== scope.versions.length) throw Error("Invoice check result is unconfirmed.");
  const rows = value.rows.map((row, i) => {
    if (!object(row) || row.version_id !== scope.versions[i] ||
      typeof row.balance_matches !== "boolean" || typeof row.due_date_matches !== "boolean")
      throw Error("Invoice check result is unconfirmed.");
    return { versionId: row.version_id as string, balanceMatches: row.balance_matches, dueDateMatches: row.due_date_matches };
  });
  return { auditId: value.audit_id, comparedAt: value.compared_at, rows };
}
