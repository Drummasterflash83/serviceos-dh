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

/** Filters for the tenant-scoped call feed (client-side RLS reads). */
export interface PhoneFeedInput {
  /** ISO date — inclusive lower bound on call start. */
  from?: string;
  /** ISO date — inclusive upper bound on call start. */
  to?: string;
  /** Max calls to return (clamped server-side of the client). */
  limit?: number;
  direction?: "IN" | "OUT" | "ALL";
  /** Only calls whose AI insight flags action_required. */
  actionRequiredOnly?: boolean;
}

/** One composed feed record (call + recording + transcript + insight). */
export interface PhoneFeedItem {
  call_id: string;
  provider_call_id: string | null;
  linked_id: string | null;
  direction: string | null;
  from_number: string | null;
  to_number: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  recording_id: string | null;
  provider_recording_id: string | null;
  transcript_id: string | null;
  insight_id: string | null;
  summary: string | null;
  intent: string | null;
  urgency: string | null;
  sentiment: string | null;
  action_required: boolean | null;
  suggested_owner: string | null;
  confidence: number | null;
  /** Derived: analysed | transcribed | transcribing | recorded | call_only. */
  processing_status: string;
}

// ---------------------------------------------------------------------------
// Email Input (Phase-0) — schema/shape only. Mirrors the phone_* model: these
// row types describe what the RLS-scoped browser client reads; no writes.
// ---------------------------------------------------------------------------

/** A row from `email_accounts` (one connected mailbox per tenant/provider). */
export interface EmailAccount {
  id: string;
  tenant_id: string;
  provider: string;
  email_address: string | null;
  display_name: string | null;
  /** pending | active | error | disabled */
  status: string;
  created_at: string;
  updated_at: string;
}

/** A row from `email_threads` (conversation grouping). */
export interface EmailThread {
  id: string;
  tenant_id: string;
  provider: string;
  provider_thread_id: string | null;
  subject: string | null;
  participants: string[];
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A row from `email_messages` (one individual message). */
export interface EmailMessage {
  id: string;
  tenant_id: string;
  provider: string;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  received_at: string | null;
  /** inbound | outbound */
  direction: string | null;
  created_at: string;
  updated_at: string;
}

/** A row from `email_ai_insights` (advisory AI enrichment per message/thread). */
export interface EmailInsight {
  id: string;
  tenant_id: string;
  message_id: string | null;
  thread_id: string | null;
  intent: string | null;
  urgency: string | null;
  sentiment: string | null;
  summary: string | null;
  action_required: boolean | null;
  suggested_owner: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

/** Result of the `gmail-oauth-start` Edge Function (Email Phase-1). */
export interface GmailOAuthStartResult {
  success: boolean;
  /** Google consent URL the browser should be redirected to. */
  auth_url: string;
}

/** Safe summary from `google-workspace-test-connection` (Email Phase-1B). */
export interface GoogleWorkspaceTestResult {
  success: boolean;
  /** The verified Workspace domain. */
  domain: string;
  /** The mailbox that was impersonated for the test. */
  impersonated: string;
  /** Scopes Google granted to the delegated token. */
  scopes: string[];
}

/** Input to the `gmail-sync-messages` Edge Function (Email Phase-2). */
export interface GmailSyncMessagesInput {
  /** email_accounts.id (a ServiceOS UUID) for the connected Gmail mailbox. */
  emailAccountId: string;
  /** Re-fetch and re-upsert messages even if already stored. */
  force?: boolean;
  /** Max message ids to list per label (INBOX, SENT). Clamped 1–100 server-side. */
  maxResults?: number;
}

/** Safe summary returned by `gmail-sync-messages` (no tokens, no bodies). */
export interface GmailSyncMessagesResult {
  success: boolean;
  provider: string;
  email_account_id: string;
  records_processed: number;
  threads_processed: number;
  mailbox: string | null;
  sync_run_id: string | null;
}

/** Filters for the tenant-scoped email feed (client-side RLS reads). */
export interface EmailFeedInput {
  /** ISO date — inclusive lower bound on the thread's last message. */
  from?: string;
  /** ISO date — inclusive upper bound on the thread's last message. */
  to?: string;
  /** Max threads to return (clamped inside the helper). */
  limit?: number;
  /** Filter by the latest message's direction. */
  direction?: "inbound" | "outbound" | "ALL";
  /** Only threads whose latest message's AI insight flags action_required. */
  actionRequiredOnly?: boolean;
}

/** One composed feed record (thread + its latest message + that message's insight). */
export interface EmailFeedItem {
  thread_id: string;
  provider_thread_id: string | null;
  subject: string | null;
  participants: string[];
  last_message_at: string | null;
  /** The most recent message in the thread. */
  latest_message_id: string | null;
  from_email: string | null;
  from_name: string | null;
  snippet: string | null;
  direction: string | null;
  insight_id: string | null;
  summary: string | null;
  intent: string | null;
  urgency: string | null;
  sentiment: string | null;
  action_required: boolean | null;
  suggested_owner: string | null;
  confidence: number | null;
  /** Derived: analysed | received. */
  processing_status: string;
}

/** One message within a thread detail (includes bodies + best-effort insight). */
export interface EmailThreadMessage {
  message_id: string;
  provider_message_id: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  received_at: string | null;
  direction: string | null;
  insight: EmailInsight | null;
}

/** Lazily-loaded detail for one thread (meta + ordered messages with bodies). */
export interface EmailThreadDetail {
  thread_id: string;
  provider_thread_id: string | null;
  subject: string | null;
  participants: string[];
  last_message_at: string | null;
  messages: EmailThreadMessage[];
}

/** Structured fields extracted from an insight's raw_payload (best-effort). */
export interface PhoneCallDetailRaw {
  customer_name: string | null;
  phone_number: string | null;
  address_or_postcode: string | null;
  appliance_or_system: string | null;
  fault_or_reason: string | null;
  promised_action: string | null;
  risk_flags: string[];
}

/** Lazily-loaded detail for one call (full transcript + raw insight fields). */
export interface PhoneCallDetail {
  transcript_text: string | null;
  transcript_status: string | null;
  raw: PhoneCallDetailRaw | null;
}
