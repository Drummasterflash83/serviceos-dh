/**
 * Tenant-scoped call feed — client-side reads under RLS (Security-2).
 *
 * Uses the browser Supabase client (the signed-in user's session), so every
 * query is filtered to the caller's tenant by the RLS SELECT policies added in
 * the Security-2 migration. NO service role, NO tenant_id passed by the client.
 *
 * The feed is composed in two RLS-scoped reads (calls, then their recordings +
 * embedded transcripts/insights) because phone_recordings links to phone_calls
 * by provider_call_id (text), which PostgREST cannot auto-embed.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult, PhoneCallDetail, PhoneFeedInput, PhoneFeedItem } from "./types";

function clampLimit(v: number | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 100;
  return Math.max(1, Math.min(500, n));
}

/**
 * Phone processing backlog (RLS-scoped browser read) — the truthful "what still
 * needs work" counts, plus the latest pipeline failure. No service role. Returns
 * ok:false when the tables can't be read (so the UI never shows a fake zero).
 */
export interface PhonePipelineBacklog {
  recordingsTotal: number;
  notDownloaded: number;
  downloaded: number;
  needTranscription: number;
  needAnalysis: number;
  latestFailureMessage: string | null;
  latestFailureAt: string | null;
}

export async function getPhonePipelineBacklog(): Promise<ApiResult<PhonePipelineBacklog>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const head = { count: "exact" as const, head: true as const };

  const cnt = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  // Probe recordings first — distinguishes "unavailable" from "empty".
  const probe = await supabase.from("phone_recordings").select("*", head);
  if (probe.error) {
    return { ok: false, error: { code: "backlog_unavailable", message: probe.error.message } };
  }
  const recordingsTotal = probe.count ?? 0;

  const [notDownloaded, transcriptsCompleted, insightsTotal, latest] = await Promise.all([
    cnt(() => supabase.from("phone_recordings").select("*", head).is("storage_path", null)),
    cnt(() => supabase.from("phone_transcripts").select("*", head).eq("status", "completed")),
    cnt(() => supabase.from("phone_ai_insights").select("*", head)),
    supabase
      .from("phone_sync_runs")
      .select("error_message, started_at")
      .eq("sync_type", "pipeline")
      .eq("status", "failed")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const nd = notDownloaded ?? 0;
  const downloaded = Math.max(0, recordingsTotal - nd);
  const completed = transcriptsCompleted ?? 0;
  const insights = insightsTotal ?? 0;
  const failRow = latest.data as { error_message: string | null; started_at: string | null } | null;

  return {
    ok: true,
    data: {
      recordingsTotal,
      notDownloaded: nd,
      downloaded,
      needTranscription: Math.max(0, downloaded - completed),
      needAnalysis: Math.max(0, completed - insights),
      latestFailureMessage: failRow?.error_message ?? null,
      latestFailureAt: failRow?.started_at ?? null,
    },
  };
}

/**
 * The tenant's configured Simwood connector account (RLS-scoped browser read),
 * or null when the connector isn't configured/enabled. This is the single source
 * of truth for the Simwood customer id and its durable sync freshness — replacing
 * the previously-hardcoded `3950`. No secrets: credentials live only in Edge
 * Function env; this reads config + watermarks from `tenant_connectors` /
 * `connector_accounts`.
 */
export interface SimwoodAccount {
  tenantConnectorId: string;
  accountId: string;
  accountKey: string;
  providerCustomerId: string;
  displayName: string | null;
  status: string;
  enabled: boolean;
  connectorStatus: string;
  connectorHealth: string;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  lastError: string | null;
}

export async function getSimwoodAccount(): Promise<ApiResult<SimwoodAccount | null>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();

  // 1) The tenant's Simwood connector (RLS scopes to the caller's tenant).
  const { data: tc, error: tcErr } = await supabase
    .from("tenant_connectors")
    .select("id, enabled, status, health_status")
    .eq("connector_id", "simwood")
    .maybeSingle();
  if (tcErr) return { ok: false, error: { code: "query_error", message: tcErr.message } };
  if (!tc || tc.enabled !== true) return { ok: true, data: null };

  // 2) Its first active account (the customer id + freshness watermarks).
  const { data: acct, error: acctErr } = await supabase
    .from("connector_accounts")
    .select(
      "id, account_key, display_name, status, settings, last_successful_sync_at, last_failed_sync_at, last_error",
    )
    .eq("tenant_connector_id", tc.id as string)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (acctErr) return { ok: false, error: { code: "query_error", message: acctErr.message } };
  if (!acct) return { ok: true, data: null };

  const settings = (acct.settings ?? {}) as Record<string, unknown>;
  const customerFromSettings = settings.provider_customer_id;
  const providerCustomerId =
    typeof customerFromSettings === "string" && customerFromSettings.trim() !== ""
      ? customerFromSettings
      : (acct.account_key as string);

  return {
    ok: true,
    data: {
      tenantConnectorId: tc.id as string,
      accountId: acct.id as string,
      accountKey: acct.account_key as string,
      providerCustomerId,
      displayName: (acct.display_name as string | null) ?? null,
      status: acct.status as string,
      enabled: true,
      connectorStatus: (tc.status as string) ?? "unknown",
      connectorHealth: (tc.health_status as string) ?? "unknown",
      lastSuccessfulSyncAt: (acct.last_successful_sync_at as string | null) ?? null,
      lastFailedSyncAt: (acct.last_failed_sync_at as string | null) ?? null,
      lastError: (acct.last_error as string | null) ?? null,
    },
  };
}

