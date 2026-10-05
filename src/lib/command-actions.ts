/**
 * Command Centre — real actions. The ONLY mutation the cockpit performs, routed through
 * the EXISTING intelligence-review-action Edge Function (no duplicate API, no parallel
 * approval system). Approving a pending automation_intent records the immutable approval
 * snapshot + automation_approvals row; the already-verified Automation Engine then claims,
 * executes and records the outcome on its next pass. This client never bypasses the
 * approval layer, the audit trail, the execution envelope or outcome recording.
 *
 * Auth: the user's session bearer is sent so the function binds the tenant + operator
 * (who approved) server-side — the browser never asserts identity.
 */

import { getAccessToken, isSupabaseConfigured, supabaseConfig } from "./supabase";
import type { ApiResult } from "./types";

export interface ApproveIntentResult {
  automation_intent_id: string;
  approver_kind: string;
  approved_version: string | null;
  note: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Approve a pending automation intent through the review-action endpoint
 * (…/intent/{id}/approve). Returns the endpoint's structured result, or a typed error
 * (e.g. already_approved 409, not_authenticated) — never throws.
 */
export async function approveAutomationIntent(
  intentId: string,
): Promise<ApiResult<ApproveIntentResult>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  if (!UUID_RE.test(intentId)) {
    return { ok: false, error: { code: "invalid_input", message: "invalid automation intent id" } };
  }
  const token = await getAccessToken();
  if (!token) {
    return {
      ok: false,
      error: { code: "not_authenticated", message: "Sign in to approve actions" },
    };
  }
  try {
    const res = await fetch(
      `${supabaseConfig.url}/functions/v1/intelligence-review-action/intent/${intentId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: supabaseConfig.anonKey,
          authorization: `Bearer ${token}`,
        },
        body: "{}",
      },
    );
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok || !body?.ok) {
      const err = body?.error;
      return {
        ok: false,
        error: {
          code: err?.code ?? `http_${res.status}`,
          message: err?.message ?? "Approval could not be recorded",
        },
      };
    }
    return { ok: true, data: body as unknown as ApproveIntentResult };
  } catch (e) {
    return {
      ok: false,
      error: { code: "network_error", message: e instanceof Error ? e.message : "Network error" },
    };
  }
}
