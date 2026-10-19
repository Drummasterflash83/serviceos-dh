const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const decimal = (value: unknown): value is string => typeof value === "string" &&
  /^-?[0-9]{1,40}(\.[0-9]{1,10})?$/.test(value);
const date = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export type ReportSummaryPreview = {
  realmId: string; environment: "production" | "sandbox"; currency: string;
  periodStart: string; periodEnd: string; accountingMethod: "Cash" | "Accrual";
  arAsOf: string; profitSha256: string; receivablesSha256: string; auditId: string;
  summary: { accountsGrossProfit: string; netProfit: string; arCurrent: string;
    ar1To30: string; ar31To60: string; ar61To90: string; ar91Plus: string; arTotal: string };
};

/** Validate the narrow audited RPC envelope; keep decimals as exact strings. */
export function readReportSummaryPreview(value: unknown, scope: {
  tenantId: string; profitRequest: string; receivablesRequest: string;
}): ReportSummaryPreview {
  if (!object(value) || !object(value.summary)) throw Error("report_summary_invalid");
  const summary = value.summary;
  if (
    value.version !== "quickbooks-report-summary-preview/1" ||
    value.audience !== "openfolk_operator_only" || value.tenant_id !== scope.tenantId ||
    value.profit_request !== scope.profitRequest || value.receivables_request !== scope.receivablesRequest ||
    !uuid(value.audit_id) || !sha(value.profit_sha256) || !sha(value.receivables_sha256) ||
    typeof value.realm_id !== "string" || !/^[1-9][0-9]{0,29}$/.test(value.realm_id) ||
    !["production", "sandbox"].includes(String(value.environment)) ||
    !date(value.period_start) || !date(value.period_end) || !date(value.ar_as_of) ||
    value.period_end !== value.ar_as_of || value.period_start > value.period_end ||
    !["Cash", "Accrual"].includes(String(value.accounting_method)) ||
    value.aging_method !== "Report_Date" || value.source !== "QuickBooks Online" ||
    value.scope !== "company_accounts_report_not_job_costing" ||
    typeof summary.currency !== "string" || !/^[A-Z]{3}$/.test(summary.currency) ||
    !["accounts_gross_profit", "net_profit", "ar_current", "ar_1_30", "ar_31_60", "ar_61_90", "ar_91_plus", "ar_total"]
      .every(key => decimal(summary[key]))) throw Error("report_summary_invalid");
  return { realmId:value.realm_id, environment:value.environment as "production" | "sandbox",
    currency:summary.currency, periodStart:value.period_start, periodEnd:value.period_end,
    accountingMethod:value.accounting_method as "Cash" | "Accrual", arAsOf:value.ar_as_of,
    profitSha256:value.profit_sha256, receivablesSha256:value.receivables_sha256, auditId:value.audit_id,
    summary:{accountsGrossProfit:summary.accounts_gross_profit as string,
      netProfit:summary.net_profit as string,arCurrent:summary.ar_current as string,
      ar1To30:summary.ar_1_30 as string,ar31To60:summary.ar_31_60 as string,
      ar61To90:summary.ar_61_90 as string,ar91Plus:summary.ar_91_plus as string,
      arTotal:summary.ar_total as string} };
}
