// Marketing Sequences — typed client for the marketing-sequences Edge
// Function (Phase 6). Every read/write goes through the authenticated
// function; the browser never sees activation challenges it did not request,
// unsubscribe tokens, provider payloads or credentials, and never talks to
// Gmail. Hidden controls are NOT the security boundary — the server enforces
// every permission again.

import { callMarketingFn } from "@/lib/marketing/call";
import type { ApiResult } from "@/lib/types";

const FN = "marketing-sequences";

export type SequenceStatus =
  | "draft"
  | "review"
  | "approved"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "archived";

export type StepType =
  | "send_email"
  | "wait_duration"
  | "wait_until_window"
  | "apply_tag"
  | "remove_tag"
  | "change_lifecycle"
  | "assign_owner"
  | "create_follow_up";

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  send_email: "Send email",
  wait_duration: "Wait for a duration",
  wait_until_window: "Wait until a local-time window",
  apply_tag: "Apply tag",
  remove_tag: "Remove tag",
  change_lifecycle: "Change lifecycle",
  assign_owner: "Assign owner",
  create_follow_up: "Create follow-up",
};

export interface SequenceStepInput {
  key?: string;
  type: StepType;
  config: Record<string, unknown>;
}

export interface SequenceStep {
  id: string;
  order: number;
  key: string;
  type: StepType;
  config: Record<string, unknown>;
  summary: string;
  config_hash: string;
}

