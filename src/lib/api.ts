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

import { supabaseConfig, getAccessToken } from "./supabase";
import type {
  ApiError,
  ApiResult,
  SimwoodConnectionResult,
  SimwoodSyncCallsInput,
  SimwoodSyncCallsResult,
  SimwoodSyncRecordingsInput,
  SimwoodSyncRecordingsResult,
  SimwoodDownloadRecordingInput,
  SimwoodDownloadRecordingResult,
  PhoneTranscribeRecordingInput,
  PhoneTranscribeRecordingResult,
  PhoneAnalyseTranscriptInput,
  PhoneAnalyseTranscriptResult,
  ProcessPhonePipelineInput,
  ProcessPhonePipelineResult,
  PhonePipelineStatusResult,
  GmailOAuthStartResult,
  GoogleWorkspaceTestResult,
  GoogleWorkspaceSaveConnectionInput,
  GoogleWorkspaceSaveConnectionResult,
  GoogleWorkspaceDiscoverMailboxesResult,
  GoogleWorkspaceEnableMailboxesInput,
  GoogleWorkspaceEnableMailboxesResult,
  GoogleWorkspaceUpdateMailboxesInput,
  GoogleWorkspaceUpdateMailboxesResult,
  GmailSyncMessagesInput,
  GmailSyncMessagesResult,
} from "./types";

export interface ApiRequestOptions extends RequestInit {
  /** Base URL to resolve `path` against. Defaults to same-origin. */
  baseUrl?: string;
  /** Parsed as JSON when true (default). Set false for text/blob callers. */
  json?: boolean;
}

function toApiError(code: string, message: string, status?: number): ApiError {
  return { code, message, status };
}

type FunctionAuth = { ok: true; token: string } | { ok: false; error: ApiError };

/**
 * Resolve config + the current user's access token for an Edge Function call.
 * Functions verify this JWT and bind the tenant server-side, so the token — not
 * the anon key — must be the bearer.
 */
async function functionAuth(): Promise<FunctionAuth> {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return {
      ok: false,
      error: toApiError(
        "config_error",
        "Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)",
      ),
    };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: toApiError("missing_auth", "You must be signed in") };
  return { ok: true, token };
}

function functionHeaders(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    apikey: supabaseConfig.anonKey,
    Authorization: `Bearer ${token}`,
  };
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
  providerCustomerId?: string,
): Promise<ApiResult<SimwoodConnectionResult>> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const endpoint = `${supabaseConfig.url}/functions/v1/simwood-test-connection`;

  const payload: Record<string, unknown> = { tenant_id: tenantId };
  if (providerCustomerId !== undefined) payload.provider_customer_id = providerCustomerId;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
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

/**
 * Trigger a Simwood/Sipcentric call-history sync via the `simwood-sync-calls`
 * Edge Function (Phase-1). Credentials are read server-side; this only passes
 * the tenant, optional window and filters. Idempotent on the server.
 *
 * Not wired to the UI yet. camelCase input is mapped to the function's
 * snake_case body; the flat `{ success, ... }` response is normalised to
 * `ApiResult` so callers never handle a raw throw.
 */
export async function syncSimwoodCalls(
  input: SimwoodSyncCallsInput,
): Promise<ApiResult<SimwoodSyncCallsResult>> {
  if (!input || typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  if (input.limit !== undefined && (!Number.isFinite(input.limit) || input.limit <= 0)) {
    return { ok: false, error: toApiError("invalid_limit", "limit must be a positive number") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = { tenant_id: input.tenantId };
  if (input.providerCustomerId !== undefined)
    payload.provider_customer_id = input.providerCustomerId;
  if (input.from !== undefined) payload.from = input.from;
  if (input.to !== undefined) payload.to = input.to;
  if (input.direction !== undefined) payload.direction = input.direction;
  if (input.limit !== undefined) payload.limit = input.limit;

  const endpoint = `${supabaseConfig.url}/functions/v1/simwood-sync-calls`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<SimwoodSyncCallsResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: toApiError("parse", "Failed to parse response", response.status),
    };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as SimwoodSyncCallsResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Simwood call sync failed",
      response.status,
    ),
  };
}

