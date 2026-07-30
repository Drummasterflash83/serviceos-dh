// Marketing Broadcasts — typed client for the marketing-campaigns Edge
// Function (Phase 5). Every read/write goes through the authenticated
// function; the browser never sees launch challenges it did not request,
// unsubscribe tokens, provider payloads or credentials, and never talks to
// Gmail. Hidden controls are NOT the security boundary — the server enforces
// every permission again.

import { callMarketingFn } from "@/lib/marketing/call";
import type { ApiResult } from "@/lib/types";

const FN = "marketing-campaigns";

export type CampaignStatus =
  | "draft"
  | "review"
  | "approved"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "archived";

export interface CampaignListRow {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  version: number;
  owner_id: string | null;
  owner_email: string | null;
  sender_profile_id: string | null;
  sender_mailbox: string | null;
  segment_id: string | null;
  segment_name: string | null;
  revision_number: number | null;
  current_revision_id: string | null;
  schedule_local: string | null;
  timezone: string | null;
  schedule_at: string | null;
  snapshot: { id: string; included: number; excluded: number; created_at: string } | null;
  dispatch_counts: Record<string, number>;
  updated_at: string;
  created_at: string;
}

export interface CampaignListData {
  campaigns: CampaignListRow[];
  can_draft: boolean;
  can_test: boolean;
  can_launch: boolean;
  can_report: boolean;
  unsubscribe_configured: boolean;
}

export interface CampaignRevision {
  id: string;
  revision_number: number;
  sender_profile_id: string;
  segment_id: string;
  segment_version: number;
  subject: string;
  preview_text: string | null;
  body_authored: string;
  tokens_required: string[];
  token_fallbacks: Record<string, string>;
  content_hash: string;
  created_at: string;
}

export interface CampaignDetail {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  version: number;
  owner_id: string | null;
  schedule_local: string | null;
  timezone: string | null;
  schedule_at: string | null;
  schedule_fold: string | null;
  launched_at: string | null;
  approved_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  active_snapshot_id: string | null;
  revision: CampaignRevision | null;
  revisions: {
    id: string;
    revision_number: number;
    subject: string;
    created_at: string;
    content_hash: string;
  }[];
  approvals: {
    id: string;
    decision: "approved" | "changes_requested";
    revision_id: string;
    approver: string | null;
    note: string | null;
    created_at: string;
  }[];
  events: {
    seq: number;
    from: string | null;
    to: string;
    actor: string | null;
    detail: string | null;
    at: string;
  }[];
  snapshot: {
    id: string;
    created_at: string;
    candidate_count: number;
    included_count: number;
    excluded_count: number;
    exclusion_breakdown: Record<string, number>;
    snapshot_hash: string;
    settings_version: number;
    segment_version: number;
  } | null;
}

export interface PreflightResult {
  snapshot_id: string;
  snapshot_hash: string;
  created_at: string;
  candidate_count: number;
  included_count: number;
  excluded_count: number;
  exclusion_breakdown: Record<string, number>;
  included_samples: { destination_masked: string }[];
  excluded_samples: { destination_masked: string | null; reasons: string[] }[];
  revision_id: string;
  revision_hash: string;
  segment_version: number;
  settings_version: number;
  approval_id: string;
  campaign_version: number;
  confirmation_id: string;
  challenge: string;
  expires_at: string;
  max_bulk_recipients: number;
}

export interface CampaignReport {
  campaign_id: string;
  status: CampaignStatus;
  snapshot: {
    candidate: number;
    included: number;
    excluded: number;
    exclusion_breakdown: Record<string, number>;
  } | null;
  dispatch: Record<string, number>;
  unsubscribed: number;
  clicked: null;
  delivered: null;
  opened: null;
  replied: null;
  bounced: null;
  tracking: { enabled: boolean; state: string; note: string };
  submitted_meaning: string;
}

