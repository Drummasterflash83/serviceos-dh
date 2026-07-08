/**
 * Operations Centre live metrics — tenant-scoped, read entirely through RLS via
 * the browser Supabase client (no service role, no tenant_id passed by the
 * client; the SELECT policies filter to the caller's tenant). Nothing here is
 * vendor-hardcoded beyond mapping provider/sync_type to display labels.
 *
 * Every read is wrapped so an RLS-empty result, a missing table, or a query
 * error degrades to a safe zero/empty value — the dashboard never crashes.
 */

import { useCallback, useEffect, useState } from "react";

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import { getWorkspaceConnection } from "./email-feed";
import type { ConnectorHealth, ConnectorStatus } from "./connectors/types";

// ── Types (public) ──────────────────────────────────────────────────────────

export interface ConnectorMetricSummary {
  id: string;
  name: string;
  provider: string;
  /** Has real config/data for this tenant. */
  present: boolean;
  status: ConnectorStatus;
  health: ConnectorHealth;
  metrics: { label: string; value: string | number; hint?: string }[];
  lastSyncAt: string | null;
  errors24h: number;
}

export interface OperationsActivityItem {
  id: string;
  timestamp: string;
  system: string;
  event: string;
  status: string;
  summary: string;
}

export interface OperationsAlertItem {
  id: string;
  severity: "info" | "warning" | "critical";
  system: string;
  message: string;
  timestamp: string;
}

export interface OperationsMetrics {
  platform: {
    connected_systems: number;
    healthy_systems: number;
    warning_systems: number;
    critical_systems: number;
  };
  email: {
    gmail_oauth_accounts: number;
    workspace_mailboxes_total: number;
    workspace_mailboxes_active: number;
    workspace_mailboxes_disabled: number;
    recent_email_sync_last_success: string | null;
    recent_email_sync_failures_24h: number;
    backfill_running: number;
    backfill_completed: number;
    backfill_errors: number;
    email_messages_total: number;
    email_threads_total: number;
  };
  phone: {
    phone_calls_total: number;
    phone_calls_today: number;
    phone_recordings_total: number;
    phone_transcriptions_pending: number;
    phone_ai_pending: number;
    phone_last_sync_success: string | null;
    phone_sync_failures_24h: number;
  };
  jobs: {
    running: number;
    queued: number;
    completed_today: number;
    failed_today: number;
    retry_placeholder: number;
  };
  connectors: ConnectorMetricSummary[];
  activity: OperationsActivityItem[];
  alerts: OperationsAlertItem[];
}

// ── Empty (unconfigured / no-data) baseline ─────────────────────────────────

const EMPTY: OperationsMetrics = {
  platform: { connected_systems: 0, healthy_systems: 0, warning_systems: 0, critical_systems: 0 },
  email: {
    gmail_oauth_accounts: 0,
    workspace_mailboxes_total: 0,
    workspace_mailboxes_active: 0,
    workspace_mailboxes_disabled: 0,
    recent_email_sync_last_success: null,
    recent_email_sync_failures_24h: 0,
    backfill_running: 0,
    backfill_completed: 0,
    backfill_errors: 0,
    email_messages_total: 0,
    email_threads_total: 0,
  },
  phone: {
    phone_calls_total: 0,
    phone_calls_today: 0,
    phone_recordings_total: 0,
    phone_transcriptions_pending: 0,
    phone_ai_pending: 0,
    phone_last_sync_success: null,
    phone_sync_failures_24h: 0,
  },
  jobs: { running: 0, queued: 0, completed_today: 0, failed_today: 0, retry_placeholder: 0 },
  connectors: [],
  activity: [],
  alerts: [],
};

// ── Display mapping (the only vendor knowledge, kept declarative) ────────────

function isWorkspaceSyncType(syncType: string): boolean {
  return syncType.startsWith("workspace");
}

function systemLabel(provider: string, syncType: string): string {
  if (provider === "simwood") return "Phone · Simwood";
  if (provider === "google_workspace") return "Email · Google Workspace";
  if (provider === "gmail") {
    return isWorkspaceSyncType(syncType) ? "Email · Google Workspace" : "Email · Gmail";
  }
  return provider;
}