/**
 * Trigger a Simwood/Sipcentric recording-METADATA sync via the
 * `simwood-sync-recordings` Edge Function (Phase-2). Metadata only — no audio
 * download. Credentials are read server-side; idempotent on the server.
 *
 * Not wired to the UI yet. camelCase input is mapped to the function's
 * snake_case body; the flat `{ success, ... }` response is normalised to
 * `ApiResult`.
 */
export async function syncSimwoodRecordings(
  input: SimwoodSyncRecordingsInput,
): Promise<ApiResult<SimwoodSyncRecordingsResult>> {
  if (!input || typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  if (input.limit !== undefined && (!Number.isFinite(input.limit) || input.limit <= 0)) {
    return { ok: false, error: toApiError("invalid_limit", "limit must be a positive number") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = { tenant_id: input.tenantId };
  if (input.providerCustomerId !== undefined)
    payload.provider_customer_id = input.providerCustomerId;
  if (input.from !== undefined) payload.from = input.from;
  if (input.to !== undefined) payload.to = input.to;
  if (input.callId !== undefined) payload.call_id = input.callId;
  if (input.linkedId !== undefined) payload.linked_id = input.linkedId;
  if (input.limit !== undefined) payload.limit = input.limit;

  const endpoint = `${supabaseConfig.url}/functions/v1/simwood-sync-recordings`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<SimwoodSyncRecordingsResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: toApiError("parse", "Failed to parse response", response.status),
    };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as SimwoodSyncRecordingsResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Simwood recording sync failed",
      response.status,
    ),
  };
}

/**
 * Download a single recording's audio via the `simwood-download-recording`
 * Edge Function (Phase-3). The audio is fetched server-side and stored in a
 * private Supabase Storage bucket; this only passes the tenant + recording id.
 * The raw Simwood URL and credentials are never exposed to the client.
 *
 * Idempotent server-side: an already-stored recording returns
 * `already_downloaded: true` unless `force` is set. Not wired to the UI yet.
 */
export async function downloadSimwoodRecording(
  input: SimwoodDownloadRecordingInput,
): Promise<ApiResult<SimwoodDownloadRecordingResult>> {
  if (!input || typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  if (typeof input.recordingId !== "string" || input.recordingId.trim() === "") {
    return { ok: false, error: toApiError("invalid_recording_id", "recordingId is required") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    recording_id: input.recordingId,
  };
  if (input.force !== undefined) payload.force = input.force;

  const endpoint = `${supabaseConfig.url}/functions/v1/simwood-download-recording`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<SimwoodDownloadRecordingResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: toApiError("parse", "Failed to parse response", response.status),
    };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as SimwoodDownloadRecordingResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Simwood recording download failed",
      response.status,
    ),
  };
}

/**
 * Transcribe a stored recording's audio via the `phone-transcribe-recording`
 * Edge Function (Phase-4A). Audio is read from private storage and sent to
 * OpenAI server-side; this only passes the tenant + recording id. Neither the
 * audio URL nor the OpenAI key is exposed to the client.
 *
 * Idempotent server-side: a completed transcript returns as-is unless `force`.
 * Not wired to product UI — used by the Admin console only.
 */
export async function transcribePhoneRecording(
  input: PhoneTranscribeRecordingInput,
): Promise<ApiResult<PhoneTranscribeRecordingResult>> {
  if (!input || typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  if (typeof input.recordingId !== "string" || input.recordingId.trim() === "") {
    return { ok: false, error: toApiError("invalid_recording_id", "recordingId is required") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    recording_id: input.recordingId,
  };
  if (input.force !== undefined) payload.force = input.force;

  const endpoint = `${supabaseConfig.url}/functions/v1/phone-transcribe-recording`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<PhoneTranscribeRecordingResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: toApiError("parse", "Failed to parse response", response.status),
    };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as PhoneTranscribeRecordingResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Transcription failed",
      response.status,
    ),
  };
}

