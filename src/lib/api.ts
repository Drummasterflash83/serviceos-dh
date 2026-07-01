/**
 * ServiceOS API helper — foundation layer.
 *
 * A thin, typed `fetch` wrapper that normalises success/error into `ApiResult`
 * so callers never handle raw throws or status codes directly. This is the
 * seam every future data source (Supabase queries, server functions, and later
 * integrations) can build on.
 *
 * Deliberately integration-agnostic: no Gmail / Slack / Simwood logic lives
 * here yet. Not imported by the UI.
 */

import { supabaseConfig } from "./supabase";
import type { ApiError, ApiResult, SimwoodConnectionResult } from "./types";

export interface ApiRequestOptions extends RequestInit {
  /** Base URL to resolve `path` against. Defaults to same-origin. */
  baseUrl?: string;
  /** Parsed as JSON when true (default). Set false for text/blob callers. */
  json?: boolean;
}

function toApiError(code: string, message: string, status?: number): ApiError {
  return { code, message, status };
}

/**
 * Perform an HTTP request and return a normalised `ApiResult`.
 * Never throws for expected failures (network, non-2xx, parse) — those become
 * `{ ok: false, error }`. Programmer errors still throw.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const { baseUrl = "", json = true, ...init } = options;
  const url = baseUrl ? new URL(path, baseUrl).toString() : path;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: toApiError(
        `http_${response.status}`,
        response.statusText || "Request failed",
        response.status,
      ),
    };
  }

  if (!json) {
    return { ok: true, data: (await response.text()) as unknown as T };
  }

  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return {
      ok: false,
      error: toApiError("parse", "Failed to parse JSON response", response.status),
    };
  }
}

/**
 * Test the Simwood/Sipcentric connection via the `simwood-test-connection`
 * Supabase Edge Function. The function reads the provider credentials from
 * server-side secrets and returns credential-free account metadata only.
 *
 * Not wired to the UI yet. Validates input and missing config up front so the
 * caller always gets a normalised `ApiResult` (never a throw). The Edge
 * Function's own `{ ok, data, error }` envelope is unwrapped here so structured
 * error codes/messages survive.
 */
export async function testSimwoodConnection(
  tenantId: string,
): Promise<ApiResult<SimwoodConnectionResult>> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return {
      ok: false,
      error: toApiError(
        "config_error",
        "Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)",
      ),
    };
  }

  const endpoint = `${supabaseConfig.url}/functions/v1/simwood-test-connection`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${supabaseConfig.anonKey}`,
      },
      body: JSON.stringify({ tenant_id: tenantId }),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: { ok?: boolean; data?: SimwoodConnectionResult; error?: ApiError } | null;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: toApiError("parse", "Failed to parse response", response.status),
    };
  }

  if (response.ok && body?.ok && body.data) {
    return { ok: true, data: body.data };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Simwood connection test failed",
      response.status,
    ),
  };
}