export interface SequenceListRow {
  id: string;
  name: string;
  description: string | null;
  status: SequenceStatus;
  version: number;
  owner_id: string | null;
  owner_email: string | null;
  closed_at: string | null;
  sender_profile_id: string | null;
  sender_mailbox: string | null;
  revision_id: string | null;
  revision_number: number | null;
  step_count: number | null;
  timezone: string | null;
  entry_policy: string | null;
  reenrolment_policy: string | null;
  enrolment_counts: Record<string, number>;
  exit_counts: Record<string, number>;
  next_due_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface SequenceListData {
  sequences: SequenceListRow[];
  can_draft: boolean;
  can_launch: boolean;
  can_report: boolean;
  unsubscribe_configured: boolean;
  scheduler_configured: boolean;
  /** false when this platform has no ('core','Action') state machine, so a
   *  follow-up step would author work nobody could ever progress. */
  follow_up_available: boolean;
}

export interface SequenceRevision {
  id: string;
  revision_number: number;
  sender_profile_id: string;
  timezone: string;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  entry_policy: string;
  reenrolment_policy: string;
  exit_rules: Record<string, unknown>;
  policy_block_action: string;
  step_count: number;
  bundle_hash: string;
  tokens_required: string[];
  created_at: string;
}

export interface SequenceDetail {
  id: string;
  name: string;
  description: string | null;
  status: SequenceStatus;
  version: number;
  owner_id: string | null;
  closed_at: string | null;
  approved_at: string | null;
  launched_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  unsubscribe_base_configured: boolean;
  revision: SequenceRevision | null;
  steps: SequenceStep[];
  revisions: {
    id: string;
    revision_number: number;
    step_count: number;
    created_at: string;
    bundle_hash: string;
    live_enrolments: number;
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
  batches: {
    id: string;
    source: "manual" | "segment";
    candidate_count: number;
    eligible_count: number;
    excluded_count: number;
    exclusion_breakdown: Record<string, number>;
    enrolled_count: number | null;
    confirmed_at: string | null;
    created_at: string;
  }[];
}

export interface ActivationPreflight {
  confirmation_id: string;
  challenge: string;
  expires_at: string;
  revision_id: string;
  revision_number: number;
  bundle_hash: string;
  campaign_version: number;
  step_count: number;
  email_steps: number;
  timezone: string;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  exit_rules: Record<string, unknown>;
  approval_id: string;
}

export interface EnrolmentPreflight {
  batch_id: string;
  batch_hash: string;
  candidate_count: number;
  eligible_count: number;
  excluded_count: number;
  exclusion_breakdown: Record<string, number>;
  included_samples: { destination_masked: string }[];
  excluded_samples: { destination_masked: string | null; reasons: string[] }[];
  revision_id: string;
  revision_number: number;
  segment_version: number | null;
  source: "manual" | "segment";
  confirmation_id: string;
  challenge: string;
  expires_at: string;
  max_sequence_enrolments: number;
}

export interface SequenceReport {
  campaign_id: string;
  status: SequenceStatus;
  closed_at: string | null;
  enrolments: Record<string, number>;
  exits: Record<string, number>;
  candidates: number;
  eligible: number;
  excluded: number;
  steps: {
    order: number;
    type: StepType;
    summary: string;
    executions: Record<string, number>;
  }[];
  unsubscribed: number;
  delivered: null;
  opened: null;
  clicked: null;
  bounced: null;
  tracking: { enabled: boolean; state: string; note: string };
  replied_proven: number;
  bounce_evidence: string;
  submitted_meaning: string;
}

export interface EnrolmentRow {
  enrolment_id: string;
  status: string;
  person_id: string;
  display_name: string | null;
  destination_masked: string;
  current_step_order: number;
  next_eligible_at: string | null;
  hold_reason: string | null;
  exit_reason: string | null;
  exited_at: string | null;
  revision_number: number;
  source: string;
  entered_at: string;
  last_execution_at: string | null;
  created_at: string;
}

export interface SequenceHealth {
  sequences: Record<string, number>;
  due_now: number;
  oldest_due_seconds: number | null;
  active_leases: number;
  expired_leases: number;
  held_enrolments: number;
  unknown_executions: number;
  execution_totals: Record<string, number>;
  recent_failures: Record<string, number>;
  capability_enabled: boolean;
  scheduler_configured: boolean;
  unsubscribe_configured: boolean;
}

export interface SequenceInput {
  name?: string;
  description?: string;
  sender_id?: string;
  timezone?: string;
  quiet_hours_start?: number;
  quiet_hours_end?: number;
  entry_policy?: string;
  reenrolment_policy?: string;
  policy_block_action?: string;
  exit_rules?: Record<string, unknown>;
  steps?: SequenceStepInput[];
}

export const listSequences = (limit = 50) =>
  callMarketingFn<SequenceListData>(FN, { action: "list", limit });

export const getSequenceDetail = (campaignId: string) =>
  callMarketingFn<SequenceDetail>(FN, { action: "detail", campaign_id: campaignId });

export const createSequence = (input: SequenceInput) =>
  callMarketingFn<{ id: string; revision_id: string; version: number; step_count: number }>(FN, {
    action: "create",
    ...input,
  });

export const reviseSequence = (
  campaignId: string,
  expectedVersion: number,
  changes: SequenceInput,
) =>
  callMarketingFn<{ id: string; revision_id: string; revision: number; version: number }>(FN, {
    action: "revise",
    campaign_id: campaignId,
    expected_version: expectedVersion,
    changes,
  });

export const validateSteps = (steps: SequenceStepInput[]) =>
  callMarketingFn<{
    valid: boolean;
    steps: { order: number; ok: boolean; summary?: string; error?: string }[];
  }>(FN, { action: "validate", steps });

export const transitionSequence = (
  action:
    | "submit_review"
    | "request_changes"
    | "approve"
    | "pause"
    | "resume"
    | "cancel"
    | "close"
    | "archive",
  campaignId: string,
  expectedVersion: number,
  note?: string,
) =>
  callMarketingFn<{ id: string; status: SequenceStatus; version: number }>(FN, {
    action,
    campaign_id: campaignId,
    expected_version: expectedVersion,
    ...(note ? { note } : {}),
  });

export const preflightActivation = (campaignId: string, expectedVersion: number) =>
  callMarketingFn<ActivationPreflight>(FN, {
    action: "preflight_activation",
    campaign_id: campaignId,
    expected_version: expectedVersion,
  });

export const activateSequence = (args: {
  campaign_id: string;
  confirmation_id: string;
  challenge: string;
  request_id: string;
}) =>
  callMarketingFn<{ id: string; status: SequenceStatus; version: number; idempotent: boolean }>(
    FN,
    { action: "activate", ...args },
  );

export const preflightEnrolment = (args: {
  campaign_id: string;
  source: "manual" | "segment";
  person_ids?: string[];
  segment_id?: string;
}) => callMarketingFn<EnrolmentPreflight>(FN, { action: "preflight_enrolment", ...args });

export const confirmEnrolment = (args: {
  campaign_id: string;
  confirmation_id: string;
  challenge: string;
  request_id: string;
}) =>
  callMarketingFn<{ batch_id: string; enrolled: number; eligible: number; idempotent: boolean }>(
    FN,
    { action: "confirm_enrolment", ...args },
  );

export const getSequenceReport = (campaignId: string) =>
  callMarketingFn<SequenceReport>(FN, { action: "report", campaign_id: campaignId });

export const getEnrolmentPage = (
  campaignId: string,
  cursor: { at: string; id: string } | null = null,
  limit = 25,
  status?: string,
): Promise<
  ApiResult<{ enrolments: EnrolmentRow[]; next_cursor: { at: string; id: string } | null }>
> =>
  callMarketingFn(FN, {
    action: "enrolment_list",
    campaign_id: campaignId,
    limit,
    ...(cursor ? { cursor } : {}),
    ...(status ? { status } : {}),
  });

export const controlEnrolment = (
  action: "enrolment_pause" | "enrolment_resume" | "enrolment_exit",
  enrolmentId: string,
  note?: string,
) =>
  callMarketingFn<{ id: string; status: string; exit_reason: string | null }>(FN, {
    action,
    enrolment_id: enrolmentId,
    ...(note ? { note } : {}),
  });

export const getSequenceHealth = () => callMarketingFn<SequenceHealth>(FN, { action: "health" });

/** Browser-side request id: unique per click, stable across retries of the
 *  same submission attempt (the caller holds it while a request is in flight). */
export const newSequenceRequestId = () =>
  `seq-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

/** Display copy for enrolment exclusion reason codes (UI text, not policy). */
export const ENROLMENT_EXCLUSION_LABELS: Record<string, string> = {
  no_contact_point: "No usable email contact point",
  invalid_destination: "Invalid destination",
  unknown_preference: "No explicit subscribed preference",
  unsubscribed: "Unsubscribed",
  hard_suppression: "Hard suppression",
  duplicate_shared_destination: "Shared address (ambiguous target)",
  missing_personalisation: "Missing required personalisation",
  already_enrolled: "Already enrolled in this sequence",
  reenrolment_not_permitted: "Re-enrolment not permitted by this sequence",
};

/** Display copy for exit reasons (UI text, not policy). */
export const EXIT_REASON_LABELS: Record<string, string> = {
  unsubscribed: "Unsubscribed",
  hard_suppression: "Hard suppression",
  hard_bounce: "Hard bounce",
  replied: "Replied",
  lifecycle_outcome: "Lifecycle outcome reached",
  manual_removal: "Removed manually",
  campaign_cancelled: "Sequence cancelled",
  policy_blocked: "Blocked by policy",
  endpoint_invalid: "Email endpoint no longer valid",
  completed_all_steps: "Completed every step",
  configuration_failure: "Configuration failure",
};
