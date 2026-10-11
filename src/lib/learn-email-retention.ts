/** Counts of retained observations, never a claim about current provider coverage. */
export type EmailRetention = {
  version: "learn-email-retention/1";
  tenant_id: string;
  scope: "company";
  total: number;
  available: number;
  unavailable: number;
  unverified: number;
  unbound: number;
  archived_versions: number;
};
export function validEmailRetention(value: unknown, tenant: string): value is EmailRetention {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as EmailRetention;
  const counts = [
    "total",
    "available",
    "unavailable",
    "unverified",
    "unbound",
    "archived_versions",
  ] as const;
  return (
    v.version === "learn-email-retention/1" &&
    v.tenant_id === tenant &&
    v.scope === "company" &&
    Object.keys(v).every((k) => ["version", "tenant_id", "scope", ...counts].includes(k)) &&
    counts.every((k) => Number.isSafeInteger(v[k]) && v[k] >= 0) &&
    v.available + v.unavailable + v.unverified === v.total &&
    v.unbound <= v.unverified
  );
}
export function emailRetentionAction(v: EmailRetention): string {
  if (v.unavailable > 0)
    return "Captured copies remain retained. Review mailbox access and later capture results before treating these messages as deleted; provider unavailability does not establish a deletion time.";
  if (v.unverified > 0)
    return "Reconcile retained messages through their authorised mailboxes. Missing availability evidence does not mean the messages were deleted or that capture is complete.";
  if (v.total === 0)
    return "No retained emails were counted for this company. Verify mailbox setup and capture; this does not prove the provider mailbox is empty.";
  return "These emails were available at their last recorded observations. Check capture freshness and historical coverage separately.";
}
