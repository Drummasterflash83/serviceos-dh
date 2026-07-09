/**
 * Live Call Card — tenant-scoped reads (RLS browser client) + realtime + safe
 * session actions (via Edge Functions). A user only ever sees calls assigned to
 * THEM: every read filters `assigned_user_id = current user`, and RLS guarantees
 * tenant isolation. No service role in the frontend.
 *
 * The card's context model is provider-agnostic (Commusoft-ready): `context`
 * holds related_jobs/sites/assets/tasks/notes/documents/financials — empty in v1.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type LiveCallStatus = "ringing" | "answered" | "completed" | "missed" | "failed";
export type LiveCallMatchStatus = "unmatched" | "possible" | "likely" | "confirmed" | "rejected";

export interface LiveCallMatchEvidence {
  type: string;
  detail: string;
  count?: number;
  [key: string]: unknown;
}

/** Provider-agnostic job/customer context (Commusoft & others fill this later). */
export interface LiveCallContext {
  related_jobs?: unknown[];
  related_sites?: unknown[];
  related_assets?: unknown[];
  related_tasks?: unknown[];
  related_notes?: unknown[];
  related_documents?: unknown[];
  related_financials?: unknown[];
}

export interface LiveCallSession {
  id: string;
  tenant_id: string;
  provider: string;
  provider_call_id: string;
  caller_number: string | null;
  callee_number: string | null;
  extension: string | null;
  direction: string | null;
  assigned_user_id: string | null;
  status: LiveCallStatus | string;
  started_at: string;
  answered_at: string | null;
  completed_at: string | null;
  latest_event_at: string;
  dismissed_at: string | null;
  match_status: LiveCallMatchStatus | string;
  matched_person_id: string | null;
  matched_company_id: string | null;
  matched_job_id: string | null;
  confidence: number | null;
  evidence: LiveCallMatchEvidence[];
  context: LiveCallContext;
  created_at: string;
  updated_at: string;
}

export interface LiveCallEvent {
  id: string;
  tenant_id: string;
  provider: string;
  provider_call_id: string | null;
  event_type: string;
  caller_number: string | null;
  callee_number: string | null;
  extension: string | null;
  occurred_at: string;
}

export interface UserVoiceEndpoint {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  extension: string;
  display_name: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

const SESSION_COLUMNS =
  "id, tenant_id, provider, provider_call_id, caller_number, callee_number, extension, direction, assigned_user_id, status, started_at, answered_at, completed_at, latest_event_at, dismissed_at, match_status, matched_person_id, matched_company_id, matched_job_id, confidence, evidence, context, created_at, updated_at";

async function currentUserId(): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * The current user's ACTIVE live calls (ringing/answered, not dismissed), newest
 * first. Returns [] when the user isn't resolved — never another user's calls.
 */
export async function listMyLiveCallSessions(): Promise<ApiResult<LiveCallSession[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const userId = await currentUserId();
  if (!userId) return { ok: true, data: [] };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("live_call_sessions")
    .select(SESSION_COLUMNS)
    .eq("assigned_user_id", userId)
    .in("status", ["ringing", "answered"])
    .is("dismissed_at", null)
    .order("latest_event_at", { ascending: false })
    .limit(5);
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data ?? []) as LiveCallSession[] };
}

/**
 * Subscribe to the current user's live-call session changes (Supabase realtime,
 * RLS-scoped). Calls `onChange` on any insert/update. Returns an unsubscribe fn.
 * A polling fallback lives in the component in case realtime isn't enabled.
 */
export function subscribeMyLiveCallSessions(userId: string, onChange: () => void): () => void {
  if (!isSupabaseConfigured() || !userId) return () => {};
  const supabase = getSupabaseClient();
  const channel = supabase
    .channel(`live-calls-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "live_call_sessions",
        filter: `assigned_user_id=eq.${userId}`,
      },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

async function invokeSessionAction(
  sessionId: string,
  action: "confirm" | "reject" | "dismiss",
): Promise<ApiResult<{ id: string }>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("live-call-session-update", {
    body: { session_id: sessionId, action },
  });
  if (error) return { ok: false, error: { code: "update_failed", message: error.message } };
  return { ok: true, data: data as { id: string } };
}

/** Confirm or reject the current match (placeholder linking is future work). */
export function updateLiveCallSessionMatch(
  sessionId: string,
  input: { action: "confirm" | "reject" },
): Promise<ApiResult<{ id: string }>> {
  return invokeSessionAction(sessionId, input.action);
}

export function dismissLiveCallSession(sessionId: string): Promise<ApiResult<{ id: string }>> {
  return invokeSessionAction(sessionId, "dismiss");
}

// --- Voice endpoint mapping (owner/admin/ops) -----------------------------

export async function listVoiceEndpoints(): Promise<ApiResult<UserVoiceEndpoint[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("user_voice_endpoints")
    .select(
      "id, tenant_id, user_id, provider, extension, display_name, enabled, created_at, updated_at",
    )
    .order("extension", { ascending: true });
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data ?? []) as UserVoiceEndpoint[] };
}

export interface SaveVoiceEndpointInput {
  extension: string;
  userId?: string;
  email?: string;
  displayName?: string;
  enabled?: boolean;
}

export async function saveVoiceEndpoint(
  input: SaveVoiceEndpointInput,
): Promise<ApiResult<{ id: string | null }>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("voice-endpoints-manage", {
    body: {
      action: "upsert",
      extension: input.extension,
      user_id: input.userId,
      email: input.email,
      display_name: input.displayName,
      enabled: input.enabled,
    },
  });
  if (error) return { ok: false, error: { code: "save_failed", message: error.message } };
  return { ok: true, data: data as { id: string | null } };
}

export async function disableVoiceEndpoint(id: string): Promise<ApiResult<null>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke("voice-endpoints-manage", {
    body: { action: "disable", id },
  });
  if (error) return { ok: false, error: { code: "disable_failed", message: error.message } };
  return { ok: true, data: null };
}

// --- Operations Centre summary --------------------------------------------

export interface LiveCallOpsSummary {
  active: number;
  unassigned: number;
  latestEventAt: string | null;
  mappings: number;
}

export async function getLiveCallOpsSummary(): Promise<ApiResult<LiveCallOpsSummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const head = { count: "exact" as const, head: true as const };
  const count = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  const probe = await supabase
    .from("live_call_sessions")
    .select("*", head)
    .in("status", ["ringing", "answered"])
    .is("dismissed_at", null);
  if (probe.error) {
    return { ok: false, error: { code: "live_calls_unavailable", message: probe.error.message } };
  }

  const [unassigned, mappings, latest] = await Promise.all([
    count(() =>
      supabase
        .from("live_call_sessions")
        .select("*", head)
        .in("status", ["ringing", "answered"])
        .is("dismissed_at", null)
        .is("assigned_user_id", null),
    ),
    count(() => supabase.from("user_voice_endpoints").select("*", head).eq("enabled", true)),
    supabase
      .from("live_call_events")
      .select("occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    ok: true,
    data: {
      active: probe.count ?? 0,
      unassigned: unassigned ?? 0,
      latestEventAt: (latest.data as { occurred_at: string } | null)?.occurred_at ?? null,
      mappings: mappings ?? 0,
    },
  };
}
