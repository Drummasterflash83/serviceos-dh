import { readReportSummaryPreview } from "./learn-quickbooks-report-summary.ts";

const uuid = (value: string) => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

export function canReadFounderAccountsPreview(input: {
  operator: boolean; jobPreviewOpened: boolean; flagEnabled: boolean;
  profitRequest: string; receivablesRequest: string; reason: string; reviewed: boolean;
}) {
  return input.operator && input.jobPreviewOpened && input.flagEnabled && input.reviewed &&
    uuid(input.profitRequest) && uuid(input.receivablesRequest) &&
    input.profitRequest !== input.receivablesRequest &&
    input.reason.trim().length >= 3 && input.reason.trim().length <= 500;
}

export type FounderAccountsPreview = {
  currency: string; realmId: string; periodStart: string; periodEnd: string;
  accountingMethod: "Accrual"; arAsOf: string; profitSha256: string;
  receivablesSha256: string; auditId: string;
  accountsGrossProfit: string; netProfit: string;
};

/** September 2026 saved accounts evidence only; the server owns tenant/actor access.
 * Drop A/R money from this P&L-only React projection after strict validation.
 */
export function readSeptemberFounderAccountsPreview(value: unknown, scope: {
  tenantId: string; profitRequest: string; receivablesRequest: string;
}): FounderAccountsPreview {
  const report = readReportSummaryPreview(value, scope);
  if (report.environment !== "production" || report.periodStart !== "2026-09-01" ||
      report.periodEnd !== "2026-09-30" || report.accountingMethod !== "Accrual" ||
      report.arAsOf !== "2026-09-30") throw Error("accounts_preview_scope_held");
  return {currency:report.currency,realmId:report.realmId,periodStart:report.periodStart,
    periodEnd:report.periodEnd,accountingMethod:"Accrual",arAsOf:report.arAsOf,
    profitSha256:report.profitSha256,receivablesSha256:report.receivablesSha256,
    auditId:report.auditId,accountsGrossProfit:report.summary.accountsGrossProfit,
    netProfit:report.summary.netProfit};
}
