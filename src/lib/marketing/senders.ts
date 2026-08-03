// Marketing senders + governed test sends — typed client for the
// marketing-senders Edge Function (Phase 4). Reads/writes go through the
// authenticated function only; the browser never sees tokens, credentials or
// raw provider payloads, and never talks to Gmail.

import { callMarketingFn } from "@/lib/marketing/call";
import type { ApiResult } from "@/lib/types";

/** The canonical SQL readiness verdict (marketing_sender_readiness). */
export interface SenderReadiness {
  sender_id?: string;
  ready: boolean;
  state:
    | "ready"
    | "sandbox_ready"
    | "unavailable"
    | "source_disconnected"
    | "source_changed"
    | "source_inactive"
    | "auth_invalid"
    | "token_missing"
    | "send_scope_missing"
    | "send_scope_unverified"
    | "connection_inactive"
    | "unknown";
  enabled?: boolean;
  /** true only for the resend.dev sandbox identity */
  sandbox?: boolean;
  /** the sandbox may only send to the requesting actor themselves */
  test_to_self_only?: boolean;
  campaigns_blocked?: boolean;
  sequences_blocked?: boolean;
  /** never true today: no real Resend submission has been verified */
  provider_submission_verified?: boolean;
  transport?: "gmail" | "resend";
}

/**
 * The honest capability class of a configured sender — what it may actually do
 * right now. Derived from the canonical SQL verdict; never re-derived from
 * display state.
 */
export type SenderClass =
  | "gmail_verified"
  | "workspace_verified"
  | "resend_sandbox_test_ready"
  | "resend_production_verified"
  | "unavailable";

export function senderClass(s: {
  source_kind: SenderProfile["source_kind"];
  readiness: SenderReadiness;
}): SenderClass {
  const state = s.readiness.state;
  if (s.source_kind === "resend") {
    if (state === "sandbox_ready") return "resend_sandbox_test_ready";
    if (state === "ready") return "resend_production_verified";
    return "unavailable";
  }
  if (state !== "ready") return "unavailable";
  return s.source_kind === "gmail_oauth" ? "gmail_verified" : "workspace_verified";
}

export const SENDER_CLASS_LABEL: Record<SenderClass, string> = {
  gmail_verified: "Gmail verified sender",
  workspace_verified: "Workspace verified sender",
  resend_sandbox_test_ready: "Resend sandbox — test-ready",
  resend_production_verified: "Resend production verified",
  unavailable: "Unavailable / misconfigured",
};

/** Display-only remediation copy for a readiness state (UI text, not policy). */
export function senderRemediation(state: SenderReadiness["state"]): string | null {
  switch (state) {
    case "unavailable":
      return "This from-address is not usable. Only the resend.dev sandbox sender is permitted until a domain is verified in Resend.";
    case "source_disconnected":
      return "The source mailbox was removed — reconnect it or configure another sender.";
    case "source_changed":
      return "The source mailbox address changed — configure a new sender for it.";
    case "source_inactive":
      return "The source mailbox is not active — fix the connection in Email settings.";
    case "auth_invalid":
      return "Gmail authorisation has expired — reconnect the Gmail account.";
    case "token_missing":
      return "No stored Gmail authorisation — reconnect the Gmail account.";
    case "send_scope_missing":
      return "Send authorisation (gmail.send) is missing — re-authorise the account.";
    case "send_scope_unverified":
      return "Send authorisation has not been verified yet — run Verify send authorisation.";
    case "connection_inactive":
      return "This mailbox's Workspace connection is not active — re-test delegation in Email settings.";
    default:
      return null;
  }
}

export interface SenderProfile {
  id: string;
  source_kind: "gmail_oauth" | "workspace_dwd" | "resend";
  email_account_id: string | null;
  workspace_mailbox_id: string | null;
  mailbox_address: string;
  label: string;
  from_name: string | null;
  reply_to: string | null;
  signature_text: string | null;
  enabled: boolean;
  send_scope_state: "authorized" | "missing" | "unknown";
  scope_checked_at: string | null;
  last_verified_at: string | null;
  verification_note: string | null;
  created_at: string;
  updated_at: string;
  readiness: SenderReadiness;
}

export interface DiscoveredGmailAccount {
  source_kind: "gmail_oauth";
  source_id: string;
  email_address: string | null;
  display_name: string | null;
  status: string;
  auth_state: string;
  has_send_scope: boolean;
  scope_known: boolean;
  sender_profile_id: string | null;
}

export interface DiscoveredWorkspaceMailbox {
  source_kind: "workspace_dwd";
  source_id: string;
  email_address: string;
  display_name: string | null;
  status: string;
  sync_enabled: boolean;
  connection_id: string;
  connection_domain: string;
  connection_status: string;
  sender_profile_id: string | null;
}

