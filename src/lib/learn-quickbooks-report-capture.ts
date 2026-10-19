import type { QuickBooksConnection } from "./learn-quickbooks";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
/** The one-use report route cannot refresh an expired QuickBooks access token. */
export function reportCaptureConnectionReady(connection: QuickBooksConnection | undefined, now = Date.now()): boolean {
  if (!connection?.confirmedAt || !connection.realmId || !["active", "paused"].includes(connection.status)) return false;
  const expires = connection.accessExpiresAt ? Date.parse(connection.accessExpiresAt) : NaN;
  return Number.isFinite(expires) && expires > now + 120_000;
}
export function buildReportCaptureBody(input: {
  tenantId: string; connectionId: string; requestId: string; realmId: string;
  environment: "production" | "sandbox"; kind: "ProfitAndLoss" | "AgedReceivables";
  periodStart: string; periodEnd: string; accountingMethod: "Cash" | "Accrual";
  reportDate: string; reason: string;
}) {
  return { tenantId: input.tenantId, connectionId: input.connectionId, requestId: input.requestId,
    realmId: input.realmId, environment: input.environment, kind: input.kind,
    periodStart: input.kind === "ProfitAndLoss" ? input.periodStart : null,
    periodEnd: input.kind === "ProfitAndLoss" ? input.periodEnd : null,
    accountingMethod: input.kind === "ProfitAndLoss" ? input.accountingMethod : null,
    reportDate: input.kind === "AgedReceivables" ? input.reportDate : null,
    agingMethod: input.kind === "AgedReceivables" ? "Report_Date" : null,
    reason: input.reason.trim() };
}
export interface ReportCaptureReceipt {
  requestId: string; kind: "ProfitAndLoss" | "AgedReceivables"; environment: "production" | "sandbox";
  realmId: string; sha256: string; bytes: number; reportTime: string | null; currency: string | null; auditId: string;
  validationState: "verified" | "held"; validationCode: "format_invalid" | "report_name_mismatch" | "scope_mismatch" | null;
}
export function readReportCaptureReceipt(value: unknown, scope: {
  requestId: string; tenantId: string; realmId: string;
  environment: "production" | "sandbox"; kind: "ProfitAndLoss" | "AgedReceivables";
}): ReportCaptureReceipt {
  if (!object(value) || value.version !== "quickbooks-report-capture/1" ||
    value.request_id !== scope.requestId || value.tenant_id !== scope.tenantId ||
    value.realm_id !== scope.realmId || value.environment !== scope.environment || value.kind !== scope.kind ||
    !uuid(value.audit_id) || typeof value.response_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.response_sha256) ||
    !Number.isSafeInteger(value.response_bytes) || (value.response_bytes as number) < 1 || (value.response_bytes as number) > 2097152 ||
    (value.report_time !== null && (typeof value.report_time !== "string" || !Number.isFinite(Date.parse(value.report_time)))) ||
    (value.currency !== null && (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency))) ||
    !["verified", "held"].includes(String(value.validation_state)) ||
    (value.validation_state === "verified" && value.validation_code !== null) ||
    (value.validation_state === "held" && !["format_invalid", "report_name_mismatch", "scope_mismatch"].includes(String(value.validation_code))))
    throw Error("report_receipt_invalid");
  return { requestId: scope.requestId, kind: scope.kind, environment: scope.environment, realmId: scope.realmId,
    sha256: value.response_sha256, bytes: value.response_bytes as number,
    reportTime: value.report_time as string | null, currency: value.currency as string | null, auditId: value.audit_id,
    validationState: value.validation_state as "verified" | "held",
    validationCode: value.validation_code as ReportCaptureReceipt["validationCode"] };
}