interface CallRow {
  id: string;
  provider_call_id: string | null;
  linked_id: string | null;
  direction: string | null;
  from_number: string | null;
  to_number: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  outcome: string | null;
}

interface TranscriptEmbed {
  id: string;
  status: string | null;
}

interface InsightEmbed {
  id: string;
  intent: string | null;
  urgency: string | null;
  sentiment: string | null;
  summary: string | null;
  action_required: boolean | null;
  suggested_owner: string | null;
  confidence: number | null;
}

interface RecordingRow {
  id: string;
  provider_recording_id: string | null;
  provider_call_id: string | null;
  started_at: string | null;
  phone_transcripts: TranscriptEmbed[] | null;
  phone_ai_insights: InsightEmbed[] | null;
}

/**
 * Fetch a composed, tenant-scoped call feed. Returns clean feed records; the
 * heavy transcript text is intentionally not fetched (only ids + insight
 * summary). Not wired to any UI yet.
 */
export async function getPhoneFeed(
  input: PhoneFeedInput = {},
): Promise<ApiResult<PhoneFeedItem[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const limit = clampLimit(input.limit);

  // 1) Calls — RLS scopes to the caller's tenant.
  let callQuery = supabase
    .from("phone_calls")
    .select(
      "id, provider_call_id, linked_id, direction, from_number, to_number, started_at, duration_seconds, outcome",
    )
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (input.from) callQuery = callQuery.gte("started_at", input.from);
  if (input.to) callQuery = callQuery.lte("started_at", input.to);
  if (input.direction && input.direction !== "ALL") {
    callQuery = callQuery.eq("direction", input.direction);
  }

  const { data: calls, error: callErr } = await callQuery;
  if (callErr) return { ok: false, error: { code: "query_error", message: callErr.message } };
  const callRows = (calls ?? []) as CallRow[];

  // 2) Recordings (+ transcripts + insights) for those calls, RLS-scoped too.
  const providerCallIds = Array.from(
    new Set(callRows.map((c) => c.provider_call_id).filter((x): x is string => Boolean(x))),
  );
  const recByCallId = new Map<string, RecordingRow>();
  if (providerCallIds.length > 0) {
    const { data: recs, error: recErr } = await supabase
      .from("phone_recordings")
      .select(
        "id, provider_recording_id, provider_call_id, started_at, phone_transcripts(id, status), phone_ai_insights(id, intent, urgency, sentiment, summary, action_required, suggested_owner, confidence)",
      )
      .in("provider_call_id", providerCallIds)
      .order("started_at", { ascending: false, nullsFirst: false });
    if (recErr) return { ok: false, error: { code: "query_error", message: recErr.message } };
    for (const r of (recs ?? []) as RecordingRow[]) {
      // First seen = most recent by started_at (already ordered desc).
      if (r.provider_call_id && !recByCallId.has(r.provider_call_id)) {
        recByCallId.set(r.provider_call_id, r);
      }
    }
  }

  // 3) Compose.
  let items: PhoneFeedItem[] = callRows.map((c) => {
    const rec = c.provider_call_id ? (recByCallId.get(c.provider_call_id) ?? null) : null;
    const transcript = rec?.phone_transcripts?.[0] ?? null;
    const insight = rec?.phone_ai_insights?.[0] ?? null;

    let processing_status = "call_only";
    if (insight) processing_status = "analysed";
    else if (transcript?.status === "completed") processing_status = "transcribed";
    else if (transcript) processing_status = "transcribing";
    else if (rec) processing_status = "recorded";

    return {
      call_id: c.id,
      provider_call_id: c.provider_call_id,
      linked_id: c.linked_id,
      direction: c.direction,
      from_number: c.from_number,
      to_number: c.to_number,
      started_at: c.started_at,
      duration_seconds: c.duration_seconds,
      outcome: c.outcome,
      recording_id: rec?.id ?? null,
      provider_recording_id: rec?.provider_recording_id ?? null,
      transcript_id: transcript?.id ?? null,
      insight_id: insight?.id ?? null,
      summary: insight?.summary ?? null,
      intent: insight?.intent ?? null,
      urgency: insight?.urgency ?? null,
      sentiment: insight?.sentiment ?? null,
      action_required: insight?.action_required ?? null,
      suggested_owner: insight?.suggested_owner ?? null,
      confidence: insight?.confidence ?? null,
      processing_status,
    };
  });

  if (input.actionRequiredOnly) {
    items = items.filter((i) => i.action_required === true);
  }

  return { ok: true, data: items };
}

function optStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Lazily load the heavier detail for one call — full transcript text and the
 * structured fields from the insight's raw_payload. RLS-scoped (browser client);
 * keyed by the recording id from a feed item.
 */
export async function getPhoneCallDetail(recordingId: string): Promise<ApiResult<PhoneCallDetail>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  if (typeof recordingId !== "string" || recordingId.trim() === "") {
    return {
      ok: false,
      error: { code: "invalid_recording_id", message: "recordingId is required" },
    };
  }
  const supabase = getSupabaseClient();

  const { data: t, error: tErr } = await supabase
    .from("phone_transcripts")
    .select("transcript_text, status")
    .eq("recording_id", recordingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tErr) return { ok: false, error: { code: "query_error", message: tErr.message } };

  const { data: ins, error: iErr } = await supabase
    .from("phone_ai_insights")
    .select("raw_payload")
    .eq("recording_id", recordingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (iErr) return { ok: false, error: { code: "query_error", message: iErr.message } };

  const rp = (ins?.raw_payload ?? null) as Record<string, unknown> | null;
  const raw = rp
    ? {
        customer_name: optStr(rp.customer_name),
        phone_number: optStr(rp.phone_number),
        address_or_postcode: optStr(rp.address_or_postcode),
        appliance_or_system: optStr(rp.appliance_or_system),
        fault_or_reason: optStr(rp.fault_or_reason),
        promised_action: optStr(rp.promised_action),
        risk_flags: Array.isArray(rp.risk_flags)
          ? (rp.risk_flags.filter((x) => typeof x === "string") as string[])
          : [],
      }
    : null;

  return {
    ok: true,
    data: {
      transcript_text: (t?.transcript_text as string | null) ?? null,
      transcript_status: (t?.status as string | null) ?? null,
      raw,
    },
  };
}
