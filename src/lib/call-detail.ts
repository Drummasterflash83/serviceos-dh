/** Tenant-bound retained call detail and human review client. */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import { parseCallDetail, reviewSchema } from "./call-detail-contract";
import type { ApiResult } from "./types";

export interface CorrectionSpan {
  start: number;
  end: number;
}
export interface TranscriptCorrection {
  from: string;
  to: string;
  applied: boolean;
  confidence: number;
  category: string;
  evidence: string[];
  span: CorrectionSpan;
}
export interface ResolvedParty {
  entity_id?: string;
  name?: string | null;
  role?: string | null;
  confidence?: number;
  number?: string | null;
  unresolved?: boolean;
}
export interface CallDetail {
  version: "phone-call-detail/2";
  tenant_id: string;
  provenance: { freshness: "unverified"; transcript_id: string | null };
  call: {
    call_id: string;
    occurred_at: string | null;
    direction: string;
    connector: string;
    phone_from: string | null;
    phone_to: string | null;
    processing_status: string | null;
  };
  insight: {
    summary: string;
    intent: string | null;
    urgency: string | null;
    sentiment: string | null;
    action_required: boolean | null;
    suggested_owner: string | null;
    confidence: number | null;
    updated_at: string | null;
  } | null;
  identity: {
    internal: ResolvedParty | null;
    external: ResolvedParty | null;
    direction: string | null;
    direction_confidence: number | null;
    has_conflict: boolean;
    unresolved: string[];
    identity_confidence: number | null;
  };
  transcript: {
    raw: string | null;
    normalised: string | null;
    corrections: TranscriptCorrection[];
  };
  review: { reviewed_at: string; reviewed_by: string | null; note: string | null } | null;
}

async function invoke<T>(body: Record<string, unknown>): Promise<ApiResult<T>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  try {
    const { data, error } = await getSupabaseClient().functions.invoke("phone-call-detail", {
      body,
    });
    if (error || !data || data.success !== true) throw new Error("Request unconfirmed");
    const result =
      body.action === "detail"
        ? parseCallDetail(data, String(body.call_id))
        : { review: reviewSchema.parse(data.review) };
    if (body.action === "mark_reviewed" && !(result as { review: unknown }).review)
      throw new Error("Review unconfirmed");
    if (body.action === "clear_review" && (result as { review: unknown }).review !== null)
      throw new Error("Review unconfirmed");
    return { ok: true, data: result as T };
  } catch {
    return {
      ok: false,
      error: {
        code: "call_detail_error",
        message:
          "Call details or review could not be confirmed. Refresh or contact your administrator.",
      },
    };
  }
}

export const getCallDetail = (callId: string) =>
  invoke<CallDetail>({ action: "detail", call_id: callId });
export const markCallReviewed = (callId: string, note?: string) =>
  invoke<{ review: CallDetail["review"] }>({ action: "mark_reviewed", call_id: callId, note });
export const clearCallReview = (callId: string) =>
  invoke<{ review: null }>({ action: "clear_review", call_id: callId });
