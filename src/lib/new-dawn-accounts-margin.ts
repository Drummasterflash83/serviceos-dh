import type { AccountsPair, FounderAccountsPreview } from "./new-dawn-founder-accounts-preview.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const amount = (value: unknown): value is string => typeof value === "string" &&
  /^-?\d{1,40}(\.\d{1,10})?$/.test(value);
const percentage = (value: unknown): value is string => typeof value === "string" &&
  /^-?\d{1,42}(\.\d{1,2})?$/.test(value);

/** Check the server's two-decimal percentage using integer decimal arithmetic. */
function reconcilesPercentage(gp: string, income: string, percent: string) {
  const scale=Math.max(gp.split(".")[1]?.length??0,income.split(".")[1]?.length??0);
  const units=(value:string)=>{
    const negative=value.startsWith("-");
    const [whole,fraction=""]=(negative?value.slice(1):value).split(".");
    const result=BigInt(whole)*10n**BigInt(scale)+BigInt(fraction.padEnd(scale,"0")||"0");
    return negative?-result:result;
  };
  const denominator=units(income),numerator=units(gp)*10000n;
  if(denominator<=0n)return false;
  const rounded=(numerator<0n?-1n:1n)*
    ((numerator<0n?-numerator:numerator)+denominator/2n)/denominator;
  const sign=percent.startsWith("-")?-1n:1n;
  const [whole,fraction=""]=(sign<0n?percent.slice(1):percent).split(".");
  const claimed=sign*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0")||"0"));
  return rounded===claimed;
}

export type AccountsMarginPreview = {
  totalIncome: string;
  accountsGrossProfit: string;
  accountsGrossMarginPct: string;
  auditId: string;
  reportSummaryAuditId: string;
};

/** Never accept a client, another actor's pair, or an unreviewed target claim. */
export function readAccountsMarginPreview(value: unknown, scope: {
  tenant: string; actor: string; pair: AccountsPair; saved: FounderAccountsPreview;
}): AccountsMarginPreview {
  if (!record(value) ||
    Object.keys(value).some(key => !new Set([
      "version", "audience", "tenant_id", "actor_id", "source", "scope",
      "realm_id", "environment", "currency", "profit_request", "receivables_request",
      "profit_sha256", "receivables_sha256", "period_start", "period_end",
      "accounting_method", "total_income", "accounts_gross_profit",
      "accounts_gross_margin_pct", "denominator", "target_comparison", "audit_id",
      "report_summary_audit_id",
    ]).has(key)) ||
    value.version !== "quickbooks-accounts-margin-preview/1" ||
    value.audience !== "openfolk_operator_only" ||
    value.tenant_id !== scope.tenant || value.actor_id !== scope.actor ||
    value.source !== "QuickBooks Online" ||
    value.scope !== "company_accounts_not_job_margin" ||
    value.environment !== "production" || value.realm_id !== scope.pair.realmId ||
    value.currency !== scope.saved.currency ||
    value.profit_request !== scope.pair.profitRequest ||
    value.receivables_request !== scope.pair.receivablesRequest ||
    value.profit_sha256 !== scope.saved.profitSha256 ||
    value.receivables_sha256 !== scope.saved.receivablesSha256 ||
    value.period_start !== scope.saved.periodStart ||
    value.period_end !== scope.saved.periodEnd ||
    value.accounting_method !== scope.saved.accountingMethod ||
    value.denominator !== "QuickBooks Total Income" ||
    value.target_comparison !== "withheld_unconfirmed_accounts_or_field_basis" ||
    !amount(value.total_income) || /^0+(\.0+)?$/.test(value.total_income) ||
    value.total_income.startsWith("-") ||
    !amount(value.accounts_gross_profit) ||
    value.accounts_gross_profit !== scope.saved.accountsGrossProfit ||
    !percentage(value.accounts_gross_margin_pct) ||
    !reconcilesPercentage(value.accounts_gross_profit,value.total_income,
      value.accounts_gross_margin_pct) ||
    !uuid(value.audit_id) || !uuid(value.report_summary_audit_id))
    throw Error("accounts_margin_invalid");
  return {
    totalIncome: value.total_income,
    accountsGrossProfit: value.accounts_gross_profit,
    accountsGrossMarginPct: value.accounts_gross_margin_pct,
    auditId: value.audit_id,
    reportSummaryAuditId: value.report_summary_audit_id,
  };
}