/**
 * Analyse a completed transcript into structured intelligence via the
 * `phone-analyse-transcript` Edge Function (Phase-4B). The OpenAI key stays
 * server-side; this only passes the tenant + transcript id.
 *
 * Idempotent server-side: an existing insight returns as-is unless `force`.
 * Not wired to product UI — used by the Admin console only.
 */
export async function analysePhoneTranscript(
  input: PhoneAnalyseTranscriptInput,
): Promise<ApiResult<PhoneAnalyseTranscriptResult>> {
  if (!input || typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  if (typeof input.transcriptId !== "string" || input.transcriptId.trim() === "") {
    return { ok: false, error: toApiError("invalid_transcript_id", "transcriptId is required") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    transcript_id: input.transcriptId,
  };
  if (input.force !== undefined) payload.force = input.force;

  const endpoint = `${supabaseConfig.url}/functions/v1/phone-analyse-transcript`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<PhoneAnalyseTranscriptResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: toApiError("parse", "Failed to parse response", response.status),
    };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as PhoneAnalyseTranscriptResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Analysis failed",
      response.status,
    ),
  };
}

/**
 * Run the full processing pipeline (download → transcribe → analyse) for one
 * recording via the `phone-process-pipeline` Edge Function (Phase 5A). Each
 * step is idempotent server-side. Used by the Admin "Retry Pipeline" control.
 */
export async function processPhonePipeline(
  input: ProcessPhonePipelineInput,
): Promise<ApiResult<ProcessPhonePipelineResult>> {
  if (!input || typeof input.tenantId !== "string" || input.tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  if (typeof input.recordingId !== "string" || input.recordingId.trim() === "") {
    return { ok: false, error: toApiError("invalid_recording_id", "recordingId is required") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    recording_id: input.recordingId,
  };
  if (input.force !== undefined) payload.force = input.force;

  const endpoint = `${supabaseConfig.url}/functions/v1/phone-process-pipeline`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<ProcessPhonePipelineResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as ProcessPhonePipelineResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Pipeline failed",
      response.status,
    ),
  };
}

/**
 * Fetch pipeline diagnostics counts via the `phone-pipeline-status` Edge
 * Function (service-role read). Used by the Admin diagnostics panel.
 */
export async function getPhonePipelineStatus(
  tenantId: string,
): Promise<ApiResult<PhonePipelineStatusResult>> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    return { ok: false, error: toApiError("invalid_tenant_id", "tenantId is required") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const endpoint = `${supabaseConfig.url}/functions/v1/phone-pipeline-status`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify({ tenant_id: tenantId }),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<PhonePipelineStatusResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as PhonePipelineStatusResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Status fetch failed",
      response.status,
    ),
  };
}

/**
 * Begin the Gmail OAuth connection flow via the `gmail-oauth-start` Edge
 * Function (Email Phase-1). The function derives the tenant/user from the
 * signed-in JWT (never a client-supplied tenant_id) and returns a Google
 * consent URL. The caller should redirect the browser to `auth_url`.
 *
 * Connection only — no email is synced. No secrets touch the client; the
 * function reads GOOGLE_* server-side.
 */
export async function startGmailOAuth(): Promise<ApiResult<GmailOAuthStartResult>> {
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const endpoint = `${supabaseConfig.url}/functions/v1/gmail-oauth-start`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      // No tenant_id — the function binds the tenant from the caller's profile.
      body: JSON.stringify({}),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<GmailOAuthStartResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success && body.auth_url) {
    return { ok: true, data: body as GmailOAuthStartResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Could not start Gmail connection",
      response.status,
    ),
  };
}

/**
 * Verify Google Workspace Domain-Wide Delegation via the
 * `google-workspace-test-connection` Edge Function (Email Phase-1B). The
 * function impersonates the configured admin subject using a service account
 * (key read server-side only) and returns a credential-free summary.
 *
 * owner/admin only (enforced server-side). No mailbox is synced.
 */
export async function testGoogleWorkspaceConnection(): Promise<
  ApiResult<GoogleWorkspaceTestResult>
