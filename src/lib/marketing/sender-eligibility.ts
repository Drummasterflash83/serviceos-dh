/** Pure sender-selection policy shared by campaigns and sequences. */

export interface LaunchEligibleSender {
  enabled: boolean;
  source_kind: "gmail_oauth" | "workspace_dwd" | "resend";
  readiness: {
    ready: boolean;
    state: string;
    sandbox?: boolean;
    campaigns_blocked?: boolean;
    sequences_blocked?: boolean;
    authority_state?: "verified" | "revoked" | "none" | null;
  };
}

function isSandbox(sender: LaunchEligibleSender): boolean {
  return sender.source_kind === "resend" && sender.readiness.state === "sandbox_ready";
}

/** True only when this sender may be selected for a production broadcast. */
export function senderCanLaunchCampaign(sender: LaunchEligibleSender): boolean {
  return (
    sender.enabled &&
    sender.readiness.ready &&
    sender.readiness.state === "ready" &&
    sender.readiness.campaigns_blocked !== true &&
    !isSandbox(sender)
  );
}

/** True only when this sender may be selected for an automated sequence. */
export function senderCanRunSequence(sender: LaunchEligibleSender): boolean {
  return (
    sender.enabled &&
    sender.readiness.ready &&
    sender.readiness.state === "ready" &&
    sender.readiness.sequences_blocked !== true &&
    !isSandbox(sender)
  );
}
