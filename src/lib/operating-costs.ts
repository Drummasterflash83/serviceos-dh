export type CostCheck = {
  observed_at: string;
  balance: number | null;
  period_spend: number | null;
  period_start: string | null;
  period_end: string | null;
  auto_reload: "unknown" | "on" | "off";
  payment_status: "unknown" | "okay" | "failed";
  source: "dashboard" | "invoice";
  evidence: string;
};
export type CostAccount = {
  id: string;
  provider: string;
  name: string;
  account_ref: string;
  currency: "USD" | "GBP" | "EUR";
  billing_mode: "prepaid" | "invoiced";
  low_balance: number;
  stale_hours: number;
  version: number;
  clients: { id: string; name: string }[];
  latest: CostCheck | null;
};
export function costHealth(a: CostAccount, now = Date.now()) {
  const s = a.latest;
  if (!s)
    return {
      tone: "waiting",
      label: "First check needed",
      action: "Check the provider dashboard.",
    };
  if (s.payment_status === "failed")
    return {
      tone: "urgent",
      label: "Payment needs attention",
      action: "Resolve the payment with the provider.",
    };
  if (a.billing_mode === "prepaid" && s.balance !== null && s.balance <= 0)
    return {
      tone: "urgent",
      label: "No credit at last check",
      action: "Check service access and add approved credit.",
    };
  if (a.billing_mode === "prepaid" && s.balance !== null && s.balance <= a.low_balance)
    return {
      tone: "urgent",
      label: "Credit running low",
      action: "Check the balance and arrange approved funding.",
    };
  const time = Date.parse(s.observed_at);
  if (!Number.isFinite(time) || time > now || now - time > a.stale_hours * 3600000)
    return {
      tone: "waiting",
      label: "Balance check due",
      action: "Refresh the recorded figures from the provider.",
    };
  if ((a.billing_mode === "prepaid" && s.balance === null) || s.payment_status === "unknown")
    return {
      tone: "waiting",
      label: "Funding check incomplete",
      action: "Confirm the balance and payment status.",
    };
  return {
    tone: "clear",
    label: "No funding issue recorded",
    action: "Based on the last manual check; not a service-uptime guarantee.",
  };
}
export function costMoney(value: number | null, currency: string) {
  return value === null || !Number.isFinite(value)
    ? "Awaiting data"
    : new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);
}