> {
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const endpoint = `${supabaseConfig.url}/functions/v1/google-workspace-test-connection`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      // No tenant_id — the function binds the tenant from the caller's profile.
      body: JSON.stringify({}),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<GoogleWorkspaceTestResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as GoogleWorkspaceTestResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Workspace connection test failed",
      response.status,
    ),
  };
}

/**
 * Save the tenant's Google Workspace connection (domain + admin subject) via the
 * `google-workspace-save-connection` Edge Function (owner/admin only). Returns
 * the setup instructions (ServiceOS client id + scopes) for the Google Admin
 * console. No secrets touch the client.
 */
export async function saveGoogleWorkspaceConnection(
  input: GoogleWorkspaceSaveConnectionInput,
): Promise<ApiResult<GoogleWorkspaceSaveConnectionResult>> {
  if (!input || typeof input.domain !== "string" || input.domain.trim() === "") {
    return { ok: false, error: toApiError("invalid_domain", "domain is required") };
  }
  if (typeof input.impersonationSubject !== "string" || input.impersonationSubject.trim() === "") {
    return {
      ok: false,
      error: toApiError("invalid_subject", "impersonationSubject is required"),
    };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const endpoint = `${supabaseConfig.url}/functions/v1/google-workspace-save-connection`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify({
        domain: input.domain.trim(),
        impersonation_subject: input.impersonationSubject.trim(),
      }),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<GoogleWorkspaceSaveConnectionResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as GoogleWorkspaceSaveConnectionResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Could not save the Workspace connection",
      response.status,
    ),
  };
}

/**
 * Discover all mailboxes in the configured Google Workspace domain via the
 * `google-workspace-discover-mailboxes` Edge Function (owner/admin only). Uses
 * domain-wide delegation server-side (service-account key never touches the
 * client) and upserts google_workspace_connections/mailboxes. No message sync.
 */
export async function discoverGoogleWorkspaceMailboxes(): Promise<
  ApiResult<GoogleWorkspaceDiscoverMailboxesResult>
> {
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const endpoint = `${supabaseConfig.url}/functions/v1/google-workspace-discover-mailboxes`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify({}),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<GoogleWorkspaceDiscoverMailboxesResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as GoogleWorkspaceDiscoverMailboxesResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Mailbox discovery failed",
      response.status,
    ),
  };
}

/**
 * Enable (or disable) selected discovered mailboxes via the
 * `google-workspace-enable-mailboxes` Edge Function (owner/admin only). Registers
 * matching email_accounts for enabled mailboxes; creates NO OAuth tokens and
 * syncs no messages.
 */
export async function enableGoogleWorkspaceMailboxes(
  input: GoogleWorkspaceEnableMailboxesInput,
): Promise<ApiResult<GoogleWorkspaceEnableMailboxesResult>> {
  if (!input || typeof input.connectionId !== "string" || input.connectionId.trim() === "") {
    return { ok: false, error: toApiError("invalid_connection_id", "connectionId is required") };
  }
  if (!Array.isArray(input.mailboxIds) || input.mailboxIds.length === 0) {
    return { ok: false, error: toApiError("invalid_mailbox_ids", "mailboxIds is required") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = {
    connection_id: input.connectionId.trim(),
    mailbox_ids: input.mailboxIds,
    sync_enabled: input.syncEnabled !== false,
  };

  const endpoint = `${supabaseConfig.url}/functions/v1/google-workspace-enable-mailboxes`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<GoogleWorkspaceEnableMailboxesResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as GoogleWorkspaceEnableMailboxesResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Enable mailboxes failed",
      response.status,
    ),
  };
}

/**
 * Enable or disable selected discovered Workspace mailboxes via the
 * `google-workspace-update-mailboxes` Edge Function (owner/admin only). Enable
 * registers/reactivates DWD email_accounts; disable sets DWD accounts to
 * 'disabled' (OAuth 'active' accounts and message history are preserved). Creates
 * no OAuth tokens and syncs no messages.
 */
