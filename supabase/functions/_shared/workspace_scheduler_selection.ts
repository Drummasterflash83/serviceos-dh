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
export type WorkspaceScheduleCheckpoint = {
  tenant_id: string;
  email_account_id: string;
  generation: string;
  revision: number;
  state: string;
  block_code: string | null;
};

export type WorkspaceProfileProof = {
  status: string;
  created_at: string;
  detail: {
    code?: string;
    checkpoint_generation?: string;
    checkpoint_revision?: string | number;
    mailbox_content_read?: boolean;
    request_audit_id?: string;
  } | null;
};

/** A proof only makes scheduling possible; the claim protocol independently
 * verifies the paired request audit, current binding, revision and authority. */
export function isCurrentWorkspaceProfileProof(
  checkpoint: WorkspaceScheduleCheckpoint,
  proof: WorkspaceProfileProof | null,
  nowMs: number,
): boolean {
  const createdMs = Date.parse(proof?.created_at ?? "");
  return checkpoint.state === "blocked" &&
    checkpoint.block_code === "admin_delegation_missing" &&
    proof?.status === "success" &&
    proof.detail?.code === "provider_verified" &&
    proof.detail.checkpoint_generation === checkpoint.generation &&
    (typeof proof.detail.checkpoint_revision === "number" &&
      Number.isSafeInteger(proof.detail.checkpoint_revision) ||
      typeof proof.detail.checkpoint_revision === "string" &&
      /^\d+$/.test(proof.detail.checkpoint_revision)) &&
    String(proof.detail.checkpoint_revision) === String(checkpoint.revision) &&
    proof.detail.mailbox_content_read === false &&
    typeof proof.detail.request_audit_id === "string" &&
    Number.isFinite(createdMs) && createdMs >= nowMs - 60 * 60 * 1000 &&
    createdMs <= nowMs + 5000;
}

/** A blocked recent checkpoint needs its existing recovery protocol, not a new
 * capture job that is guaranteed to fail before reading the provider. */
export function isWorkspaceRecentCaptureHeld(
  account: WorkspaceScheduleAccount,
  checkpoints: WorkspaceScheduleCheckpoint[],
  profileProof: WorkspaceProfileProof | null = null,
  nowMs = Date.now(),
): boolean {
  return checkpoints.some(
    (checkpoint) => checkpoint.tenant_id === account.tenant_id &&
      checkpoint.email_account_id === account.id && checkpoint.state === "blocked" &&
      !isCurrentWorkspaceProfileProof(checkpoint, profileProof, nowMs),
  );
}

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