export interface SendersOverview {
  sources: {
    gmail_accounts: DiscoveredGmailAccount[];
    workspace_mailboxes: DiscoveredWorkspaceMailbox[];
    workspace_connections: Array<{
      id: string;
      status: string;
      domain: string;
      last_verified_at: string | null;
      requested_scopes: string[];
      error_message: string | null;
    }>;
  };
  senders: SenderProfile[];
  default_sender_profile_id: string | null;
  marketing_enabled: boolean;
  capability_enabled: boolean;
  health: SenderHealth | null;
  operational_mode: string | null;
  mode_permits_send: boolean;
  required_send_scope: string;
  can_manage: boolean;
  can_test: boolean;
  /** the signed-in caller's own profile id — the ONLY legal sandbox recipient */
  viewer_profile_id: string | null;
  /** whether the platform Resend key is configured at all (never its value) */
  resend_key_configured: boolean;
}

export interface SenderHealth {
  senders_configured: number;
  senders_enabled: number;
  senders_authorized: number;
  default_sender_id: string | null;
  capability_enabled: boolean;
  deliveries: Record<string, number>;
  last_submitted_at: string | null;
  last_failed_at: string | null;
  unknown_needing_review: number;
  oldest_queued_seconds: number | null;
}

export interface TestRecipient {
  id: string;
  email: string;
  role: string;
}

export interface DeliveryEventRow {
  from: string | null;
  to: string;
  detail: string | null;
  at: string;
}

export interface TestDelivery {
  id: string;
  status: "queued" | "executing" | "submitted" | "failed" | "unknown";
  purpose: string;
  sender_profile_id: string;
  recipient_email: string;
  subject: string;
  request_id: string;
  correlation_id: string;
  content_hash: string;
  failure_class: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  submitted_at: string | null;
  created_at: string;
  intent_status: string | null;
  intent_attempts: number | null;
  events: DeliveryEventRow[];
}

const FN = "marketing-senders";

export const getSendersOverview = () =>
  callMarketingFn<SendersOverview>(FN, { action: "overview" });

export const listTestRecipients = () =>
  callMarketingFn<{ recipients: TestRecipient[] }>(FN, { action: "recipients" });

export const createSender = (args: {
  source_kind: "gmail_oauth" | "workspace_dwd";
  source_id: string;
  label?: string;
  from_name?: string;
  reply_to?: string;
  signature_text?: string;
}) => callMarketingFn<{ id: string; created: boolean }>(FN, { action: "sender_create", ...args });

// Resend SANDBOX sender: the resend.dev sandbox identity on the platform Resend
// key. NOT a verified address and NOT production-usable — it is test-to-self
// only (campaigns and sequences are refused), and it needs the operator to have
// configured RESEND_API_KEY before anything can be submitted at all.
export const createResendSender = (args: {
  from_address: string;
  label?: string;
  from_name?: string;
  reply_to?: string;
  signature_text?: string;
}) =>
  callMarketingFn<{ id: string; created: boolean; mailbox_address: string; enabled: boolean }>(FN, {
    action: "sender_create_resend",
    ...args,
  });

export const updateSender = (
  senderId: string,
  changes: Partial<Pick<SenderProfile, "label" | "from_name" | "reply_to" | "signature_text">>,
  expectedUpdatedAt: string,
) =>
  callMarketingFn<SenderProfile>(FN, {
    action: "sender_update",
    sender_id: senderId,
    changes,
    expected_updated_at: expectedUpdatedAt,
  });

export const setSenderEnabled = (senderId: string, enable: boolean, expectedUpdatedAt: string) =>
  callMarketingFn<{ id: string; enabled: boolean; default_cleared: boolean }>(FN, {
    action: enable ? "sender_enable" : "sender_disable",
    sender_id: senderId,
    expected_updated_at: expectedUpdatedAt,
  });

export const setDefaultSender = (senderId: string, expectedUpdatedAt: string) =>
  callMarketingFn<{ id: string; default: boolean }>(FN, {
    action: "sender_set_default",
    sender_id: senderId,
    expected_updated_at: expectedUpdatedAt,
  });

export const verifySender = (senderId: string) =>
  callMarketingFn<{
    id: string;
    send_scope_state: "authorized" | "missing" | "unknown";
    scope_checked_at: string;
    last_verified_at: string | null;
  }>(FN, { action: "sender_verify", sender_id: senderId });

export const requestTestSend = (args: {
  sender_id: string;
  recipient_profile_id: string;
  subject: string;
  body_text: string;
  request_id: string;
}): Promise<
  ApiResult<{ delivery_id: string; intent_id: string; status: string; idempotent: boolean }>
> => callMarketingFn(FN, { action: "test_send", ...args });

export const getTestSendStatus = (limit = 20) =>
  callMarketingFn<{ deliveries: TestDelivery[] }>(FN, { action: "test_status", limit });

/** Browser-side request id: unique per click, stable across retries of the
 *  same submission attempt (the caller holds it while a request is in flight). */
export const newTestSendRequestId = () =>
  `tst-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
