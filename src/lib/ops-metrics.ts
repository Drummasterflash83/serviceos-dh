/**
 * Operations snapshot — tenant-scoped raw data, read entirely through RLS via the
 * browser Supabase client (no service role, no tenant_id passed by the client;
 * the SELECT policies filter to the caller's tenant).
 *
 * This layer is DELIBERATELY connector-agnostic: it returns raw counts + recent
 * sync runs. All per-connector derivation (status, health, metrics, logs, jobs)
 * lives in the Connector Runtime providers, so adding a connector never edits
 * this file. Every read is wrapped so RLS-empty / missing rows / errors degrade
 * to a safe zero/empty value — nothing crashes.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import { getWorkspaceConnection } from "./email-feed";

/** A row from either sync-runs table (email_sync_runs | phone_sync_runs). */
export interface SyncRunRow {
  id: string;
  provider: string;
  sync_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  records_processed: number | null;
  error_message: string | null;
}

export interface OperationsSnapshot {
  email: {
    connectionStatus: string | null;
    /** Saved connection detail (RLS read) — powers the Workspace health panel. */
    connectionDomain: string | null;
    connectionSubject: string | null;
    connectionLastVerified: string | null;
    connectionError: string | null;
    gmailOauthAccounts: number;
    gmailOauthActive: number;
    gmailLastSuccess: string | null;
    gmailLastFailure: string | null;
    gmailFailures24h: number;
    workspaceMailboxesTotal: number;
    workspaceMailboxesActive: number;
    workspaceMailboxesDisabled: number;
    workspaceLastSuccess: string | null;
    workspaceLastFailure: string | null;
    workspaceFailures24h: number;
    workspaceRunning: number;
    backfillRunning: number;
    backfillCompleted: number;
    backfillErrors: number;
    emailMessagesTotal: number;
    emailThreadsTotal: number;
    running: number;
  };
  phone: {
    callsTotal: number;
    callsToday: number;
    recordingsTotal: number;
    transcriptionsPending: number;
    transcriptionsFailed: number;
    aiPending: number;
    lastSuccess: string | null;
    lastFailure: string | null;
    testedOk: boolean;
    failures24h: number;
    running: number;
  };
  global: {
    completedToday: number;
    failedToday: number;
  };
  /** Recent runs (email + phone), newest first — the source for logs/jobs. */
  syncRuns: SyncRunRow[];
}

