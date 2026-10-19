const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const keys = ["invoice_latest","bill_latest","purchase_latest","qbo_job_customers",
  "bill_customer_line_refs","purchase_customer_line_refs","invoice_item_refs",
  "items_with_purchase_cost_field","invoices_with_checked_recurring_markers",
  "commusoft_job_versions","commusoft_jobs_with_checked_direct_cost_fields"] as const;
type CountKey = typeof keys[number];
export type MoneySourceReadiness = {
  realmId: string; environment: "production" | "sandbox"; readAt: string;
  latestObservedAt: string | null; auditId: string; retained: Record<CountKey,number>;
};

/** Reject any unexpected money value or source-scope change at the UI boundary. */
export function readMoneySourceReadiness(value: unknown, scope: {
  tenantId: string; connectionId: string; environment: "production" | "sandbox"; realmId: string;
}): MoneySourceReadiness {
  if (!object(value) || !object(value.retained) || !object(value.field_gp) || !object(value.arr) ||
    !Array.isArray(value.limits)) throw Error("money_readiness_invalid");
  const retained = value.retained, limits = value.limits;
  if (
    value.version !== "quickbooks-money-source-readiness/1" ||
    value.audience !== "openfolk_operator_only" || value.tenant_id !== scope.tenantId ||
    value.connection_id !== scope.connectionId || value.environment !== scope.environment ||
    value.realm_id !== scope.realmId || value.commusoft_scope !== "all_retained_tenant_connections" ||
    !uuid(value.audit_id) ||
    typeof value.read_at !== "string" || !Number.isFinite(Date.parse(value.read_at)) ||
    (value.latest_qbo_observed_at !== null &&
      (typeof value.latest_qbo_observed_at !== "string" || !Number.isFinite(Date.parse(value.latest_qbo_observed_at)))) ||
    value.field_gp.status !== "held" || value.arr.status !== "held" ||
    value.field_gp.reason !== "cross_provider_job_mapping_and_actual_cost_not_verified" ||
    value.arr.reason !== "recurring_contract_and_period_not_verified" ||
    Object.keys(retained).sort().join(",") !== [...keys].sort().join(",") ||
    !keys.every(key => count(retained[key])) || limits.length !== 4 ||
    !["field_presence_is_not_financial_value","customer_ref_is_not_commusoft_job_link",
      "item_purchase_cost_is_not_actual_job_cost","no_recurring_transaction_entity_in_current_import_adapter"]
      .every(limit => limits.includes(limit))) throw Error("money_readiness_invalid");
  return {realmId:scope.realmId,environment:scope.environment,readAt:value.read_at,
    latestObservedAt:value.latest_qbo_observed_at as string | null,auditId:value.audit_id,
    retained:retained as MoneySourceReadiness["retained"]};
}
