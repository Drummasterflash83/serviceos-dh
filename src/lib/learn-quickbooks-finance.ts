export type FinanceScope = {
  tenant: string;
  actor: string;
  card: string;
  environment: "production" | "sandbox";
  operatorReason?: string;
};
export type FinanceRow = {
  version_id: string;
  realm_id: string;
  entity: string;
  external_id: string;
  document_number: string | null;
  transaction_date: string | null;
  due_date: string | null;
  currency: string | null;
  amount: string | null;
  balance: string | null;
  source_updated_at: string | null;
  last_observed_at: string;
};
export type FinanceGroup = {
  realm_id: string;
  currency: string | null;
  entity: string;
  records: number;
  missing_amounts: number;
  missing_balances: number;
  total: string | null;
  outstanding: string | null;
  oldest_observation: string;
  newest_observation: string;
};
export type FinancePage = {
  rows: FinanceRow[];
  groups: FinanceGroup[];
  next_after: string | null;
  records: number;
  linked_customers: number;
  links_needing_review: number;
  conflicted_records: number;
  observed_at: string;
};
export const financeEntities: Record<string, string> = {
  Invoice: "Invoices",
  Payment: "Payments received",
  CreditMemo: "Credit notes",
  SalesReceipt: "Sales receipts",
  Estimate: "Estimates",
};
export const financeUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const obj = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const time = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const text = (v: unknown, max = 2000): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const nullableText = (v: unknown, max: number) =>
  v === null || (typeof v === "string" && v.length <= max);
const money = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && v.length <= 100 && /^-?\d+(\.\d+)?$/.test(v));
const currency = (v: unknown) => v === null || (typeof v === "string" && /^[A-Z]{3}$/.test(v));
const bad = () =>
  Error("QuickBooks records could not be verified. Refresh or ask OpenFolk to check access.");
function envelope(p: any, scope: FinanceScope, after: string | null, version: string) {
  if (
    ![scope.tenant, scope.actor, scope.card].every(financeUuid) ||
    !obj(p) ||
    p.version !== version ||
    p.tenant_id !== scope.tenant ||
    p.actor_id !== scope.actor ||
    p.environment !== scope.environment ||
    !["production", "sandbox"].includes(scope.environment) ||
    p.after !== after ||
    (after !== null && !financeUuid(after)) ||
    !financeUuid(p.audit_id) ||
    !time(p.observed_at) ||
    Math.abs(Date.now() - Date.parse(p.observed_at)) > 60000 ||
    !Array.isArray(p.rows) ||
    p.rows.length > 25 ||
    (p.next_after !== null && !financeUuid(p.next_after))
  )
    throw bad();
}
export function readFinancePage(
  p: any,
  scope: FinanceScope,
  after: string | null = null,
): FinancePage {
  envelope(p, scope, after, "quickbooks-customer-finance/1");
  if (
    p.card_id !== scope.card ||
    p.operator_mode !== (scope.operatorReason !== undefined) ||
    p.coverage !== "retained_unreconciled_records" ||
    !Array.isArray(p.groups) ||
    ![p.records, p.linked_customers, p.links_needing_review, p.conflicted_records].every(count) ||
    p.links_needing_review > p.linked_customers ||
    p.records < p.rows.length
  )
    throw bad();
  let prior = after;
  for (const r of p.rows) {
    if (
      !obj(r) ||
      !financeUuid(r.version_id) ||
      (prior && r.version_id <= prior) ||
      !text(r.realm_id) ||
      !text(r.external_id) ||
      !Object.hasOwn(financeEntities, r.entity) ||
      !nullableText(r.document_number, 200) ||
      !nullableText(r.transaction_date, 32) ||
      !nullableText(r.due_date, 32) ||
      !currency(r.currency) ||
      !money(r.amount) ||
      !money(r.balance) ||
      (r.entity !== "Invoice" && r.balance !== null) ||
      !time(r.last_observed_at) ||
      (r.source_updated_at !== null && !time(r.source_updated_at))
    )
      throw bad();
    prior = r.version_id;
  }
  if (p.next_after !== null && (p.rows.length !== 25 || p.next_after !== prior)) throw bad();
  const keys = new Set<string>();
  let records = 0;
  for (const g of p.groups) {
    if (
      !obj(g) ||
      !text(g.realm_id) ||
      !currency(g.currency) ||
      !Object.hasOwn(financeEntities, g.entity) ||
      ![g.records, g.missing_amounts, g.missing_balances].every(count) ||
      g.records < 1 ||
      g.missing_amounts > g.records ||
      g.missing_balances > g.records ||
      !money(g.total) ||
      !money(g.outstanding) ||
      !time(g.oldest_observation) ||
      !time(g.newest_observation) ||
      Date.parse(g.oldest_observation) > Date.parse(g.newest_observation) ||
      (g.currency === null && (g.total !== null || g.outstanding !== null)) ||
      (g.missing_amounts > 0 && g.total !== null) ||
      (g.missing_balances > 0 && g.outstanding !== null) ||
      (g.entity !== "Invoice" && (g.outstanding !== null || g.missing_balances !== 0))
    )
      throw bad();
    const key = JSON.stringify([g.realm_id, g.currency, g.entity]);
    if (keys.has(key)) throw bad();
    keys.add(key);
    records += g.records;
  }
  if (records !== p.records) throw bad();
  return p;
}
export type FinanceCandidate = {
  version_id: string;
  realm_id: string;
  external_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  parent_id: string | null;
  conflicted: boolean;
  last_observed_at: string;
  card_id: string | null;
  revision: string;
};
export function readFinanceCandidates(
  p: any,
  scope: FinanceScope,
  after: string | null = null,
): { rows: FinanceCandidate[]; next_after: string | null } {
  envelope(p, scope, after, "quickbooks-customers/1");
  if (scope.operatorReason === undefined) throw bad();
  let prior = after;
  for (const r of p.rows) {
    if (
      !obj(r) ||
      !financeUuid(r.version_id) ||
      (prior && r.version_id <= prior) ||
      !text(r.realm_id) ||
      !text(r.external_id) ||
      !nullableText(r.name, 500) ||
      !nullableText(r.email, 500) ||
      !nullableText(r.phone, 200) ||
      !nullableText(r.address, 2000) ||
      !nullableText(r.parent_id, 200) ||
      typeof r.conflicted !== "boolean" ||
      !time(r.last_observed_at) ||
      (r.card_id !== null && !financeUuid(r.card_id)) ||
      typeof r.revision !== "string" ||
      !/^\d{1,19}$/.test(r.revision)
    )
      throw bad();
    prior = r.version_id;
  }
  if (p.next_after !== null && (p.rows.length !== 25 || p.next_after !== prior)) throw bad();
  return p;
}
/** Format the exact decimal string, never convert financial amounts to Number. */
export function financeAmount(value: string | null, code: string | null): string {
  if (!money(value) || value === null) return "Not available";
  const [whole, fraction] = value.split(".");
  return `${code ?? "Currency unverified"} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : "." + fraction}`;
}
