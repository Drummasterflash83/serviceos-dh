/** A narrow, tenant-bound read model for the retained QuickBooks owner view.
 * Values are exact decimal strings. No company P&L or job profitability is
 * inferred from invoices, and different currencies/realms are never added.
 */
export type OwnerMoneyScope = {
  tenant: string;
  actor: string;
  environment: "production" | "sandbox";
  operatorReason?: string;
};

export type OwnerMoneyGroup = {
  realm_id: string;
  currency: string | null;
  records: number;
  missing_balances: number;
  undated_positive: number;
  negative_balances: number;
  oldest_observed_at: string;
  newest_observed_at: string;
  newest_source_updated_at: string | null;
  outstanding: string | null;
  overdue: string | null;
  not_due: string | null;
  overdue_1_30: string | null;
  overdue_31_60: string | null;
  overdue_61_90: string | null;
  overdue_91_plus: string | null;
};

type Unavailable = { status: "unavailable"; reason: string };
type Withheld = { status: "withheld"; reason: string };
export type OwnerMoney = {
  version: "quickbooks-owner-money/1";
  tenant_id: string;
  actor_id: string;
  environment: "production" | "sandbox";
  operator_mode: boolean;
  coverage: "retained_unreconciled_invoices";
  source: "QuickBooks Online";
  as_of: string;
  read_at: string;
  audit_id: string;
  records: number;
  conflicted_records: number;
  groups: OwnerMoneyGroup[];
  accounts_gross_profit: Unavailable;
  field_gross_profit: Unavailable;
  net_profit: Withheld;
  arr: Unavailable;
  further_works: Unavailable;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const decimal = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" &&
    value.length <= 100 &&
    /^-?\d+(\.\d+)?$/.test(value));
const time = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const unavailable = (value: unknown, reason: string): value is Unavailable =>
  object(value) && value.status === "unavailable" && value.reason === reason;
const bad = () =>
  Error("QuickBooks owner money could not be verified. Refresh or ask OpenFolk to check access.");

export function readOwnerMoney(value: unknown, scope: OwnerMoneyScope): OwnerMoney {
  if (
    !object(value) ||
    !uuid(scope.tenant) ||
    !uuid(scope.actor) ||
    !["production", "sandbox"].includes(scope.environment) ||
    value.version !== "quickbooks-owner-money/1" ||
    value.tenant_id !== scope.tenant ||
    value.actor_id !== scope.actor ||
    value.environment !== scope.environment ||
    value.operator_mode !== (scope.operatorReason !== undefined) ||
    value.coverage !== "retained_unreconciled_invoices" ||
    value.source !== "QuickBooks Online" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(value.as_of)) ||
    !time(value.read_at) ||
    Math.abs(Date.now() - Date.parse(value.read_at)) > 60_000 ||
    !uuid(value.audit_id) ||
    !count(value.records) ||
    !count(value.conflicted_records) ||
    value.conflicted_records > value.records ||
    !Array.isArray(value.groups) ||
    !unavailable(value.accounts_gross_profit, "profit_and_loss_report_not_captured") ||
    !unavailable(value.field_gross_profit, "job_cost_mapping_not_verified") ||
    !object(value.net_profit) ||
    value.net_profit.status !== "withheld" ||
    value.net_profit.reason !== "owner_report_not_captured" ||
    !unavailable(value.arr, "recurrence_not_verified") ||
    !unavailable(value.further_works, "source_linkage_not_verified")
  ) throw bad();

  let groupedRecords = 0;
  const keys = new Set<string>();
  for (const group of value.groups) {
    if (
      !object(group) ||
      typeof group.realm_id !== "string" ||
      !/^[1-9]\d{0,29}$/.test(group.realm_id) ||
      !(group.currency === null ||
        (typeof group.currency === "string" && /^[A-Z]{3}$/.test(group.currency))) ||
      !count(group.records) ||
      group.records < 1 ||
      !count(group.missing_balances) ||
      !count(group.undated_positive) ||
      !count(group.negative_balances) ||
      group.missing_balances > group.records ||
      group.undated_positive > group.records ||
      group.negative_balances > group.records ||
      !time(group.oldest_observed_at) ||
      !time(group.newest_observed_at) ||
      Date.parse(group.oldest_observed_at) > Date.parse(group.newest_observed_at) ||
      !(group.newest_source_updated_at === null || time(group.newest_source_updated_at)) ||
      !["outstanding", "overdue", "not_due", "overdue_1_30", "overdue_31_60",
        "overdue_61_90", "overdue_91_plus"].every((field) => decimal(group[field])) ||
      ((group.currency === null || group.missing_balances > 0) &&
        group.outstanding !== null) ||
      ((group.currency === null || group.missing_balances > 0 ||
        group.undated_positive > 0) &&
        ["overdue", "not_due", "overdue_1_30", "overdue_31_60",
          "overdue_61_90", "overdue_91_plus"].some((field) => group[field] !== null))
    ) throw bad();
    const key = `${group.realm_id}/${group.currency ?? "unknown"}`;
    if (keys.has(key)) throw bad();
    keys.add(key);
    groupedRecords += group.records;
  }
  if (groupedRecords + value.conflicted_records !== value.records) throw bad();
  return value as OwnerMoney;
}
