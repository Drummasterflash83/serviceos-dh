const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^-?\d{1,40}(\.\d{1,10})?$/.test(value);
const ageKeys = ["current", "age_1_30", "age_31_60", "age_61_90", "age_91_plus"] as const;

/** The source SQL checks this too; keep the browser projection exact. */
function ageingBalances(aged: Record<string, unknown>): boolean {
  if (![...ageKeys, "total"].every((key) => decimal(aged[key]))) return false;
  const values = [...ageKeys, "total"].map((key) => aged[key] as string);
  const scale = Math.max(...values.map((value) => value.split(".")[1]?.length ?? 0));
  const units = values.map((value) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const exact = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
    return negative ? -exact : exact;
  });
  return units.slice(0, 5).reduce((sum, value) => sum + value, 0n) === units[5];
}

export type OwnerAccountsGate = {
  tenant: string;
  userId: string | null;
  profileTenant: string | null;
  role: string | null;
  operator: boolean;
  platformAuthorityCleared: boolean;
  flagEnabled: boolean;
};

/** Client-side fail closed; the SQL RPC independently repeats every authority check. */
export function canReadPublishedOwnerAccounts(input: OwnerAccountsGate): boolean {
  return (
    uuid(input.tenant) &&
    uuid(input.userId) &&
    input.profileTenant === input.tenant &&
    input.role === "owner" &&
    !input.operator &&
    input.platformAuthorityCleared &&
    input.flagEnabled
  );
}

export type PublishedOwnerAccounts = {
  currency: string;
  realmId: string;
  periodStart: string;
  periodEnd: string;
  accountingMethod: "Cash" | "Accrual";
  arAsOf: string;
  revision: number;
  accountsGrossProfit: string;
  netProfit: string;
  receivables: {
    current: string;
    days1To30: string;
    days31To60: string;
    days61To90: string;
    days91Plus: string;
    total: string;
  };
  auditId: string;
};

/** Calendar coverage only; this does not certify when QuickBooks last changed. */
export function ownerReportCoverage(report: PublishedOwnerAccounts, todayUtc: string) {
  if (!date(todayUtc) || report.periodEnd > todayUtc) throw Error("owner_accounts_future_period");
  return report.periodEnd.slice(0, 7) === todayUtc.slice(0, 7)
    ? {
        state: "current_month_snapshot" as const,
        message: `The reviewed report reaches ${report.periodEnd}; later changes may not be included.`,
      }
    : {
        state: "historical_period" as const,
        message: `The reviewed report ends ${report.periodEnd}; current-month figures are not shown here.`,
      };
}

/** Accept only the reviewed owner RPC envelope. Amounts remain decimal strings. */
export function readPublishedOwnerAccounts(
  value: unknown,
  tenant: string,
  todayUtc = new Date().toISOString().slice(0, 10),
): PublishedOwnerAccounts {
  if (!object(value)) throw Error("owner_accounts_invalid");
  const aged = value.aged_receivables;
  const field = value.field_gross_profit;
  const arr = value.arr;
  if (
    !object(aged) ||
    !object(field) ||
    !object(arr) ||
    !exactKeys(value, [
      "version",
      "audience",
      "tenant_id",
      "source",
      "scope",
      "realm_id",
      "period_start",
      "period_end",
      "accounting_method",
      "ar_as_of",
      "currency",
      "publication_revision",
      "accounts_gross_profit",
      "net_profit",
      "aged_receivables",
      "field_gross_profit",
      "arr",
      "audit_id",
    ]) ||
    !exactKeys(aged, ["current", "age_1_30", "age_31_60", "age_61_90", "age_91_plus", "total"]) ||
    !exactKeys(field, ["status", "reason"]) ||
    !exactKeys(arr, ["status", "reason"]) ||
    value.version !== "owner-accounts-report/1" ||
    value.audience !== "client_owner_only" ||
    value.tenant_id !== tenant ||
    value.source !== "QuickBooks Online" ||
    value.scope !== "published_company_accounts_not_job_costing" ||
    typeof value.realm_id !== "string" ||
    !/^[1-9][0-9]{0,29}$/.test(value.realm_id) ||
    !date(value.period_start) ||
    !date(value.period_end) ||
    !date(value.ar_as_of) ||
    !date(todayUtc) ||
    value.period_start > value.period_end ||
    value.period_end !== value.ar_as_of ||
    value.period_end > todayUtc ||
    !["Cash", "Accrual"].includes(String(value.accounting_method)) ||
    typeof value.currency !== "string" ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    !Number.isSafeInteger(value.publication_revision) ||
    (value.publication_revision as number) < 1 ||
    !decimal(value.accounts_gross_profit) ||
    !decimal(value.net_profit) ||
    !ageingBalances(aged) ||
    field.status !== "held" ||
    field.reason !== "job_cost_mapping_not_verified" ||
    arr.status !== "held" ||
    arr.reason !== "recurring_contract_not_verified" ||
    !uuid(value.audit_id)
  )
    throw Error("owner_accounts_invalid");
  return {
    currency: value.currency,
    realmId: value.realm_id,
    periodStart: value.period_start,
    periodEnd: value.period_end,
    accountingMethod: value.accounting_method as "Cash" | "Accrual",
    arAsOf: value.ar_as_of,
    revision: value.publication_revision as number,
    accountsGrossProfit: value.accounts_gross_profit,
    netProfit: value.net_profit,
    receivables: {
      current: aged.current as string,
      days1To30: aged.age_1_30 as string,
      days31To60: aged.age_31_60 as string,
      days61To90: aged.age_61_90 as string,
      days91Plus: aged.age_91_plus as string,
      total: aged.total as string,
    },
    auditId: value.audit_id,
  };
}

/** A denied or off-flag UI path must never invoke the RPC. */
export async function requestPublishedOwnerAccounts(
  gate: OwnerAccountsGate,
  read: (tenant: string) => Promise<unknown>,
): Promise<PublishedOwnerAccounts> {
  if (!canReadPublishedOwnerAccounts(gate)) throw Error("owner_accounts_denied");
  return readPublishedOwnerAccounts(await read(gate.tenant), gate.tenant);
}