export interface RecipientRow {
  dispatch_id: string;
  status: string;
  generation: number;
  person_id: string;
  display_name: string | null;
  destination: string | null;
  skip_reason: string | null;
  failure_class: string | null;
  delivery_id: string | null;
  delivery_status: string | null;
  provider_message_id: string | null;
  submitted_at: string | null;
  prepared_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface BroadcastHealth {
  campaigns: Record<string, number>;
  queue_depth: number;
  oldest_pending_seconds: number | null;
  active_leases: number;
  expired_leases: number;
  dispatch_totals: Record<string, number>;
  unknown_needing_review: number;
  next_scheduled: string | null;
  in_quiet_hours: boolean;
}

export interface CampaignContentInput {
  name?: string;
  description?: string;
  sender_id?: string;
  segment_id?: string;
  subject?: string;
  preview_text?: string;
  body_authored?: string;
  token_fallbacks?: Record<string, string>;
}

export const listCampaigns = (limit = 50) =>
  callMarketingFn<CampaignListData>(FN, { action: "list", limit });

export const getCampaignDetail = (campaignId: string) =>
  callMarketingFn<CampaignDetail>(FN, { action: "detail", campaign_id: campaignId });

export const createCampaign = (input: CampaignContentInput) =>
  callMarketingFn<{ id: string; revision_id: string; status: CampaignStatus; version: number }>(
    FN,
    { action: "create", ...input },
  );

export const reviseCampaign = (
  campaignId: string,
  expectedVersion: number,
  changes: CampaignContentInput,
) =>
  callMarketingFn<{ id: string; revision_id: string; revision: number; version: number }>(FN, {
    action: "revise",
    campaign_id: campaignId,
    expected_version: expectedVersion,
    changes,
  });

export const duplicateCampaign = (campaignId: string) =>
  callMarketingFn<{ id: string }>(FN, { action: "duplicate", campaign_id: campaignId });

export const transitionCampaign = (
  action:
    "submit_review" | "request_changes" | "approve" | "pause" | "resume" | "cancel" | "archive",
  campaignId: string,
  expectedVersion: number,
  note?: string,
) =>
  callMarketingFn<{ id: string; status: CampaignStatus; version: number }>(FN, {
    action,
    campaign_id: campaignId,
    expected_version: expectedVersion,
    ...(note ? { note } : {}),
  });

export const previewAudience = (campaignId: string) =>
  callMarketingFn<{
    candidate_count: number | string;
    eligible_estimate?: number;
    excluded_estimate?: number;
    exclusion_breakdown?: Record<string, number>;
    segment_changed_since_revision?: boolean;
    capped: boolean;
    note: string;
  }>(FN, { action: "audience_preview", campaign_id: campaignId });

export const runPreflight = (campaignId: string, expectedVersion: number) =>
  callMarketingFn<PreflightResult>(FN, {
    action: "preflight",
    campaign_id: campaignId,
    expected_version: expectedVersion,
  });

export const launchCampaign = (args: {
  campaign_id: string;
  confirmation_id: string;
  challenge: string;
  request_id: string;
}) =>
  callMarketingFn<{
    id: string;
    status: CampaignStatus;
    version: number;
    dispatches_created: number;
    idempotent: boolean;
  }>(FN, { action: "launch", ...args });

export const scheduleCampaign = (args: {
  campaign_id: string;
  confirmation_id: string;
  challenge: string;
  request_id: string;
  schedule_local: string;
  timezone: string;
  fold?: "earlier" | "later";
}) =>
  callMarketingFn<{
    id: string;
    status: CampaignStatus;
    version: number;
    scheduled_at_utc: string;
  }>(FN, { action: "schedule", ...args });

export const sendCampaignTest = (args: {
  campaign_id: string;
  recipient_profile_id: string;
  request_id: string;
}) =>
  callMarketingFn<{ delivery_id: string; status: string; idempotent: boolean }>(FN, {
    action: "test_send",
    ...args,
  });

export const getCampaignReport = (campaignId: string) =>
  callMarketingFn<CampaignReport>(FN, { action: "report", campaign_id: campaignId });

export const getRecipientPage = (
  campaignId: string,
  cursor: { at: string; id: string } | null = null,
  limit = 25,
): Promise<
  ApiResult<{ recipients: RecipientRow[]; next_cursor: { at: string; id: string } | null }>
> =>
  callMarketingFn(FN, {
    action: "recipient_page",
    campaign_id: campaignId,
    limit,
    ...(cursor ? { cursor } : {}),
  });

export const getBroadcastHealth = () => callMarketingFn<BroadcastHealth>(FN, { action: "health" });

/** Browser-side request id: unique per click, stable across retries of the
 *  same submission attempt (the caller holds it while a request is in flight). */
export const newLaunchRequestId = () => `lnc-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
export const newCampaignTestRequestId = () =>
  `ctst-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

/** Display copy for exclusion reason codes (UI text, not policy). */
export const EXCLUSION_REASON_LABELS: Record<string, string> = {
  no_contact_point: "No usable email contact point",
  invalid_destination: "Invalid destination",
  unknown_preference: "No explicit subscribed preference",
  unsubscribed: "Unsubscribed",
  hard_suppression: "Hard suppression",
  duplicate_shared_destination: "Shared address (ambiguous target)",
  missing_personalisation: "Missing required personalisation",
};
