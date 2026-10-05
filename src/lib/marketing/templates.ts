// Marketing Templates — typed client for the marketing-templates Edge
// Function (Phase 7). One safe content model: template content is exactly the
// broadcast/sequence authored shape, validated server-side by the ONE
// canonical validator. Hidden controls are NOT the security boundary — the
// server enforces every permission again.

import { callMarketingFn } from "@/lib/marketing/call";
import type { ApiResult } from "@/lib/types";

const FN = "marketing-templates";

export type TemplateStatus = "active" | "archived";

export interface TemplateContent {
  subject: string;
  preview_text?: string | null;
  body_authored: string;
  token_fallbacks?: Record<string, string>;
}

export interface TemplateRevisionSummary {
  id: string;
  revision_number: number;
  subject: string;
  content_hash: string;
  source: string;
  created_at: string;
}

export interface TemplateListRow {
  id: string;
  name: string;
  description: string | null;
  status: TemplateStatus;
  version: number;
  created_at: string;
  updated_at: string;
  created_by_email: string | null;
  current_revision: TemplateRevisionSummary | null;
  revision_count: number;
  usage_count: number;
  last_used_at: string | null;
}

export interface TemplateListData {
  templates: TemplateListRow[];
  next_cursor: { at: string; id: string } | null;
  counts: { active: number; archived: number };
}

export interface TemplateRevision {
  id: string;
  revision_number: number;
  subject: string;
  preview_text: string | null;
  body_authored: string;
  tokens_required: string[];
  token_fallbacks: Record<string, string>;
  content_hash: string;
  source: string;
  source_template_revision_id: string | null;
  source_ai_proposal_id: string | null;
  created_at: string;
  created_by_email: string | null;
}

export interface TemplateDetail {
  id: string;
  name: string;
  description: string | null;
  status: TemplateStatus;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  created_by_email: string | null;
  current_revision_id: string | null;
  revisions: TemplateRevision[];
  usage: {
    total: number;
    last_used_at: string | null;
    by_revision: Record<string, number>;
    recent: Array<{
      used_in: "broadcast" | "sequence_step";
      campaign_id: string;
      campaign_name: string | null;
      revision_number: number | null;
      created_at: string;
    }>;
  };
}

export interface TemplatePreview {
  sample_context: Record<string, string>;
  note: string;
  subject: string;
  text: string;
  html: string;
  preview_text: string | null;
}

export interface QualityFinding {
  code: string;
  severity: "advisory";
  message: string;
}

export interface QualityReport {
  version: string;
  advisory: true;
  note: string;
  thresholds: Record<string, number>;
  findings: QualityFinding[];
}

export function listTemplates(
  args: {
    status?: TemplateStatus;
    search?: string;
    limit?: number;
    cursor?: { at: string; id: string } | null;
  } = {},
): Promise<ApiResult<TemplateListData>> {
  return callMarketingFn(FN, { action: "list", ...args });
}

export function getTemplateDetail(templateId: string): Promise<ApiResult<TemplateDetail>> {
  return callMarketingFn(FN, { action: "detail", template_id: templateId });
}

/** A fresh mutation request id (matches the server's ^[A-Za-z0-9_-]{8,64}$).
 *  Every template MUTATION requires one: an unchanged retry with the same id
 *  converges idempotently on the original result; a changed reuse of an id
 *  is refused (REQUEST_MISMATCH), so keys must rotate with semantic input. */
export function newTemplateRequestId(): string {
  return `tpl-${crypto.randomUUID()}`;
}

export function createTemplate(
  input: { name: string; description?: string } & TemplateContent,
  requestId: string,
): Promise<ApiResult<{ id: string; revision_id: string; version: number }>> {
  return callMarketingFn(FN, { action: "create", ...input, request_id: requestId });
}

export function reviseTemplate(
  templateId: string,
  expectedVersion: number,
  changes: Partial<{ name: string; description: string } & TemplateContent>,
  requestId: string,
): Promise<ApiResult<{ id: string; revision_id: string; revision: number; version: number }>> {
  return callMarketingFn(FN, {
    action: "revise",
    template_id: templateId,
    expected_version: expectedVersion,
    changes,
    request_id: requestId,
  });
}

export function duplicateTemplate(
  templateId: string,
  requestId: string,
  name?: string,
): Promise<ApiResult<{ id: string; name: string }>> {
  return callMarketingFn(FN, {
    action: "duplicate",
    template_id: templateId,
    request_id: requestId,
    ...(name ? { name } : {}),
  });
}

export function setTemplateStatus(
  templateId: string,
  expectedVersion: number,
  status: TemplateStatus,
  requestId: string,
): Promise<ApiResult<{ id: string; status: TemplateStatus; version: number }>> {
  return callMarketingFn(FN, {
    action: status === "archived" ? "archive" : "restore",
    template_id: templateId,
    expected_version: expectedVersion,
    request_id: requestId,
  });
}

export function previewTemplateContent(
  content: TemplateContent,
): Promise<ApiResult<TemplatePreview>> {
  return callMarketingFn(FN, { action: "preview", content });
}

export function qualityCheck(
  content: TemplateContent,
  senderId?: string,
): Promise<ApiResult<QualityReport>> {
  return callMarketingFn(FN, {
    action: "quality_check",
    content,
    ...(senderId ? { sender_id: senderId } : {}),
  });
}

export function applyTemplateToBroadcast(args: {
  template_revision_id: string;
  mode: "new" | "existing";
  name?: string;
  description?: string;
  sender_id?: string;
  segment_id?: string;
  campaign_id?: string;
  expected_version?: number;
  request_id: string;
}): Promise<ApiResult<{ id: string; revision_id: string; template_revision_id: string }>> {
  return callMarketingFn(FN, { action: "use_in_broadcast", ...args });
}

export function applyTemplateToSequenceStep(args: {
  template_revision_id: string;
  campaign_id: string;
  expected_version: number;
  step_key?: string;
  append_step?: boolean;
  request_id: string;
}): Promise<ApiResult<{ id: string; revision_id: string; template_revision_id: string }>> {
  return callMarketingFn(FN, { action: "use_in_sequence_step", ...args });
}
