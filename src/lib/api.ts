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

import type { ApiError, ApiResult } from "./types";

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
