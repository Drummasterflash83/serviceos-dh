/**
 * EmailOperations — the Gmail + Google Workspace dashboard (Communications ›
 * Email). Extracted from the former AdminView with NO behaviour change: the same
 * API calls, handlers and controls (OAuth connect, Workspace save/test, mailbox
 * discover/enable/disable/sync, historical backfill).
 *
 * Reorganised per the operations-first philosophy: mailbox management is primary;
 * the connection setup collapses automatically once the Workspace is active.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mail, Building2, ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  startGmailOAuth,
  saveGoogleWorkspaceConnection,
  testGoogleWorkspaceConnection,
  discoverGoogleWorkspaceMailboxes,
  updateGoogleWorkspaceMailboxes,
  syncGmailMessages,
  syncGmailWorkspaceMessages,
  backfillGmailWorkspaceMessages,
  getEmailConnectorStatus,
} from "@/lib/api";
import {
  listEmailAccounts,
  listWorkspaceMailboxes,
  getWorkspaceConnection,
  getWorkspaceSyncState,
  type WorkspaceSyncState,
} from "@/lib/email-feed";
import type {
  ApiResult,
  GoogleWorkspaceTestResult,
  GoogleWorkspaceSaveConnectionResult,
  GoogleWorkspaceConnection,
  GoogleWorkspaceDiscoverMailboxesResult,
  GoogleWorkspaceUpdateMailboxesResult,
  GoogleWorkspaceMailboxWithAccount,
  GmailSyncMessagesResult,
  GmailWorkspaceBackfillResult,
  EmailAccount,
  EmailConnectorStatusResult,
  EmailConnectorDiagItem,
} from "@/lib/types";
import { ConnectorStatusBadge, MetricCard } from "@/components/ops";
import type { ConnectorStatus } from "@/lib/connectors/types";
import type { ConnectorSurfaceProps } from "@/lib/runtime/types";
import { ADMIN_ROLES, RestrictedNotice, StatusPanel } from "./StatusPanel";

/** Map a stored connection status to the standard connector badge status. */
function connStatus(status: string | null | undefined): ConnectorStatus {
  switch (status) {
    case "active":
      return "connected";
    case "pending_authorization":
      return "authorising";
    case "error":
      return "error";
    case "disabled":
      return "disabled";
    default:
      return "warning";
  }
}

/** Compact relative time ("3m ago", "2h ago", "never") for sync timestamps. */
function fmtAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Authoritative email-health helpers (email-connector-status is the sole source) ──
const EMAIL_STATE_TONE: Record<string, string> = {
  connected_healthy: "border-success/20 bg-success/10 text-success",
  backfill_running: "border-accent/20 bg-accent/10 text-accent",
  connected_stale: "border-warning/30 bg-warning/10 text-warning",
  no_mailboxes: "border-warning/30 bg-warning/10 text-warning",
  needs_setup: "border-hairline bg-surface-alt text-muted-foreground",
  disabled: "border-hairline bg-surface-alt text-muted-foreground",
  unknown: "border-hairline bg-surface-alt text-muted-foreground",
  connected_failing: "border-destructive/30 bg-destructive/10 text-destructive",
  auth_expired: "border-destructive/30 bg-destructive/10 text-destructive",
  delegation_failed: "border-destructive/30 bg-destructive/10 text-destructive",
  backfill_failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

function emailStateBadge(state: string): ConnectorStatus {
  if (state === "connected_healthy" || state === "backfill_running") return "connected";
  if (
    state === "connected_failing" ||
    state === "auth_expired" ||
    state === "delegation_failed" ||
    state === "backfill_failed"
  ) {
    return "error";
  }
  if (state === "disabled") return "disabled";
  return "warning";
}

// Permanent (non-retryable) codes — a row carrying one is effectively dead-lettered.
const PERMANENT_ERROR_CODES = new Set([
  "refresh_token_revoked",
  "oauth_client_invalid",
  "refresh_forbidden",
  "needs_reconnect",
  "token_expired",
  "no_token",
  "sa_config_missing",
  "sa_credentials_invalid",
  "admin_delegation_missing",
  "scopes_missing",
  "subject_invalid",
  "mailbox_disabled",
  "not_dwd_account",
]);

type DiagBucket =
  | "healthy"
  | "stale"
  | "failing"
  | "auth_expired"
  | "delegation_failed"
  | "backfill_running"
  | "dead_letter";

/** Derive one honest per-row bucket from real fields (a later success = healthy). */
function rowBucket(d: EmailConnectorDiagItem, workspaceDelegationFailing: boolean): DiagBucket {
  const auth = d.auth_state ?? "";
  if (auth === "revoked" || auth === "needs_reconnect" || auth === "expired") return "auth_expired";
  if (d.connector === "workspace" && workspaceDelegationFailing) return "delegation_failed";
  if (d.backfill_status === "running") return "backfill_running";
  if (d.last_error && PERMANENT_ERROR_CODES.has(d.last_error)) return "dead_letter";
  if (d.last_error) return "failing";
  if (!d.last_success_at) return "stale";
  const ageMin = (Date.now() - Date.parse(d.last_success_at)) / 60000;
  if (Number.isNaN(ageMin) || ageMin > 15) return "stale";
  return "healthy";
}

function recommendedAction(bucket: DiagBucket): string {
  switch (bucket) {
    case "auth_expired":
      return "Reconnect (permanent auth)";
    case "delegation_failed":
      return "Re-test delegation";
    case "dead_letter":
      return "Investigate — permanent error";
    case "failing":
      return "Retry — transient";
    case "backfill_running":
      return "Backfill in progress";
    case "stale":
      return "Waiting for scheduler";
    default:
      return "—";
  }
}

const DIAG_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "gmail", label: "Gmail OAuth" },
  { key: "workspace", label: "Workspace" },
  { key: "healthy", label: "Healthy" },
  { key: "stale", label: "Stale" },
  { key: "failing", label: "Failing" },
  { key: "auth_expired", label: "Auth expired" },
  { key: "delegation_failed", label: "Delegation failed" },
  { key: "backfill_running", label: "Backfill running" },
  { key: "dead_letter", label: "Dead-letter" },
];

