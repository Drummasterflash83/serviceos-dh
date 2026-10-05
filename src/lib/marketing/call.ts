/**
 * Shared Marketing Edge-Function caller: user JWT bearer, server-side tenant
 * binding, `{ ok, data, error }` envelope normalised to `ApiResult`. The
 * browser never supplies tenant or actor identity.
 */
import { supabaseConfig, getAccessToken } from "@/lib/supabase";
import type { ApiError, ApiResult } from "@/lib/types";

const toApiError = (code: string, message: string, status?: number): ApiError => ({
  code,
  message,
  status,
});

export async function callMarketingFn<T>(
  fn: string,
  body: Record<string, unknown>,
): Promise<ApiResult<T>> {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return { ok: false, error: toApiError("config_error", "Supabase is not configured") };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: toApiError("missing_auth", "You must be signed in") };
  let response: Response;
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }
  let parsed: { ok?: boolean; success?: boolean; data?: T; error?: ApiError } | null;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }
  // data-import uses { success, ... } instead of { ok, data }
  if (response.ok && parsed?.success === true) {
    return { ok: true, data: parsed as unknown as T };
  }
  if (response.ok && parsed?.ok && parsed.data !== undefined) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    error: toApiError(
      parsed?.error?.code ?? `http_${response.status}`,
      parsed?.error?.message ?? "Request failed",
      response.status,
    ),
  };
}