export const EMPTY_SNAPSHOT: OperationsSnapshot = {
  email: {
    connectionStatus: null,
    connectionDomain: null,
    connectionSubject: null,
    connectionLastVerified: null,
    connectionError: null,
    gmailOauthAccounts: 0,
    gmailOauthActive: 0,
    gmailLastSuccess: null,
    gmailLastFailure: null,
    gmailFailures24h: 0,
    workspaceMailboxesTotal: 0,
    workspaceMailboxesActive: 0,
    workspaceMailboxesDisabled: 0,
    workspaceLastSuccess: null,
    workspaceLastFailure: null,
    workspaceFailures24h: 0,
    workspaceRunning: 0,
    backfillRunning: 0,
    backfillCompleted: 0,
    backfillErrors: 0,
    emailMessagesTotal: 0,
    emailThreadsTotal: 0,
    running: 0,
  },
  phone: {
    callsTotal: 0,
    callsToday: 0,
    recordingsTotal: 0,
    transcriptionsPending: 0,
    transcriptionsFailed: 0,
    aiPending: 0,
    lastSuccess: null,
    lastFailure: null,
    testedOk: false,
    failures24h: 0,
    running: 0,
  },
  global: { completedToday: 0, failedToday: 0 },
  syncRuns: [],
};

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

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  if (!isSupabaseConfigured()) return EMPTY_SNAPSHOT;
  const supabase = getSupabaseClient();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const headCount = { count: "exact" as const, head: true as const };

  async function lastRun(
    table: "email_sync_runs" | "phone_sync_runs",
    status: "success" | "failed",
    scope?: "workspace" | "gmail",
  ): Promise<string | null> {
    try {
      let q = supabase.from(table).select("completed_at, started_at").eq("status", status);
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
    gmailOauthActive,
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
    wsRunning,
    callsTotal,
    callsToday,
    recTotal,
    transcriptsCompleted,
    transcriptsFailed,
    aiTotal,
    phoneFail24,
    phoneTested,
    emailRunning,
    phoneRunning,
    emailSuccessToday,
    phoneSuccessToday,
    emailFailedToday,
    phoneFailedToday,
    wsLast,
    wsFail,
    gmailLast,
    gmailFail,
    phoneLast,
    phoneFail,
    wsConnRes,
    emailRuns,
    phoneRuns,
  ] = await Promise.all([
    // OAuth accounts = gmail provider, excluding the DWD service statuses.
    cnt(() =>
      supabase
        .from("email_accounts")
        .select("*", headCount)
        .eq("provider", "gmail")
        .not("status", "in", '("active_dwd","pending_tokenless_dwd")'),
    ),
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
    cnt(() =>
      supabase
        .from("email_sync_runs")
        .select("*", headCount)
        .eq("status", "running")
        .like("sync_type", "workspace%"),
    ),
    cnt(() => supabase.from("phone_calls").select("*", headCount)),
    cnt(() => supabase.from("phone_calls").select("*", headCount).gte("started_at", startToday)),
    cnt(() => supabase.from("phone_recordings").select("*", headCount)),
    cnt(() => supabase.from("phone_transcripts").select("*", headCount).eq("status", "completed")),
    cnt(() => supabase.from("phone_transcripts").select("*", headCount).eq("status", "failed")),
    cnt(() => supabase.from("phone_ai_insights").select("*", headCount)),
    cnt(() =>
      supabase
        .from("phone_sync_runs")
        .select("*", headCount)
        .eq("status", "failed")
        .gte("started_at", since24h),
    ),
    cnt(() =>
      supabase
        .from("phone_sync_runs")
        .select("*", headCount)
        .eq("status", "success")
        .eq("sync_type", "test_connection"),
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
    lastRun("email_sync_runs", "success", "workspace"),
    lastRun("email_sync_runs", "failed", "workspace"),
    lastRun("email_sync_runs", "success", "gmail"),
    lastRun("email_sync_runs", "failed", "gmail"),
    lastRun("phone_sync_runs", "success"),
    lastRun("phone_sync_runs", "failed"),
    getWorkspaceConnection(),
    recentRuns("email_sync_runs"),
    recentRuns("phone_sync_runs"),
  ]);

  const wsConn = wsConnRes.ok ? wsConnRes.data : null;
  const syncRuns = [...emailRuns, ...phoneRuns]
    .filter((r) => r.started_at)
    .sort((a, b) => ((a.started_at ?? "") < (b.started_at ?? "") ? 1 : -1))
    .slice(0, 24);

  return {
    email: {
      connectionStatus: wsConn?.status ?? null,
      connectionDomain: wsConn?.domain ?? null,
      connectionSubject: wsConn?.impersonation_subject ?? null,
      connectionLastVerified: wsConn?.last_verified_at ?? null,
      connectionError: wsConn?.error_message ?? null,
      gmailOauthAccounts,
      gmailOauthActive,
      gmailLastSuccess: gmailLast,
      gmailLastFailure: gmailFail,
      gmailFailures24h: gmailFail24,
      workspaceMailboxesTotal: wsTotal,
      workspaceMailboxesActive: wsActive,
      workspaceMailboxesDisabled: wsDisabled,
      workspaceLastSuccess: wsLast,
      workspaceLastFailure: wsFail,
      workspaceFailures24h: wsFail24,
      workspaceRunning: wsRunning,
      backfillRunning,
      backfillCompleted,
      backfillErrors,
      emailMessagesTotal: emailMessages,
      emailThreadsTotal: emailThreads,
      running: emailRunning,
    },
    phone: {
      callsTotal,
      callsToday,
      recordingsTotal: recTotal,
      transcriptionsPending: Math.max(0, recTotal - transcriptsCompleted),
      transcriptionsFailed: transcriptsFailed,
      aiPending: Math.max(0, transcriptsCompleted - aiTotal),
      lastSuccess: phoneLast,
      lastFailure: phoneFail,
      testedOk: phoneTested > 0,
      failures24h: phoneFail24,
      running: phoneRunning,
    },
    global: {
      completedToday: emailSuccessToday + phoneSuccessToday,
      failedToday: emailFailedToday + phoneFailedToday,
    },
    syncRuns,
  };
}