const EVENT_LABELS: Record<string, string> = {
  messages: "Message sync",
  workspace_messages: "Workspace sync",
  scheduled_sync: "Scheduled sync",
  workspace_scheduled_sync: "Scheduled sync",
  workspace_backfill: "Historical backfill",
  workspace_backfill_scheduled: "Backfill (scheduled)",
  workspace_discover: "Mailbox discovery",
  workspace_test: "Connection test",
  oauth: "OAuth connect",
  calls: "Call sync",
  recordings: "Recording sync",
  scheduled: "Scheduled sync",
  test_connection: "Connection test",
  transcripts: "Transcription",
  insights: "AI enrichment",
};

function eventLabel(syncType: string): string {
  return EVENT_LABELS[syncType] ?? syncType.replace(/_/g, " ");
}

// ── Read helpers (RLS-scoped; never throw) ──────────────────────────────────

/** A thenable that resolves to a PostgREST count response. */
type CountQuery = PromiseLike<{ count: number | null; error: unknown }>;

async function cnt(build: () => CountQuery): Promise<number> {
  try {
    const { count, error } = await build();
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

interface SyncRunRow {
  id: string;
  provider: string;
  sync_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  records_processed: number | null;
  error_message: string | null;
}

// ── Main fetch ──────────────────────────────────────────────────────────────

export async function getOperationsMetrics(): Promise<OperationsMetrics> {
  if (!isSupabaseConfigured()) return EMPTY;
  const supabase = getSupabaseClient();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const headCount = { count: "exact" as const, head: true as const };

  /** Latest success timestamp on a sync-runs table (optionally scoped). */
  async function lastSuccess(
    table: "email_sync_runs" | "phone_sync_runs",
    scope?: "workspace" | "gmail",
  ): Promise<string | null> {
    try {
      let q = supabase.from(table).select("completed_at, started_at").eq("status", "success");
      if (scope === "workspace") q = q.like("sync_type", "workspace%");
      else if (scope === "gmail") q = q.not("sync_type", "like", "workspace%");
      const { data } = await q.order("started_at", { ascending: false }).limit(1).maybeSingle();
      const row = data as { completed_at: string | null; started_at: string | null } | null;
      return row?.completed_at ?? row?.started_at ?? null;
    } catch {
      return null;
    }
  }

  async function recentRuns(table: "email_sync_runs" | "phone_sync_runs"): Promise<SyncRunRow[]> {
    try {
      const { data, error } = await supabase
        .from(table)
        .select(
          "id, provider, sync_type, status, started_at, completed_at, records_processed, error_message",
        )
        .order("started_at", { ascending: false })
        .limit(15);
      return error ? [] : ((data ?? []) as SyncRunRow[]);
    } catch {
      return [];
    }
  }

  const [
    gmailOauthAccounts,
    wsTotal,
    wsActive,
    wsDisabled,
    backfillRunning,
    backfillCompleted,
    backfillErrors,
    emailMessages,
    emailThreads,
    wsFail24,
    gmailFail24,
    callsTotal,
    callsToday,
    recTotal,
    transcriptsCompleted,
    aiTotal,
    phoneFail24,
    emailRunning,
    phoneRunning,
    emailSuccessToday,
    phoneSuccessToday,
    emailFailedToday,
    phoneFailedToday,
    wsLast,
    gmailLast,
    phoneLast,
    wsConnRes,
    emailRuns,
    phoneRuns,
  ] = await Promise.all([
    cnt(() =>
      supabase
        .from("email_accounts")
        .select("*", headCount)
        .eq("provider", "gmail")
        .eq("status", "active"),
    ),
    cnt(() => supabase.from("google_workspace_mailboxes").select("*", headCount)),
    cnt(() =>
      supabase.from("google_workspace_mailboxes").select("*", headCount).eq("sync_enabled", true),
    ),
    cnt(() =>
      supabase.from("google_workspace_mailboxes").select("*", headCount).eq("sync_enabled", false),
    ),
    cnt(() =>
      supabase.from("email_accounts").select("*", headCount).eq("backfill_status", "running"),
    ),
    cnt(() =>
      supabase.from("email_accounts").select("*", headCount).eq("backfill_status", "completed"),
    ),
    cnt(() =>
      supabase.from("email_accounts").select("*", headCount).eq("backfill_status", "error"),
    ),
    cnt(() => supabase.from("email_messages").select("*", headCount)),
    cnt(() => supabase.from("email_threads").select("*", headCount)),
    cnt(() =>
      supabase
        .from("email_sync_runs")
        .select("*", headCount)
        .eq("status", "failed")
        .gte("started_at", since24h)
        .like("sync_type", "workspace%"),
    ),
    cnt(() =>
      supabase
        .from("email_sync_runs")
        .select("*", headCount)
        .eq("status", "failed")
        .gte("started_at", since24h)
        .not("sync_type", "like", "workspace%"),
    ),
    cnt(() => supabase.from("phone_calls").select("*", headCount)),
    cnt(() => supabase.from("phone_calls").select("*", headCount).gte("started_at", startToday)),
    cnt(() => supabase.from("phone_recordings").select("*", headCount)),
    cnt(() => supabase.from("phone_transcripts").select("*", headCount).eq("status", "completed")),
    cnt(() => supabase.from("phone_ai_insights").select("*", headCount)),
    cnt(() =>
      supabase
        .from("phone_sync_runs")
        .select("*", headCount)
        .eq("status", "failed")
        .gte("started_at", since24h),
    ),
    cnt(() => supabase.from("email_sync_runs").select("*", headCount).eq("status", "running")),
    cnt(() => supabase.from("phone_sync_runs").select("*", headCount).eq("status", "running")),
    cnt(() =>
      supabase
        .from("email_sync_runs")
        .select("*", headCount)
        .eq("status", "success")
        .gte("started_at", startToday),
    ),
    cnt(() =>
      supabase
        .from("phone_sync_runs")
        .select("*", headCount)
        .eq("status", "success")
        .gte("started_at", startToday),
    ),
    cnt(() =>
      supabase
        .from("email_sync_runs")
        .select("*", headCount)
        .eq("status", "failed")
        .gte("started_at", startToday),
    ),
    cnt(() =>
      supabase
        .from("phone_sync_runs")
        .select("*", headCount)
        .eq("status", "failed")
        .gte("started_at", startToday),
    ),
    lastSuccess("email_sync_runs", "workspace"),
    lastSuccess("email_sync_runs", "gmail"),
    lastSuccess("phone_sync_runs"),
    getWorkspaceConnection(),
    recentRuns("email_sync_runs"),
    recentRuns("phone_sync_runs"),
  ]);

  const wsConn = wsConnRes.ok ? wsConnRes.data : null;

  const transcriptionsPending = Math.max(0, recTotal - transcriptsCompleted);
  const aiPending = Math.max(0, transcriptsCompleted - aiTotal);
  const emailFail24 = wsFail24 + gmailFail24;
  const emailLast = [wsLast, gmailLast].filter(Boolean).sort().at(-1) ?? null;

  // ── Per-connector summaries (only "present" ones count toward platform) ────
  const connectors: ConnectorMetricSummary[] = [];

  // Google Workspace
  {
    const present = wsTotal > 0 || wsConn !== null;
    let status: ConnectorStatus = present ? "connected" : "offline";
    let health: ConnectorHealth = present ? "healthy" : "unknown";
    if (wsConn?.status === "error") {
      status = "error";
      health = "critical";
    } else if (backfillRunning > 0) {
      status = "syncing";
    }
    if (health === "healthy" && (wsFail24 > 0 || backfillErrors > 0)) health = "warning";
    connectors.push({
      id: "google_workspace",
      name: "Google Workspace",
      provider: "Google",
      present,
      status,
      health,
      metrics: [
        { label: "Mailboxes", value: wsTotal },
        { label: "Active", value: wsActive },
        { label: "Disabled", value: wsDisabled },
        {
          label: "Backfill",
          value: backfillRunning > 0 ? `${backfillRunning} running` : `${backfillCompleted} done`,
        },
      ],
      lastSyncAt: wsLast,
      errors24h: wsFail24,
    });
  }

  // Gmail OAuth
  {
    const present = gmailOauthAccounts > 0;
    const status: ConnectorStatus = present ? "connected" : "offline";
    let health: ConnectorHealth = present ? "healthy" : "unknown";
    if (health === "healthy" && gmailFail24 > 0) health = "warning";
    connectors.push({
      id: "gmail",
      name: "Gmail (OAuth)",
      provider: "Google",
      present,
      status,
      health,
      metrics: [
        { label: "Accounts", value: gmailOauthAccounts },
        { label: "Failures 24h", value: gmailFail24 },
      ],
      lastSyncAt: gmailLast,
      errors24h: gmailFail24,
    });
  }

  // Phone / Simwood
  {
    const present = callsTotal > 0 || recTotal > 0 || phoneLast !== null;
    const status: ConnectorStatus = present ? "connected" : "offline";
    let health: ConnectorHealth = present ? "healthy" : "unknown";
    if (health === "healthy" && phoneFail24 > 0) health = "warning";
    connectors.push({
      id: "simwood",
      name: "Phone / VoIP",
      provider: "Simwood",
      present,
      status,
      health,
      metrics: [
        { label: "Calls today", value: callsToday },
        { label: "Recordings", value: recTotal },
        { label: "Pending transcribe", value: transcriptionsPending },
      ],
      lastSyncAt: phoneLast,
      errors24h: phoneFail24,
    });
  }

  const presentConnectors = connectors.filter((c) => c.present);
  const platform = {
    connected_systems: presentConnectors.length,
    healthy_systems: presentConnectors.filter((c) => c.health === "healthy").length,
    warning_systems: presentConnectors.filter((c) => c.health === "warning").length,
    critical_systems: presentConnectors.filter((c) => c.health === "critical").length,
  };

  // ── Activity feed (merge email + phone runs, newest first) ─────────────────
  const activity: OperationsActivityItem[] = [...emailRuns, ...phoneRuns]
    .map((r) => {
      const ts = r.completed_at ?? r.started_at ?? "";
      const summary =
        r.status === "failed"
          ? (r.error_message ?? "failed")
          : `${r.records_processed ?? 0} processed`;
      return {
        id: r.id,
        timestamp: ts,
        system: systemLabel(r.provider, r.sync_type),
        event: eventLabel(r.sync_type),
        status: r.status,
        summary,
      };
    })
    .filter((a) => a.timestamp)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 12);

  // ── Alerts (failed runs in the last 24h) ───────────────────────────────────
  const alerts: OperationsAlertItem[] = [...emailRuns, ...phoneRuns]
    .filter((r) => r.status === "failed" && (r.started_at ?? "") >= since24h)
    .map((r) => ({
      id: r.id,
      severity: "warning" as const,
      system: systemLabel(r.provider, r.sync_type),
      message: `${eventLabel(r.sync_type)} failed${r.error_message ? `: ${r.error_message}` : ""}`,
      timestamp: r.completed_at ?? r.started_at ?? "",
    }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 8);

  return {
    platform,
    email: {
      gmail_oauth_accounts: gmailOauthAccounts,
      workspace_mailboxes_total: wsTotal,
      workspace_mailboxes_active: wsActive,
      workspace_mailboxes_disabled: wsDisabled,
      recent_email_sync_last_success: emailLast,
      recent_email_sync_failures_24h: emailFail24,
      backfill_running: backfillRunning,
      backfill_completed: backfillCompleted,
      backfill_errors: backfillErrors,
      email_messages_total: emailMessages,
      email_threads_total: emailThreads,
    },
    phone: {
      phone_calls_total: callsTotal,
      phone_calls_today: callsToday,
      phone_recordings_total: recTotal,
      phone_transcriptions_pending: transcriptionsPending,
      phone_ai_pending: aiPending,
      phone_last_sync_success: phoneLast,
      phone_sync_failures_24h: phoneFail24,
    },
    jobs: {
      running: emailRunning + phoneRunning,
      queued: backfillRunning,
      completed_today: emailSuccessToday + phoneSuccessToday,
      failed_today: emailFailedToday + phoneFailedToday,
      retry_placeholder: 0,
    },
    connectors,
    activity,
    alerts,
  };
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface UseOperationsMetrics {
  data: OperationsMetrics | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOperationsMetrics(): UseOperationsMetrics {
  const [data, setData] = useState<OperationsMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getOperationsMetrics());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load operations metrics");
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
