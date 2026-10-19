const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^-?\d{1,40}(\.\d{1,10})?$/.test(value);

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
  auditId: string;
};

/** Accept only the reviewed owner RPC envelope. Amounts remain decimal strings. */
export function readPublishedOwnerAccounts(value: unknown, tenant: string): PublishedOwnerAccounts {
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
    value.period_start > value.period_end ||
    value.period_end !== value.ar_as_of ||
    !["Cash", "Accrual"].includes(String(value.accounting_method)) ||
    typeof value.currency !== "string" ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    !Number.isSafeInteger(value.publication_revision) ||
    (value.publication_revision as number) < 1 ||
    !decimal(value.accounts_gross_profit) ||
    !decimal(value.net_profit) ||
    !["current", "age_1_30", "age_31_60", "age_61_90", "age_91_plus", "total"].every((key) =>
      decimal(aged[key]),
    ) ||
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
