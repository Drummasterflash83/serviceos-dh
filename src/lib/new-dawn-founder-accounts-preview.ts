import { readReportSummaryPreview } from "./learn-quickbooks-report-summary.ts";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const sourceDate = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const sourceTime = (value: unknown): value is string => typeof value === "string" &&
  Number.isFinite(Date.parse(value));

export type AccountsPair = {
  profitRequest: string; receivablesRequest: string; periodStart: string;
  periodEnd: string; accountingMethod: "Accrual" | "Cash"; arAsOf: string;
  currency: string; realmId: string; profitReceivedAt: string;
  receivablesReceivedAt: string; profitSha256: string; receivablesSha256: string;
};

/** Metadata only: no source rows or amounts are returned by the candidate RPC. */
export function readFounderAccountsPairs(value: unknown, tenantId: string, actorId: string): AccountsPair[] {
  if (!object(value) || value.version !== "quickbooks-report-pair-candidates/1" ||
    value.audience !== "openfolk_operator_only" || value.tenant_id !== tenantId ||
    value.actor_id !== actorId || !uuid(value.audit_id) ||
    !Array.isArray(value.candidates) || value.candidates.length > 12) throw Error("accounts_pairs_invalid");
  const seen = new Set<string>();
  return value.candidates.map((row: unknown) => {
    if (!object(row) || !uuid(row.profit_request) || !uuid(row.receivables_request) ||
      row.profit_request === row.receivables_request || seen.has(row.profit_request) ||
      !sourceDate(row.period_start) || !sourceDate(row.period_end) ||
      row.period_start > row.period_end ||
      row.period_end > new Date().toISOString().slice(0,10) ||
      row.ar_as_of !== row.period_end ||
      !["Accrual", "Cash"].includes(String(row.accounting_method)) ||
      typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency) ||
      typeof row.realm_id !== "string" || !/^[1-9][0-9]{0,29}$/.test(row.realm_id) ||
      !sourceTime(row.profit_received_at) || !sourceTime(row.receivables_received_at) ||
      !sha(row.profit_sha256) || !sha(row.receivables_sha256)) throw Error("accounts_pairs_invalid");
    seen.add(row.profit_request);
    return { profitRequest:row.profit_request, receivablesRequest:row.receivables_request,
      periodStart:row.period_start, periodEnd:row.period_end,
      accountingMethod:row.accounting_method as "Accrual" | "Cash", arAsOf:row.ar_as_of,
      currency:row.currency, realmId:row.realm_id,
      profitReceivedAt:row.profit_received_at, receivablesReceivedAt:row.receivables_received_at,
      profitSha256:row.profit_sha256, receivablesSha256:row.receivables_sha256 };
  });
}

export function canReadFounderAccountsPreview(input: {
  operator: boolean; jobPreviewOpened: boolean; flagEnabled: boolean;
  pair: AccountsPair | null; reason: string; reviewed: boolean;
}) {
  return input.operator && input.jobPreviewOpened && input.flagEnabled && input.reviewed &&
    !!input.pair && input.reason.trim().length >= 3 && input.reason.trim().length <= 500;
}

export type FounderAccountsPreview = {
  currency: string; realmId: string; periodStart: string; periodEnd: string;
  accountingMethod: "Accrual" | "Cash"; arAsOf: string; profitSha256: string;
  receivablesSha256: string; auditId: string;
  profitReceivedAt: string; receivablesReceivedAt: string;
  accountsGrossProfit: string; netProfit: string;
  receivables: { current: string; days1To30: string; days31To60: string;
    days61To90: string; days91Plus: string; total: string };
};

/** Preserve source decimals exactly, including credits and different decimal scales. */
function reconcilesReceivables(buckets: string[], total: string): boolean {
  const values = [...buckets, total];
  if (values.length !== 6 || values.some(value => !/^-?\d{1,40}(\.\d{1,10})?$/.test(value))) return false;
  const scale = Math.max(...values.map(value => value.split(".")[1]?.length ?? 0));
  const units = values.map(value => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const amount = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
    return negative ? -amount : amount;
  });
  return units.slice(0, 5).reduce((sum, value) => sum + value, 0n) === units[5];
}

/** Project exact report figures from an explicitly selected, audited pair. */
export function readFounderAccountsPreview(value: unknown, tenantId: string,
  pair: AccountsPair, todayUtc = new Date().toISOString().slice(0, 10)): FounderAccountsPreview {
  const report = readReportSummaryPreview(value, {tenantId,
    profitRequest:pair.profitRequest, receivablesRequest:pair.receivablesRequest});
  if (!sourceDate(todayUtc) || report.environment !== "production" ||
      !sourceDate(report.periodStart) || !sourceDate(report.periodEnd) ||
      report.periodEnd > todayUtc || report.periodStart !== pair.periodStart ||
      report.periodEnd !== pair.periodEnd || report.arAsOf !== pair.arAsOf ||
      report.accountingMethod !== pair.accountingMethod || report.currency !== pair.currency ||
      report.realmId !== pair.realmId || report.profitSha256 !== pair.profitSha256 ||
      report.receivablesSha256 !== pair.receivablesSha256 ||
      !reconcilesReceivables([report.summary.arCurrent, report.summary.ar1To30,
        report.summary.ar31To60, report.summary.ar61To90, report.summary.ar91Plus],
        report.summary.arTotal))
    throw Error("accounts_preview_scope_held");
  return {currency:report.currency,realmId:report.realmId,periodStart:report.periodStart,
    periodEnd:report.periodEnd,accountingMethod:report.accountingMethod,arAsOf:report.arAsOf,
    profitSha256:report.profitSha256,receivablesSha256:report.receivablesSha256,
    profitReceivedAt:pair.profitReceivedAt,receivablesReceivedAt:pair.receivablesReceivedAt,
    auditId:report.auditId,accountsGrossProfit:report.summary.accountsGrossProfit,
    netProfit:report.summary.netProfit,
    receivables:{current:report.summary.arCurrent,days1To30:report.summary.ar1To30,
      days31To60:report.summary.ar31To60,days61To90:report.summary.ar61To90,
      days91Plus:report.summary.ar91Plus,total:report.summary.arTotal}};
}

/** The detailed age bands have their own operator-only switch. */
export function canShowReceivablesAgeing(input: {
  operator: boolean; flagEnabled: boolean; saved: FounderAccountsPreview | null;
}) {
  return input.operator && input.flagEnabled && input.saved !== null;
}

/** A positive net 91+ report bucket is a review cue, never an invoice or job claim. */
export function canShowAgedReceivablesReview(input: {
  operator: boolean; flagEnabled: boolean; saved: FounderAccountsPreview | null;
}) {
  const amount = input.saved?.receivables.days91Plus;
  return canShowReceivablesAgeing(input) && typeof amount === "string" &&
    /^[0-9]{1,40}(\.[0-9]{1,10})?$/.test(amount) && /[1-9]/.test(amount);
}

export function accountsPeriodCoverage(periodEnd: string, todayUtc = new Date().toISOString().slice(0, 10)) {
  if (!sourceDate(periodEnd) || !sourceDate(todayUtc) || periodEnd > todayUtc)
    throw Error("accounts_preview_scope_held");
  return periodEnd.slice(0, 7) === todayUtc.slice(0, 7)
    ? `This month through ${periodEnd}; later changes may be missing.`
    : `Historical period through ${periodEnd}; current-month figures are not shown.`;
}
