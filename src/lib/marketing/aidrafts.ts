// Marketing AI Drafting — typed client for the marketing-ai-drafts Edge
// Function (Phase 7). Generation creates immutable PROPOSALS through the
// governed Automation Engine capability; acceptance writes DRAFTS only.
// Without a configured provider the surface shows an honest Not
// connected/Configuration required state — nothing is ever faked as Live.

import { callMarketingFn } from "@/lib/marketing/call";
import type { ApiResult } from "@/lib/types";

const FN = "marketing-ai-drafts";

export interface AiProviderState {
  connector_exists: boolean;
  connector_enabled: boolean;
  connector_status: string;
  model: string | null;
  secret_ref_present: boolean;
  capability_enabled: boolean;
  configured: boolean;
  prompt_version: string;
}

export interface GenerationBriefInput {
  destination_kind: "template" | "broadcast" | "sequence_step";
  destination_template_id?: string;
  destination_campaign_id?: string;
  objective_id?: string;
  campaign_objective: string;
  offer: string;
  audience: string;
  why_care?: string;
  objection?: string;
  tone?: string;
  sender_context?: string;
  call_to_action: string;
  request_id: string;
}

export type AiRequestDerivedStatus =
  "queued" | "executing" | "succeeded" | "failed" | "unknown" | "cancelled";

export interface AiRequestStatus {
  ai_request_id: string;
  status: AiRequestDerivedStatus;
  intent_status: string | null;
  attempts: number | null;
  last_error: string | null;
  proposal_id: string | null;
  closed_at: string | null;
  closed_reason: "rejected" | "superseded" | "cancelled" | null;
  created_at: string;
}

export interface AiRequestListRow extends AiRequestStatus {
  destination_kind: "template" | "broadcast" | "sequence_step";
  campaign_objective: string;
  request_id: string;
  actor_email: string | null;
}

export interface AiRevision {
  id: string;
  revision_number: number;
  subject: string;
  preview_text: string | null;
  body_authored: string;
  token_fallbacks: Record<string, string>;
  content_hash: string;
  change_note: string | null;
  created_at: string;
  editor_email: string | null;
}

export interface AiProposalDetail {
  id: string;
  ai_request_id: string;
  provider: string;
  model: string;
  prompt_version: string;
  subject: string;
  preview_text: string | null;
  body_authored: string;
  tokens_required: string[];
  token_fallbacks: Record<string, string>;
  content_hash: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  finish_reason: string | null;
  created_at: string;
  brief: {
    destination_kind: string;
    campaign_objective: string;
    offer: string;
    audience: string;
    why_care: string | null;
    objection: string | null;
    tone: string | null;
    sender_context: string | null;
    call_to_action: string;
    objective_id: string | null;
    closed_at: string | null;
    closed_reason: string | null;
  };
  revisions: AiRevision[];
  accepted_into: {
    template_revisions: Array<{ template_id: string; revision_id: string }>;
    campaign_revisions: Array<{ campaign_id: string; revision_id: string }>;
    sequence_steps: Array<{ campaign_id: string; revision_id: string; step_key: string }>;
  };
}

export function getAiProviderState(): Promise<ApiResult<AiProviderState>> {
  return callMarketingFn(FN, { action: "status" });
}

export function configureAiProvider(args: {
  model?: string;
  api_key?: string;
  enabled?: boolean;
}): Promise<ApiResult<AiProviderState>> {
  return callMarketingFn(FN, { action: "configure", ...args });
}

export function requestGeneration(
  brief: GenerationBriefInput,
): Promise<ApiResult<{ ai_request_id: string; intent_id: string; idempotent: boolean }>> {
  return callMarketingFn(FN, { action: "request_generation", ...brief });
}

export function getAiRequestStatus(aiRequestId: string): Promise<ApiResult<AiRequestStatus>> {
  return callMarketingFn(FN, { action: "request_status", ai_request_id: aiRequestId });
}

export function listAiRequests(
  limit?: number,
  cursor?: { at: string; id: string } | null,
): Promise<ApiResult<{ requests: AiRequestListRow[]; next_cursor: unknown }>> {
  return callMarketingFn(FN, {
    action: "request_list",
    ...(limit ? { limit } : {}),
    ...(cursor ? { cursor } : {}),
  });
}

export function getAiProposalDetail(proposalId: string): Promise<ApiResult<AiProposalDetail>> {
  return callMarketingFn(FN, { action: "proposal_detail", proposal_id: proposalId });
}

export function reviseAiProposal(
  proposalId: string,
  changes: Partial<{
    subject: string;
    preview_text: string;
    body_authored: string;
    token_fallbacks: Record<string, string>;
    change_note: string;
  }>,
): Promise<ApiResult<{ proposal_id: string; revision_id: string; revision: number }>> {
  return callMarketingFn(FN, { action: "revise", proposal_id: proposalId, changes });
}

export function acceptAiProposal(args: {
  proposal_id: string;
  revision_id?: string;
  destination_kind: "template" | "broadcast" | "sequence_step";
  request_id: string;
  template_id?: string;
  template_name?: string;
  expected_version?: number;
  campaign_id?: string;
  name?: string;
  sender_id?: string;
  segment_id?: string;
  step_key?: string;
  append_step?: boolean;
}): Promise<ApiResult<Record<string, unknown>>> {
  return callMarketingFn(FN, { action: "accept", ...args });
}

export function rejectAiRequest(
  aiRequestId: string,
  reason?: string,
): Promise<ApiResult<{ ai_request_id: string; closed_reason: string }>> {
  return callMarketingFn(FN, {
    action: "reject",
    ai_request_id: aiRequestId,
    ...(reason ? { reason } : {}),
  });
}

export function cancelAiRequest(
  aiRequestId: string,
): Promise<ApiResult<{ ai_request_id: string; closed_reason: string }>> {
  return callMarketingFn(FN, { action: "cancel", ai_request_id: aiRequestId });
}

export function newAiRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `aig-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function newAiAcceptRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `aac-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
