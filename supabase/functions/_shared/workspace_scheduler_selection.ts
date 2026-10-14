/** Match the worker's saved mailbox authority before scheduling a capture.
 * A removed, disabled or ambiguous mailbox must remain visible as a coverage
 * exception, but must not generate another job that the worker will deny.
 */
export type WorkspaceScheduleAccount = {
  id: string;
  tenant_id: string;
  email_address: string;
};
export type WorkspaceScheduleMailbox = {
  tenant_id: string;
  email_address: string;
  status: string;
  sync_enabled: boolean;
  mailbox_type: string | null;
  directory_identity_conflict: boolean | null;
};

export function isWorkspaceMailboxEligible(
  account: WorkspaceScheduleAccount,
  mailboxes: WorkspaceScheduleMailbox[],
): boolean {
  const address = account.email_address?.toLowerCase();
  if (!address || !address.includes("@")) return false;
  const matches = mailboxes.filter(
    (m) =>
      m.tenant_id === account.tenant_id &&
      typeof m.email_address === "string" &&
      m.email_address.toLowerCase() === address,
  );
  return (
    matches.length === 1 &&
    matches[0].sync_enabled === true &&
    ["pending", "active"].includes(matches[0].status) &&
    matches[0].mailbox_type !== "suspended" &&
    matches[0].directory_identity_conflict !== true
  );
}
