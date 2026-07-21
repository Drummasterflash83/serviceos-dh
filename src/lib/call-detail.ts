/**
 * Call detail client — the full, honest intelligence for one phone call: latest canonical
 * summary + structured fields, resolved participants (with honest unknown/conflict), the raw &
 * normalised transcript + the exact corrections applied, and the tenant's review state. Plus the
 * persistent `markReviewed` action. All via the phone-call-detail Edge Function (tenant-bound).
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
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
  const { data, error } = await getSupabaseClient().functions.invoke("phone-call-detail", { body });
  if (error) return { ok: false, error: { code: "call_detail_error", message: error.message } };
  if (data && (data as { success?: boolean }).success === false) {
    const e = (data as { error?: { code?: string; message?: string } }).error;
    return { ok: false, error: { code: e?.code ?? "error", message: e?.message ?? "failed" } };
  }
  return { ok: true, data: data as T };
}

export const getCallDetail = (callId: string) =>
  invoke<CallDetail>({ action: "detail", call_id: callId });
export const markCallReviewed = (callId: string, note?: string) =>
  invoke<{ review: CallDetail["review"] }>({ action: "mark_reviewed", call_id: callId, note });
export const clearCallReview = (callId: string) =>
  invoke<{ review: null }>({ action: "clear_review", call_id: callId });
