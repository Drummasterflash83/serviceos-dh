/**
 * Marketing access client — the single browser seam to the `marketing-access`
 * Edge Function. Mirrors the `api.ts` pattern: the user JWT is the bearer; the
 * function verifies it and binds the tenant server-side; the `{ ok, data, error }`
 * envelope is normalised to `ApiResult`.
 */

import { supabaseConfig, getAccessToken } from "@/lib/supabase";
import type { ApiError, ApiResult } from "@/lib/types";
import type { MarketingPermission } from "./permissions";

export interface MarketingLifecycleStage {
  stage_key: string;
  label: string;
  tone: "neutral" | "info" | "positive" | "attention" | "negative";
  sort_order: number;
  active: boolean;
  terminal_outcome: "won" | "lost" | "nurture" | null;
  is_default: boolean;
}

export interface MarketingSettingsView {
  include_all_discovered: boolean;
  default_relationship_type: string;
  default_lifecycle_stage_key: string;
  timezone: string;
  tracking_enabled: boolean;
  reply_handling: "workspace" | "none";
  version: number;
}

/**
 * Server response contract (fail-closed):
 *  - denied  → { can_view:false, reason } and NOTHING else (no settings, stages,
 *    role or permission details);
 *  - allowed → the resolved permission set + tenant config. `initialised=false`
 *    means tenant defaults have not been materialised yet (only owner/admin
 *    bootstrap them; other authorised callers see the honest uninitialised state).
 */
export interface MarketingAccess {
  can_view: boolean;
  reason?: "no_permission" | "not_enabled";
  marketing_enabled?: boolean;
  permissions?: MarketingPermission[];
  initialised?: boolean;
  settings?: MarketingSettingsView | null;
  lifecycle_stages?: MarketingLifecycleStage[];
}

function toApiError(code: string, message: string, status?: number): ApiError {
  return { code, message, status };
}

/**
 * Resolve the signed-in user's Marketing access + tenant config. Idempotently
 * materialises tenant defaults server-side on first call. Never throws for
 * expected failures — returns a normalised `ApiResult`.
 */
export async function fetchMarketingAccess(): Promise<ApiResult<MarketingAccess>> {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return { ok: false, error: toApiError("config_error", "Supabase is not configured") };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: toApiError("missing_auth", "You must be signed in") };

  const endpoint = `${supabaseConfig.url}/functions/v1/marketing-access`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: { ok?: boolean; data?: MarketingAccess; error?: ApiError } | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.ok && body.data) {
    return { ok: true, data: body.data };
  }
  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Could not resolve Marketing access",
      response.status,
    ),
  };
}