export function EmailOperations({ focus, focusNonce }: ConnectorSurfaceProps = {}) {
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  const tenantId = profile?.tenant_id ?? "";
  const allowed = role !== null && (ADMIN_ROLES as readonly string[]).includes(role);

  // Authoritative email health — the SOLE health source (email-connector-status).
  const [emailHealth, setEmailHealth] = useState<ApiResult<EmailConnectorStatusResult> | null>(
    null,
  );
  const [diagFilter, setDiagFilter] = useState("all");

  // Gmail OAuth connect (Email Phase-1).
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);

  async function connectGmail() {
    setConnectingGmail(true);
    setGmailError(null);
    const res = await startGmailOAuth();
    if (res.ok) {
      window.location.href = res.data.auth_url; // leaves the app for Google
      return;
    }
    setGmailError(`${res.error.code}: ${res.error.message}`);
    setConnectingGmail(false);
  }

  // Gmail message sync (Email Phase-2).
  const [gmailAccounts, setGmailAccounts] = useState<EmailAccount[]>([]);
  const [emailAccountId, setEmailAccountId] = useState("");
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [gmailSync, setGmailSync] = useState<ApiResult<GmailSyncMessagesResult> | null>(null);

  async function runGmailSync() {
    const id = emailAccountId.trim();
    if (!id) return;
    setSyncingGmail(true);
    setGmailSync(await syncGmailMessages({ emailAccountId: id }));
    setSyncingGmail(false);
  }

  // Workspace SaaS connection config (per-tenant domain + admin subject).
  const [wsConn, setWsConn] = useState<GoogleWorkspaceConnection | null>(null);
  const [wsDomain, setWsDomain] = useState("");
  const [wsSubject, setWsSubject] = useState("");
  const [wsSaving, setWsSaving] = useState(false);
  const [wsSave, setWsSave] = useState<ApiResult<GoogleWorkspaceSaveConnectionResult> | null>(null);

  async function runSaveConnection() {
    if (!wsDomain.trim() || !wsSubject.trim()) return;
    setWsSaving(true);
    const res = await saveGoogleWorkspaceConnection({
      domain: wsDomain.trim(),
      impersonationSubject: wsSubject.trim(),
    });
    setWsSave(res);
    if (res.ok) await loadAll();
    setWsSaving(false);
  }

  const [wsRunning, setWsRunning] = useState(false);
  const [wsResult, setWsResult] = useState<ApiResult<GoogleWorkspaceTestResult> | null>(null);

  async function runWorkspaceTest() {
    setWsRunning(true);
    setWsResult(await testGoogleWorkspaceConnection());
    setWsRunning(false);
    void loadAll();
  }

  // Workspace mailbox admin: discover, enable/disable, sync, backfill.
  const [wsDiscovering, setWsDiscovering] = useState(false);
  const [wsDiscover, setWsDiscover] =
    useState<ApiResult<GoogleWorkspaceDiscoverMailboxesResult> | null>(null);
  const [wsConnectionId, setWsConnectionId] = useState<string | null>(null);
  const [wsMailboxes, setWsMailboxes] = useState<GoogleWorkspaceMailboxWithAccount[]>([]);
  const [wsSelected, setWsSelected] = useState<Set<string>>(new Set());
  const [wsUpdating, setWsUpdating] = useState(false);
  const [wsUpdate, setWsUpdate] = useState<ApiResult<GoogleWorkspaceUpdateMailboxesResult> | null>(
    null,
  );
  const [wsSyncing, setWsSyncing] = useState(false);
  const [wsSync, setWsSync] = useState<ApiResult<GmailSyncMessagesResult> | null>(null);

  // Recent workspace sync state (last success/failure/running) for the summary.
  const [wsSyncState, setWsSyncState] = useState<WorkspaceSyncState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadWsMailboxes = useCallback(async (connectionId: string) => {
    const res = await listWorkspaceMailboxes(connectionId);
    if (res.ok) {
      setWsMailboxes(res.data);
      setWsSelected(new Set(res.data.filter((m) => m.sync_enabled).map((m) => m.id)));
    }
  }, []);

  /**
   * Load the full operational state in one pass: saved connection, its already
   * discovered mailboxes, connected accounts and recent sync state. This makes
   * an active Workspace + its mailboxes appear automatically — no manual "Test"
   * or "Discover" step. Read-only; mutates nothing. Also used by Refresh.
   */
  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [connRes, acctRes, syncRes, healthRes] = await Promise.all([
        getWorkspaceConnection(),
        listEmailAccounts("gmail"),
        getWorkspaceSyncState(),
        tenantId
          ? getEmailConnectorStatus(tenantId, true)
          : Promise.resolve<ApiResult<EmailConnectorStatusResult>>({
              ok: false,
              error: { code: "no_tenant", message: "No tenant in session" },
            }),
      ]);
      setEmailHealth(healthRes);

      if (connRes.ok && connRes.data) {
        const conn = connRes.data;
        setWsConn(conn);
        setWsDomain((prev) => prev || conn.domain || "");
        setWsSubject((prev) => prev || conn.impersonation_subject || "");
        setWsConnectionId(conn.id);
        await loadWsMailboxes(conn.id); // auto-load existing mailboxes
      }
      if (acctRes.ok) {
        setGmailAccounts(acctRes.data);
        setEmailAccountId((prev) => prev || acctRes.data[0]?.id || "");
      }
      if (syncRes.ok) setWsSyncState(syncRes.data);
    } finally {
      setRefreshing(false);
    }
  }, [loadWsMailboxes, tenantId]);

  useEffect(() => {
    if (allowed) void loadAll();
  }, [allowed, loadAll]);

  async function runDiscover() {
    setWsDiscovering(true);
    setWsUpdate(null);
    const res = await discoverGoogleWorkspaceMailboxes();
    setWsDiscover(res);
    if (res.ok) {
      setWsConnectionId(res.data.connection_id);
      await loadWsMailboxes(res.data.connection_id);
    }
    setWsDiscovering(false);
  }

  function toggleMailbox(id: string) {
    setWsSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runUpdate(syncEnabled: boolean) {
    if (!wsConnectionId || wsSelected.size === 0) return;
    setWsUpdating(true);
    const res = await updateGoogleWorkspaceMailboxes({
      mailboxIds: Array.from(wsSelected),
      syncEnabled,
    });
    setWsUpdate(res);
    if (res.ok) await loadWsMailboxes(wsConnectionId);
    setWsUpdating(false);
  }

  const selectedMailboxes = wsMailboxes.filter((m) => wsSelected.has(m.id));
  const soleSyncable =
    selectedMailboxes.length === 1 &&
    selectedMailboxes[0].account_id &&
    (selectedMailboxes[0].account_status === "pending_tokenless_dwd" ||
      selectedMailboxes[0].account_status === "active_dwd")
      ? selectedMailboxes[0]
      : null;

  async function runSyncSelected() {
    if (!soleSyncable?.account_id) return;
    setWsSyncing(true);
    setWsSync(await syncGmailWorkspaceMessages({ emailAccountId: soleSyncable.account_id }));
    setWsSyncing(false);
    if (wsConnectionId) await loadWsMailboxes(wsConnectionId);
  }

  const [wsBackfilling, setWsBackfilling] = useState(false);
  const [wsBackfill, setWsBackfill] = useState<ApiResult<GmailWorkspaceBackfillResult> | null>(
    null,
  );

  async function runBackfill(restart: boolean) {
    if (!soleSyncable?.account_id) return;
    setWsBackfilling(true);
    setWsBackfill(
      await backfillGmailWorkspaceMessages({ emailAccountId: soleSyncable.account_id, restart }),
    );
    setWsBackfilling(false);
    if (wsConnectionId) await loadWsMailboxes(wsConnectionId);
  }

  // Config collapses automatically once the Workspace connection is active.
  const [showSettings, setShowSettings] = useState<boolean | null>(null);
  const settingsOpen = showSettings ?? wsConn?.status !== "active";

  // Deep-link handoff from the Operations Overview (focus + one-shot nonce).
  const mailboxesRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const gmailRef = useRef<HTMLDivElement>(null);
  const [syncBanner, setSyncBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!focus) return;
    if (focus === "workspace-sync") {
      const enabled = wsMailboxes.filter((m) => m.sync_enabled).length;
      setSyncBanner(
        enabled > 0
          ? `${enabled} enabled mailbox${enabled === 1 ? "" : "es"} ready to sync — select one and Sync, or Backfill.`
          : "No enabled mailboxes yet — enable a mailbox to sync.",
      );
      setTimeout(
        () => mailboxesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    } else if (focus === "workspace-settings") {
      setShowSettings(true);
      setTimeout(
        () => settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    } else if (focus === "gmail") {
      setShowSettings(true);
      setTimeout(
        () => gmailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    }
    // Keyed on focusNonce so the same target re-applies when clicked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Authoritative health (sole source). Memoised BEFORE any early return so hook
  // order is stable. Everything reads `eh`, never the latched connection flag.
  const eh = emailHealth?.ok ? emailHealth.data : null;
  const wsDelegFailing = eh?.workspace.needsDelegationRetest ?? false;
  const diagRows = useMemo(() => eh?.diagnostics ?? [], [eh]);
  const filteredDiag = useMemo(
    () =>
      diagRows.filter((d) => {
        if (diagFilter === "all") return true;
        if (diagFilter === "gmail") return d.connector === "gmail";
        if (diagFilter === "workspace") return d.connector === "workspace";
        return rowBucket(d, wsDelegFailing) === diagFilter;
      }),
    [diagRows, diagFilter, wsDelegFailing],
  );

  if (!allowed) return <RestrictedNotice role={role} />;

  // Operational summary — derived entirely from already-loaded state (no extra
  // fetch). "Active DWD" counts mailboxes whose email_account is live via DWD.
  const totalMailboxes = wsMailboxes.length;
  const activeDwdCount = wsMailboxes.filter((m) => m.account_status === "active_dwd").length;
  const disabledCount = wsMailboxes.filter((m) => !m.sync_enabled).length;
  const oauthCount = gmailAccounts.filter((a) => a.status === "active").length;
  const backfillRunningCount = wsMailboxes.filter(
    (m) => m.account_backfill_status === "running",
  ).length;
  const backfillCompletedCount = wsMailboxes.filter(
    (m) => m.account_backfill_status === "completed",
  ).length;
  const alertCount =
    wsMailboxes.filter((m) => m.account_status === "error" || m.account_backfill_status === "error")
      .length + (wsConn?.status === "error" ? 1 : 0);
  const lastSuccessAt = wsSyncState?.lastSuccessAt ?? null;
  const lastFailureAt = wsSyncState?.lastFailureAt ?? null;

  // Non-hook health derivations (eh / diagRows / filteredDiag are computed above).
  const ehUnavailable = emailHealth !== null && !emailHealth.ok;
  const currentFailures = eh
    ? (eh.gmail.currentFailure ? 1 : 0) + (eh.workspace.currentFailure ? 1 : 0)
    : 0;
  const pipeNum = (k: string): number =>
    eh && typeof eh.pipeline[k] === "number" ? (eh.pipeline[k] as number) : 0;
  const pipeStr = (k: string): string | null =>
    eh && typeof eh.pipeline[k] === "string" ? (eh.pipeline[k] as string) : null;
  const evStr = (ev: Record<string, unknown>, k: string): string | null =>
    typeof ev[k] === "string" ? (ev[k] as string) : null;

  return (
    <div className="space-y-6">
      {/* Authoritative health & diagnostics (email-connector-status, sole source).
          Only CURRENT failures show; recovery actions appear only when genuinely
          needed. Discovery runs automatically — the manual controls below are
          recovery/admin overrides. */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Mail className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Email health</div>
              <div className="text-xs text-muted-foreground">
                Live connector health — Gmail (OAuth) and Google Workspace (DWD). Automatic; no
                action needed during normal operation.
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadAll()}
            disabled={refreshing}
            title="Reload health, mailboxes and sync state (no changes)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {ehUnavailable ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Health unavailable — the email tables could not be read (
            {emailHealth?.ok ? "" : emailHealth?.error.code}).
          </p>
        ) : !eh ? (
          <p className="mt-4 text-xs text-muted-foreground">Loading health…</p>
        ) : (
          <>
            {/* Two connector state chips + genuine-only recovery actions */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                { key: "gmail" as const, label: "Gmail (OAuth)", h: eh.gmail },
                { key: "workspace" as const, label: "Google Workspace (DWD)", h: eh.workspace },
              ].map(({ key, label, h }) => (
                <div key={key} className="rounded-xl border border-hairline bg-surface-alt/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-foreground">{label}</div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        EMAIL_STATE_TONE[h.state] ?? EMAIL_STATE_TONE.unknown
                      }`}
                    >
                      {h.state.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{h.reason}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>Last sync: {fmtAgo(evStr(h.evidence, "last_success_at"))}</span>
                    <span>Last useful: {fmtAgo(evStr(h.evidence, "last_useful_at"))}</span>
                    {key === "workspace" && (
                      <span>
                        Enabled mailboxes:{" "}
                        {typeof h.evidence.mailboxes_enabled === "number"
                          ? h.evidence.mailboxes_enabled
                          : "—"}
                      </span>
                    )}
                    {h.backfill !== "idle" && <span>Backfill: {h.backfill}</span>}
                  </div>
                  {/* Recovery actions — shown ONLY on a genuine current condition */}
                  {key === "gmail" && h.needsReconnect && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={connectGmail}
                      disabled={connectingGmail}
                      title="Recovery: a refresh token was revoked/expired — reconnect required"
                    >
                      {connectingGmail ? "Connecting…" : "Reconnect Gmail"}
                    </Button>
                  )}
                  {key === "workspace" && h.needsDelegationRetest && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={runWorkspaceTest}
                      disabled={wsRunning}
                      title="Recovery: delegation is currently failing — re-test required"
                    >
                      {wsRunning ? "Testing…" : "Re-test delegation"}
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Pipeline freshness strip (real timestamps + backlog) */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Last scheduler" value={fmtAgo(pipeStr("scheduler_last_at"))} />
              <MetricCard
                label="Last interaction"
                value={fmtAgo(pipeStr("last_email_interaction_at"))}
              />
              <MetricCard
                label="Backlog"
                value={pipeNum("unprojected_backlog")}
                tone={pipeNum("unprojected_backlog") > 0 ? "warning" : "success"}
              />
              <MetricCard
                label="Oldest pending"
                value={
                  pipeNum("unprojected_backlog") === 0
                    ? "—"
                    : fmtAgo(pipeStr("oldest_unprojected_at"))
                }
                tone={pipeNum("oldest_unprojected_age_seconds") > 900 ? "critical" : "default"}
              />
              <MetricCard
                label="Current failures"
                value={currentFailures}
                tone={currentFailures > 0 ? "critical" : "success"}
              />
              <MetricCard
                label="Dead-letter jobs"
                value={pipeNum("dead_letter_count")}
                tone={pipeNum("dead_letter_count") > 0 ? "critical" : "success"}
              />
              <MetricCard label="Msgs (60m)" value={pipeNum("messages_last_60m")} tone="accent" />
              <MetricCard label="Active jobs" value={pipeNum("active_jobs")} tone="accent" />
            </div>

            {/* Per-account / per-mailbox diagnostics (real data only) */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-foreground">
                Accounts &amp; mailboxes ({filteredDiag.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {DIAG_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setDiagFilter(f.key)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      diagFilter === f.key
                        ? "border-accent/30 bg-accent/10 text-accent"
                        : "border-hairline bg-surface-alt text-muted-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {diagRows.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {eh.gmail.state === "needs_setup" && eh.workspace.state === "needs_setup"
                  ? "Not configured — connect Gmail or a Workspace below to begin."
                  : "No accounts or mailboxes yet — discovery runs automatically once delegation is healthy."}
              </p>
            ) : filteredDiag.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No items match this filter.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[820px] text-xs">
                  <thead>
                    <tr className="border-b border-hairline text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Account / mailbox</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Enabled</th>
                      <th className="py-2 pr-3 font-medium">Health</th>
                      <th className="py-2 pr-3 font-medium">Auth / deleg</th>
                      <th className="py-2 pr-3 font-medium">Cursor</th>
                      <th className="py-2 pr-3 font-medium">Last sync</th>
                      <th className="py-2 pr-3 font-medium">Backfill</th>
                      <th className="py-2 pr-3 font-medium">Error</th>
                      <th className="py-2 pr-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {filteredDiag.map((d) => {
                      const bucket = rowBucket(d, wsDelegFailing);
                      return (
                        <tr key={d.email_account_id}>
                          <td className="py-2 pr-3 font-mono text-[11px] text-foreground">
                            {d.email_address ?? "—"}
                          </td>
                          <td className="py-2 pr-3">
                            {d.connector === "workspace" ? "Workspace" : "Gmail OAuth"}
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={d.enabled ? "text-foreground" : "text-muted-foreground"}
                            >
                              {d.enabled ? "enabled" : "disabled"}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={
                                bucket === "healthy"
                                  ? "text-success"
                                  : bucket === "stale" || bucket === "backfill_running"
                                    ? "text-warning"
                                    : "text-destructive"
                              }
                            >
                              {bucket.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                            {d.connector === "workspace" ? "delegated" : (d.auth_state ?? "—")}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {d.history_cursor === "history" ? "cursor set" : "window"}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                            {fmtAgo(d.last_success_at)}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {d.backfill_status && d.backfill_status !== "idle"
                              ? `${d.backfill_status}${d.backfill_total_fetched ? ` · ${d.backfill_total_fetched}` : ""}`
                              : "—"}
                          </td>
                          <td className="py-2 pr-3">
                            {d.last_error ? (
                              <span className="font-mono text-[11px] text-destructive">
                                {d.last_error}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-[11px] text-muted-foreground">
                            {recommendedAction(bucket)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      {/* Operational header + summary */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Building2 className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">
                Google Workspace{wsConn?.domain ? ` · ${wsConn.domain}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {wsConn
                  ? "Domain-wide delegation · automatic sync every 5 minutes"
                  : "Not connected — configure the connection below to begin."}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Authoritative state (never the latched connection flag). */}
            <ConnectorStatusBadge
              status={eh ? emailStateBadge(eh.workspace.state) : connStatus(wsConn?.status)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadAll()}
              disabled={refreshing}
              title="Reload connection, mailboxes and sync state (no changes)"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>

        {/* Sync state strip — real timestamps, honest "never" when absent. */}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            Last successful sync:{" "}
            <span className={lastSuccessAt ? "text-success" : "text-foreground"}>
              {fmtAgo(lastSuccessAt)}
            </span>
          </span>
          <span>
            Last failed sync:{" "}
            <span className={lastFailureAt ? "text-destructive" : "text-foreground"}>
              {fmtAgo(lastFailureAt)}
            </span>
          </span>
          <span>Last verified: {fmtAgo(wsConn?.last_verified_at ?? null)}</span>
          {wsSyncState && wsSyncState.running > 0 && (
            <span className="text-accent">Sync in flight: {wsSyncState.running}</span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Mailboxes" value={totalMailboxes} />
          <MetricCard label="Active DWD" value={activeDwdCount} tone="success" />
          <MetricCard label="Disabled" value={disabledCount} />
          <MetricCard label="OAuth mailboxes" value={oauthCount} tone="accent" />
          <MetricCard label="Backfill running" value={backfillRunningCount} tone="accent" />
          <MetricCard label="Backfill completed" value={backfillCompletedCount} tone="success" />
          <MetricCard
            label="Last sync"
            value={fmtAgo(lastSuccessAt)}
            tone={lastSuccessAt ? "success" : "warning"}
          />
          {/* Current (unresolved) failures only — never latched history. */}
          <MetricCard
            label="Current failures"
            value={eh ? currentFailures : alertCount}
            tone={(eh ? currentFailures : alertCount) > 0 ? "critical" : "success"}
          />
        </div>
      </div>

      {/* Mailboxes (primary operational surface) */}
      <div ref={mailboxesRef} className="rounded-2xl border border-hairline bg-white p-6">
        {syncBanner && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-xs text-accent">
            <span>{syncBanner}</span>
            <button
              onClick={() => setSyncBanner(null)}
              className="shrink-0 opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">Mailboxes</div>
            <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Admin overrides
            </span>
          </div>
          {/* Discovery is AUTOMATIC (every ~15 min); this is a manual recovery re-scan. */}
          {wsMailboxes.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={runDiscover}
              disabled={wsDiscovering}
              title="Recovery override: re-scan now — discovery runs automatically every ~15 min"
            >
              <Search className="h-3.5 w-3.5" />
              {wsDiscovering ? "Discovering…" : "Re-discover"}
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Enable/disable DWD sync per mailbox. Discovery and sync are automatic — the sync and
          backfill buttons here are recovery/admin overrides, not the normal workflow.
        </p>

        {wsDiscover && !wsDiscover.ok && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {wsDiscover.error.code}: {wsDiscover.error.message}
          </div>
        )}

        {/* Empty state — only surface Discover when there is nothing to show. */}
        {wsMailboxes.length === 0 &&
          (wsConn ? (
            <div className="mt-4 rounded-xl border border-dashed border-hairline bg-surface-alt/40 p-6 text-center">
              <p className="text-xs text-muted-foreground">
                No mailboxes discovered yet for this Workspace.
              </p>
              <Button size="sm" className="mt-3" onClick={runDiscover} disabled={wsDiscovering}>
                <Search className="h-3.5 w-3.5" />
                {wsDiscovering ? "Discovering…" : "Discover mailboxes"}
              </Button>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-hairline bg-surface-alt/40 p-6 text-center text-xs text-muted-foreground">
              Configure the Workspace connection in Connection settings below, then discover
              mailboxes.
            </div>
          ))}

        {wsMailboxes.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {wsMailboxes.length} discovered · {wsSelected.size} selected
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runUpdate(true)}
                  disabled={wsUpdating || wsSelected.size === 0}
                >
                  Enable selected
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runUpdate(false)}
                  disabled={wsUpdating || wsSelected.size === 0}
                >
                  Disable selected
                </Button>
                <Button
                  size="sm"
                  onClick={runSyncSelected}
                  disabled={wsSyncing || !soleSyncable}
                  title={
                    soleSyncable
                      ? "Recovery override: sync this mailbox now (automatic every 5 min)"
                      : "Select exactly one enabled DWD mailbox"
                  }
                >
                  {wsSyncing ? "Syncing…" : "Sync selected"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runBackfill(true)}
                  disabled={wsBackfilling || !soleSyncable}
                  title="Admin override: start historical backfill from the beginning (lower priority than live sync)"
                >
                  Start backfill
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runBackfill(false)}
                  disabled={wsBackfilling || !soleSyncable}
                  title="Admin override: continue historical backfill (next page)"
                >
                  {wsBackfilling ? "Backfilling…" : "Continue backfill"}
                </Button>
              </div>
            </div>

            <div className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-xl border border-hairline">
              {wsMailboxes.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-alt"
                >
                  <input
                    type="checkbox"
                    checked={wsSelected.has(m.id)}
                    onChange={() => toggleMailbox(m.id)}
                    className="h-3.5 w-3.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-foreground">
                      {m.email_address}
                    </div>
                    {m.display_name && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {m.display_name}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {m.sync_enabled ? "enabled" : "disabled"}
                    </span>
                    {m.account_status && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          m.account_status === "active"
                            ? "border-success/20 bg-success/10 text-success"
                            : m.account_status === "disabled"
                              ? "border-hairline bg-surface-alt text-muted-foreground"
                              : "border-accent/20 bg-accent/10 text-accent"
                        }`}
                      >
                        {m.account_status}
                      </span>
                    )}
                    {m.account_backfill_status && m.account_backfill_status !== "idle" && (
                      <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        backfill: {m.account_backfill_status}
                        {m.account_backfill_total ? ` · ${m.account_backfill_total}` : ""}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>

            {wsUpdate && (
              <div className="mt-3 text-xs">
                {wsUpdate.ok ? (
                  <span className="text-muted-foreground">
                    Updated {wsUpdate.data.updated_count} · created{" "}
                    {wsUpdate.data.email_accounts_created} · disabled{" "}
                    {wsUpdate.data.email_accounts_disabled} account(s).
                  </span>
                ) : (
                  <span className="text-destructive">
                    {wsUpdate.error.code}: {wsUpdate.error.message}
                  </span>
                )}
              </div>
            )}

            <StatusPanel
              running={wsSyncing}
              result={wsSync}
              renderOk={(d) => [
                { label: "Mailbox", value: d.mailbox ?? "—" },
                { label: "Messages", value: String(d.records_processed) },
                { label: "Threads", value: String(d.threads_processed) },
                { label: "Sync run", value: d.sync_run_id ?? "—" },
              ]}
            />
            <StatusPanel
              running={wsBackfilling}
              result={wsBackfill}
              renderOk={(d) => [
                { label: "Backfill", value: d.backfill_status },
                { label: "This run", value: String(d.records_processed) },
                { label: "Total fetched", value: String(d.total_fetched) },
                { label: "More pages", value: d.has_more ? "yes — continue" : "no — done" },
              ]}
            />
          </div>
        )}
      </div>

      {/* Connection settings (collapses once active) */}
      <div ref={settingsRef} className="rounded-2xl border border-hairline bg-white p-6">
        <button
          onClick={() => setShowSettings(!settingsOpen)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <div className="text-sm font-semibold">Connection settings</div>
            <div className="text-xs text-muted-foreground">
              Workspace domain, admin subject, delegation test and single-mailbox OAuth. Rarely
              needed after onboarding.
            </div>
          </div>
          {settingsOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {settingsOpen && (
          <div className="mt-5 space-y-6">
            {/* Workspace connection */}
            <div className="max-w-xl">
              <div className="text-sm font-semibold">Workspace connection</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure this tenant&apos;s Workspace domain and an admin mailbox to impersonate,
                then authorise the ServiceOS client ID in your Google Admin console.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="ws-domain"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    Workspace domain
                  </label>
                  <Input
                    id="ws-domain"
                    value={wsDomain}
                    onChange={(e) => setWsDomain(e.target.value)}
                    placeholder="drummondheating.co.uk"
                    disabled={wsSaving}
                    className="mt-1 font-mono"
                  />
                </div>
                <div>
                  <label
                    htmlFor="ws-subject"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    Admin subject email
                  </label>
                  <Input
                    id="ws-subject"
                    value={wsSubject}
                    onChange={(e) => setWsSubject(e.target.value)}
                    placeholder="heidi@drummondheating.co.uk"
                    disabled={wsSaving}
                    className="mt-1 font-mono"
                  />
                </div>
              </div>
              <Button
                size="sm"
                className="mt-3"
                onClick={runSaveConnection}
                disabled={wsSaving || wsDomain.trim() === "" || wsSubject.trim() === ""}
              >
                {wsSaving ? "Saving…" : "Save Workspace Connection"}
              </Button>

              {wsSave && !wsSave.ok && (
                <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {wsSave.error.code}: {wsSave.error.message}
                </div>
              )}

              {(wsSave?.ok || wsConn) && (
                <div className="mt-3 rounded-xl border border-hairline bg-surface-alt/50 p-3 text-xs">
                  <div className="font-medium text-foreground">
                    Authorise in Google Admin → Security → API controls → Domain-wide delegation:
                  </div>
                  <dl className="mt-2 space-y-1.5">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        ServiceOS client ID
                      </dt>
                      <dd className="break-all font-mono text-foreground">
                        {wsSave?.ok
                          ? (wsSave.data.client_id ?? "—")
                          : (wsConn?.service_account_client_id ?? "—")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Scopes
                      </dt>
                      <dd className="font-mono text-foreground">
                        {(wsSave?.ok ? wsSave.data.scopes : (wsConn?.authorised_scopes ?? []))
                          .map((s) => s.replace("https://www.googleapis.com/auth/", ""))
                          .join(", ") || "—"}
                      </dd>
                    </div>
                  </dl>
                  {wsConn?.error_message && (
                    <div className="mt-2 text-destructive">Last error: {wsConn.error_message}</div>
                  )}
                </div>
              )}
            </div>

            {/* Delegation test */}
            <div className="max-w-xl border-t border-hairline pt-5">
              <p className="text-xs text-muted-foreground">
                Verifies the service account can impersonate the saved admin subject for this
                tenant.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={runWorkspaceTest}
                disabled={wsRunning}
              >
                {wsRunning ? "Testing…" : "Test Workspace Connection"}
              </Button>
              <StatusPanel
                running={wsRunning}
                result={wsResult}
                renderOk={(d) => [
                  { label: "Domain", value: d.domain },
                  { label: "Impersonated", value: d.impersonated },
                  { label: "Scopes", value: String(d.scopes.length) },
                ]}
                renderExtra={(d) => (
                  <div className="flex flex-wrap gap-1">
                    {d.scopes.map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {s.replace("https://www.googleapis.com/auth/", "")}
                      </span>
                    ))}
                  </div>
                )}
              />
            </div>

            {/* Single-mailbox OAuth (Gmail) */}
            <div ref={gmailRef} className="max-w-xl border-t border-hairline pt-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Single mailbox · Gmail OAuth
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect one mailbox via OAuth (for mailboxes outside the Workspace domain). Grants
                read-only access.
              </p>
              <Button size="sm" className="mt-3" onClick={connectGmail} disabled={connectingGmail}>
                {connectingGmail ? "Connecting…" : "Connect Gmail"}
              </Button>
              {gmailError && (
                <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {gmailError}
                </div>
              )}

              {gmailAccounts.length > 0 && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Connected:{" "}
                  <span className="font-mono text-foreground">
                    {gmailAccounts[0].email_address ?? "—"}
                  </span>
                  {gmailAccounts.length > 1 ? ` (+${gmailAccounts.length - 1} more)` : ""}
                </p>
              )}

              <label
                htmlFor="gmail-account-id"
                className="mt-3 block text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                Email account UUID
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  id="gmail-account-id"
                  value={emailAccountId}
                  onChange={(e) => setEmailAccountId(e.target.value)}
                  placeholder="email_accounts.id"
                  disabled={syncingGmail}
                  className="font-mono"
                />
                <Button
                  onClick={runGmailSync}
                  disabled={syncingGmail || emailAccountId.trim() === ""}
                >
                  {syncingGmail ? "Syncing…" : "Sync Gmail messages"}
                </Button>
              </div>
              <StatusPanel
                running={syncingGmail}
                result={gmailSync}
                renderOk={(d) => [
                  { label: "Mailbox", value: d.mailbox ?? "—" },
                  { label: "Messages", value: String(d.records_processed) },
                  { label: "Threads", value: String(d.threads_processed) },
                  { label: "Sync run", value: d.sync_run_id ?? "—" },
                ]}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