export async function updateGoogleWorkspaceMailboxes(
  input: GoogleWorkspaceUpdateMailboxesInput,
): Promise<ApiResult<GoogleWorkspaceUpdateMailboxesResult>> {
  if (!input || !Array.isArray(input.mailboxIds) || input.mailboxIds.length === 0) {
    return { ok: false, error: toApiError("invalid_mailbox_ids", "mailboxIds is required") };
  }
  if (typeof input.syncEnabled !== "boolean") {
    return {
      ok: false,
      error: toApiError("invalid_sync_enabled", "syncEnabled must be a boolean"),
    };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = {
    mailbox_ids: input.mailboxIds,
    sync_enabled: input.syncEnabled,
  };

  const endpoint = `${supabaseConfig.url}/functions/v1/google-workspace-update-mailboxes`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<GoogleWorkspaceUpdateMailboxesResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as GoogleWorkspaceUpdateMailboxesResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Update mailboxes failed",
      response.status,
    ),
  };
}

/**
 * Sync recent Gmail messages for a connected OAuth mailbox via the
 * `gmail-sync-messages` Edge Function (Email Phase-2). The OAuth token is
 * loaded/refreshed server-side and never exposed; this only passes the account
 * id + options. Idempotent server-side. Admin/diagnostic use for now.
 */
export async function syncGmailMessages(
  input: GmailSyncMessagesInput,
): Promise<ApiResult<GmailSyncMessagesResult>> {
  if (!input || typeof input.emailAccountId !== "string" || input.emailAccountId.trim() === "") {
    return {
      ok: false,
      error: toApiError("invalid_email_account_id", "emailAccountId is required"),
    };
  }
  if (
    input.maxResults !== undefined &&
    (!Number.isFinite(input.maxResults) || input.maxResults <= 0)
  ) {
    return { ok: false, error: toApiError("invalid_max_results", "maxResults must be positive") };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = { email_account_id: input.emailAccountId.trim() };
  if (input.force !== undefined) payload.force = input.force;
  if (input.maxResults !== undefined) payload.max_results = input.maxResults;

  const endpoint = `${supabaseConfig.url}/functions/v1/gmail-sync-messages`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<GmailSyncMessagesResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as GmailSyncMessagesResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Gmail message sync failed",
      response.status,
    ),
  };
}

/**
 * Sync a Workspace DWD mailbox via the `gmail-workspace-sync-messages` Edge
 * Function (owner/admin/ops). Uses domain-wide delegation server-side (the
 * service-account key never touches the client) — for mailboxes registered as
 * `pending_tokenless_dwd` / `active_dwd`, not OAuth mailboxes. Same input/result
 * shape as `syncGmailMessages`. Idempotent server-side; diagnostic use for now.
 */
export async function syncGmailWorkspaceMessages(
  input: GmailSyncMessagesInput,
): Promise<ApiResult<GmailSyncMessagesResult>> {
  if (!input || typeof input.emailAccountId !== "string" || input.emailAccountId.trim() === "") {
    return {
      ok: false,
      error: toApiError("invalid_email_account_id", "emailAccountId is required"),
    };
  }
  const authz = await functionAuth();
  if (!authz.ok) return { ok: false, error: authz.error };

  const payload: Record<string, unknown> = { email_account_id: input.emailAccountId.trim() };
  if (input.force !== undefined) payload.force = input.force;
  if (input.maxResults !== undefined) payload.max_results = input.maxResults;

  const endpoint = `${supabaseConfig.url}/functions/v1/gmail-workspace-sync-messages`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: functionHeaders(authz.token),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Network request failed";
    return { ok: false, error: toApiError("network", message) };
  }

  let body: (Partial<GmailSyncMessagesResult> & { error?: ApiError }) | null;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: toApiError("parse", "Failed to parse response", response.status) };
  }

  if (response.ok && body?.success) {
    return { ok: true, data: body as GmailSyncMessagesResult };
  }

  return {
    ok: false,
    error: toApiError(
      body?.error?.code ?? `http_${response.status}`,
      body?.error?.message ?? "Workspace mailbox sync failed",
      response.status,
    ),
  };
}
