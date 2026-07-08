/**
 * EmailOperations — the Gmail + Google Workspace dashboard (Communications ›
 * Email). Extracted from the former AdminView with NO behaviour change: the same
 * API calls, handlers and controls (OAuth connect, Workspace save/test, mailbox
 * discover/enable/disable/sync, historical backfill).
 *
 * Reorganised per the operations-first philosophy: mailbox management is primary;
 * the connection setup collapses automatically once the Workspace is active.
 */

import { useCallback, useEffect, useState } from "react";
import { Mail, Building2, ChevronDown, ChevronRight } from "lucide-react";

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
} from "@/lib/api";
import {
  listEmailAccounts,
  listWorkspaceMailboxes,
  getWorkspaceConnection,
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
} from "@/lib/types";
import { ConnectorStatusBadge, MetricCard } from "@/components/ops";
import type { ConnectorStatus } from "@/lib/connectors/types";
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

export function EmailOperations() {
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  const allowed = role !== null && (ADMIN_ROLES as readonly string[]).includes(role);

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

  useEffect(() => {
    if (!allowed) return;
    void (async () => {
      const res = await listEmailAccounts("gmail");
      if (res.ok) {
        setGmailAccounts(res.data);
        setEmailAccountId((prev) => prev || res.data[0]?.id || "");
      }
    })();
  }, [allowed]);

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

  const loadWsConnection = useCallback(async () => {
    const res = await getWorkspaceConnection();
    if (res.ok && res.data) {
      setWsConn(res.data);
      setWsDomain((prev) => prev || res.data!.domain || "");
      setWsSubject((prev) => prev || res.data!.impersonation_subject || "");
    }
  }, []);

  useEffect(() => {
    if (allowed) void loadWsConnection();
  }, [allowed, loadWsConnection]);

  async function runSaveConnection() {
    if (!wsDomain.trim() || !wsSubject.trim()) return;
    setWsSaving(true);
    const res = await saveGoogleWorkspaceConnection({
      domain: wsDomain.trim(),
      impersonationSubject: wsSubject.trim(),
    });
    setWsSave(res);
    if (res.ok) await loadWsConnection();
    setWsSaving(false);
  }

  const [wsRunning, setWsRunning] = useState(false);
  const [wsResult, setWsResult] = useState<ApiResult<GoogleWorkspaceTestResult> | null>(null);

  async function runWorkspaceTest() {
    setWsRunning(true);
    setWsResult(await testGoogleWorkspaceConnection());
    setWsRunning(false);
    void loadWsConnection();
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

  async function loadWsMailboxes(connectionId: string) {
    const res = await listWorkspaceMailboxes(connectionId);
    if (res.ok) {
      setWsMailboxes(res.data);
      setWsSelected(new Set(res.data.filter((m) => m.sync_enabled).map((m) => m.id)));
    }
  }

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

  if (!allowed) return <RestrictedNotice role={role} />;

  const activeCount = wsMailboxes.filter(
    (m) => m.account_status === "active" || m.account_status === "active_dwd",
  ).length;
  const enabledCount = wsMailboxes.filter((m) => m.sync_enabled).length;

  return (
    <div className="space-y-6">
      {/* Operational header */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Building2 className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">
                Google Workspace{wsConn?.domain ? ` · ${wsConn.domain}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                Domain-wide delegation · automatic sync every 5 minutes
              </div>
            </div>
          </div>
          <ConnectorStatusBadge status={connStatus(wsConn?.status)} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Mailboxes" value={wsMailboxes.length} />
          <MetricCard label="Sync enabled" value={enabledCount} tone="accent" />
          <MetricCard label="Active" value={activeCount} tone="success" />
          <MetricCard
            label="Connection"
            value={wsConn?.status ?? "—"}
            tone={wsConn?.status === "active" ? "success" : "warning"}
          />
        </div>
      </div>

      {/* Mailboxes (primary operational surface) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="text-sm font-semibold">Mailboxes</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Discover the domain&apos;s mailboxes, then enable/disable DWD sync per mailbox. Disable
          stops future sync but keeps all historical email. No AI analysis yet.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={runDiscover}
          disabled={wsDiscovering}
        >
          {wsDiscovering ? "Discovering…" : "Discover Mailboxes"}
        </Button>

        {wsDiscover && !wsDiscover.ok && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {wsDiscover.error.code}: {wsDiscover.error.message}
          </div>
        )}

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
                      ? "Sync this mailbox now"
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
                  title="Start historical backfill from the beginning"
                >
                  Start backfill
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runBackfill(false)}
                  disabled={wsBackfilling || !soleSyncable}
                  title="Continue historical backfill (next page)"
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
      <div className="rounded-2xl border border-hairline bg-white p-6">
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
            <div className="max-w-xl border-t border-hairline pt-5">
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
