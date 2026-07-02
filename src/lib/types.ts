/**
 * Shared backend/data types for ServiceOS.
 *
 * Foundation only — generic building blocks used by the data/API layer.
 * Domain-specific types (calls, jobs, customers, integrations) will be added
 * per-module as the backend is wired. Nothing here is imported by the UI yet.
 */

/** Standard result envelope returned by the API helper in `./api`. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** Normalised error shape so callers never depend on raw fetch/throw details. */
export interface ApiError {
  /** Machine-readable code, e.g. "http_500", "network", "parse". */
  code: string;
  /** Human-readable message, safe to log. */
  message: string;
  /** HTTP status when the failure came from a response. */
  status?: number;
}

/** Generic cursor/offset pagination envelope (mirrors common REST list shapes). */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  nextPage?: number | null;
  prevPage?: number | null;
}

/** Public Supabase config resolved from `VITE_*` env (see `./supabase`). */
export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

/** Access-control roles, least → most privileged handled in policy, not order. */
export type UserRole = "owner" | "admin" | "ops" | "viewer";

/** A row from the `profiles` table (one per auth user). */
export interface Profile {
  id: string;
  tenant_id: string | null;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

/** Safe, credential-free account summary returned by the Simwood test. */
export interface SimwoodCustomerSummary {
  id: string | null;
  name: string | null;
  type: string | null;
}

/** Result of the `simwood-test-connection` Edge Function (no secrets). */
export interface SimwoodConnectionResult {
  provider: string;
  customers: SimwoodCustomerSummary[];
  customerCount: number;
}

/** Input to the `simwood-sync-calls` Edge Function (Phase-1 call history sync). */
export interface SimwoodSyncCallsInput {
  tenantId: string;
  /** Simwood customer id; discovered server-side when omitted. */
  providerCustomerId?: string;
  /** ISO date — start of the sync window. Defaults server-side to now-24h. */
  from?: string;
  /** ISO date — end of the sync window. Defaults server-side to now. */
  to?: string;
  direction?: "inbound" | "outbound";
  /** Max records to process this run. */
  limit?: number;
}

/** Safe summary returned by `simwood-sync-calls`. */
export interface SimwoodSyncCallsResult {
  success: boolean;
  provider: string;
  records_processed: number;
  from: string;
  to: string;
  customer_id: string | null;
  sync_run_id: string | null;
}

/** Input to the `simwood-sync-recordings` Edge Function (Phase-2 metadata sync). */
export interface SimwoodSyncRecordingsInput {
  tenantId: string;
  /** Simwood customer id; discovered server-side when omitted. */
  providerCustomerId?: string;
  /** ISO date — start of the sync window. Defaults server-side to now-24h. */
  from?: string;
  /** ISO date — end of the sync window. Defaults server-side to now. */
  to?: string;
  /** Filter to a single provider call id (API `callId`). */
  callId?: string;
  /** Filter to a single linked id (API `linkedId`). */
  linkedId?: string;
  /** Max records to process this run. */
  limit?: number;
}

/** Safe summary returned by `simwood-sync-recordings`. */
export interface SimwoodSyncRecordingsResult {
  success: boolean;
  provider: string;
  records_processed: number;
  from: string;
  to: string;
  customer_id: string | null;
  sync_run_id: string | null;
}

/** Input to the `simwood-download-recording` Edge Function (Phase-3 audio download). */
export interface SimwoodDownloadRecordingInput {
  tenantId: string;
  /** phone_recordings.id (a ServiceOS UUID). */
  recordingId: string;
  /** Re-download and overwrite even if audio is already stored. */
  force?: boolean;
}

/** Safe summary returned by `simwood-download-recording` (no URLs/credentials). */
export interface SimwoodDownloadRecordingResult {
  success: boolean;
  provider: string;
  recording_id: string;
  provider_recording_id: string | null;
  storage_path: string | null;
  already_downloaded: boolean;
  sync_run_id: string | null;
}

/** Input to the `phone-transcribe-recording` Edge Function (Phase-4A transcription). */
export interface PhoneTranscribeRecordingInput {
  tenantId: string;
  /** phone_recordings.id (a ServiceOS UUID). */
  recordingId: string;
  /** Re-transcribe even if a completed transcript already exists. */
  force?: boolean;
}

/** Safe summary returned by `phone-transcribe-recording` (no audio URL / key). */
export interface PhoneTranscribeRecordingResult {
  success: boolean;
  provider: string;
  recording_id: string;
  transcript_id: string | null;
  status: string;
  language: string | null;
  model: string | null;
  /** First 240 characters of the transcript only. */
  text_preview: string;
  sync_run_id: string | null;
}

/** Input to the `phone-analyse-transcript` Edge Function (Phase-4B insight extraction). */
export interface PhoneAnalyseTranscriptInput {
  tenantId: string;
  /** phone_transcripts.id (a ServiceOS UUID). */
  transcriptId: string;
  /** Re-analyse even if an insight already exists. */
  force?: boolean;
}

/** Safe summary returned by `phone-analyse-transcript`. */
export interface PhoneAnalyseTranscriptResult {
  success: boolean;
  provider: string;
  transcript_id: string;
  insight_id: string | null;
  intent: string | null;
  urgency: string | null;
  sentiment: string | null;
  action_required: boolean;
  suggested_owner: string | null;
  confidence: number | null;
  /** First 240 characters of the operational summary only. */
  summary_preview: string;
  sync_run_id: string | null;
}

/** Input to the `phone-process-pipeline` Edge Function (Phase 5A orchestrator). */
export interface ProcessPhonePipelineInput {
  tenantId: string;
  /** phone_recordings.id (a ServiceOS UUID). */
  recordingId: string;
  /** Re-run every step even if already done. */
  force?: boolean;
}

/** Combined result from `phone-process-pipeline`. */
export interface ProcessPhonePipelineResult {
  success: boolean;
  recording_id: string;
  downloaded: boolean;
  transcribed: boolean;
  analysed: boolean;
  transcript_id: string | null;
  insight_id: string | null;
  sync_run_id: string | null;
}

/** Diagnostics counts from `phone-pipeline-status`. */
export interface PhonePipelineStatusResult {
  success: boolean;
  pending: number;
  processing: number;
  failed: number;
  completed: number;
  recordings_total: number;
}
