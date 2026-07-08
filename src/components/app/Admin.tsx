import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Plug,
  Phone,
  Mail,
  MessageSquare,
  Briefcase,
  Activity,
  RotateCcw,
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Building2,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  testSimwoodConnection,
  syncSimwoodCalls,
  syncSimwoodRecordings,
  processPhonePipeline,
  getPhonePipelineStatus,
  startGmailOAuth,
  saveGoogleWorkspaceConnection,
  testGoogleWorkspaceConnection,
  discoverGoogleWorkspaceMailboxes,
  enableGoogleWorkspaceMailboxes,
  syncGmailMessages,
  syncGmailWorkspaceMessages,
} from "@/lib/api";
import {
  listEmailAccounts,
  listWorkspaceMailboxes,
  getWorkspaceConnection,
} from "@/lib/email-feed";
import type {
  ApiResult,
  SimwoodConnectionResult,
  SimwoodSyncCallsResult,
  SimwoodSyncRecordingsResult,
  ProcessPhonePipelineResult,
  PhonePipelineStatusResult,
  GoogleWorkspaceTestResult,
  GoogleWorkspaceSaveConnectionResult,
  GoogleWorkspaceConnection,
  GoogleWorkspaceDiscoverMailboxesResult,
  GoogleWorkspaceEnableMailboxesResult,
  GoogleWorkspaceMailbox,
  GmailSyncMessagesResult,
  EmailAccount,
} from "@/lib/types";

// TODO(integration): replace this hardcoded Simwood customer id with the
// tenant's integration config once provider connections are stored per tenant.
const PROVIDER_CUSTOMER_ID = "3950";

// Roles allowed to see/use the Admin console. The Edge Functions enforce this
// server-side too — this only controls what the UI offers.
const ADMIN_ROLES = ["owner", "admin", "ops"] as const;

type ActionKey = "test" | "calls" | "recordings";

type Row = { label: string; value: string };

/** Read-only status panel for the latest run of one action. */
function StatusPanel<T>({
  running,
  result,
  renderOk,
  renderExtra,
}: {
  running: boolean;
  result: ApiResult<T> | null;
  renderOk: (data: T) => Row[];
  renderExtra?: (data: T) => ReactNode;
}) {
  let tone: "idle" | "running" | "ok" | "error" = "idle";
  if (running) tone = "running";
  else if (result) tone = result.ok ? "ok" : "error";

  const badge =
    tone === "ok"
      ? {
          cls: "bg-success/10 text-success border-success/20",
          label: "Success",
          Icon: CheckCircle2,
        }
      : tone === "error"
        ? {
            cls: "bg-destructive/10 text-destructive border-destructive/20",
            label: "Failed",
            Icon: XCircle,
          }
        : tone === "running"
          ? { cls: "bg-accent/10 text-accent border-accent/20", label: "Running", Icon: Loader2 }
          : {
              cls: "bg-surface-alt text-muted-foreground border-hairline",
              label: "Not run",
              Icon: PlayCircle,
            };

  const rows: Row[] = result && result.ok ? renderOk(result.data) : [];

  return (
    <div className="mt-3 rounded-xl border border-hairline bg-surface-alt/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Latest result
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
        >
          <badge.Icon className={`h-3 w-3 ${tone === "running" ? "animate-spin" : ""}`} />
          {badge.label}
        </span>
      </div>

      {tone === "idle" && (
        <p className="mt-2 text-xs text-muted-foreground">No run yet. Use the button above.</p>
      )}

      {result && result.ok && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {r.label}
              </dt>
              <dd className="truncate font-mono text-xs text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {result && result.ok && renderExtra && <div className="mt-2">{renderExtra(result.data)}</div>}

      {result && !result.ok && (
        <div className="mt-2 space-y-1">
          <div className="font-mono text-xs text-destructive">{result.error.code}</div>
          <div className="text-xs text-muted-foreground">{result.error.message}</div>
        </div>
      )}
    </div>
  );
}

export function AdminView() {
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  const tenantId = profile?.tenant_id ?? "";
  const allowed = role !== null && (ADMIN_ROLES as readonly string[]).includes(role);

  const [running, setRunning] = useState<ActionKey | null>(null);
  const [test, setTest] = useState<ApiResult<SimwoodConnectionResult> | null>(null);
  const [calls, setCalls] = useState<ApiResult<SimwoodSyncCallsResult> | null>(null);
  const [recordings, setRecordings] = useState<ApiResult<SimwoodSyncRecordingsResult> | null>(null);

  async function runTest() {
    setRunning("test");
    setTest(await testSimwoodConnection(tenantId, PROVIDER_CUSTOMER_ID));
    setRunning(null);
  }
  async function runCalls() {
    setRunning("calls");
    // No from/to → the function defaults to the last 24 hours.
    setCalls(await syncSimwoodCalls({ tenantId, providerCustomerId: PROVIDER_CUSTOMER_ID }));
    setRunning(null);
  }
  async function runRecordings() {
    setRunning("recordings");
    // No from/to → the function defaults to the last 24 hours.
    setRecordings(
      await syncSimwoodRecordings({
        tenantId,
        providerCustomerId: PROVIDER_CUSTOMER_ID,
      }),
    );
    setRunning(null);
  }

  // Pipeline diagnostics (read-only counts).
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<ApiResult<PhonePipelineStatusResult> | null>(null);

  const loadStatus = useCallback(async () => {
    if (!tenantId) return;
    setStatusLoading(true);
    setStatus(await getPhonePipelineStatus(tenantId));
    setStatusLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Retry pipeline for one recording.
  const [retryId, setRetryId] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<ApiResult<ProcessPhonePipelineResult> | null>(
    null,
  );

  async function runRetry() {
    const id = retryId.trim();
    if (!id) return;
    setRetrying(true);
    setRetryResult(await processPhonePipeline({ tenantId, recordingId: id }));
    setRetrying(false);
    void loadStatus();
  }

  // Gmail OAuth connect (Email Phase-1). On success the browser is redirected
  // to Google's consent screen; no email is synced yet.
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

  // Gmail message sync (Email Phase-2). Loads connected Gmail accounts (RLS read)
  // to show/prefill the mailbox, then syncs recent messages for one account.
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

  // Workspace SaaS connection config (per-tenant domain + admin subject). Loads
  // any saved connection to prefill + show status / ServiceOS client id.
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

  // Google Workspace Domain-Wide Delegation test. Verifies the service account
  // can impersonate the saved admin subject for the tenant's domain.
  const [wsRunning, setWsRunning] = useState(false);
  const [wsResult, setWsResult] = useState<ApiResult<GoogleWorkspaceTestResult> | null>(null);

  async function runWorkspaceTest() {
    setWsRunning(true);
    setWsResult(await testGoogleWorkspaceConnection());
    setWsRunning(false);
    void loadWsConnection();
  }

  // Workspace mailbox discovery + bulk enable (Workspace v1). Discovers via DWD,
  // lists mailboxes (RLS read), lets the admin select and enable a subset.
  const [wsDiscovering, setWsDiscovering] = useState(false);
  const [wsDiscover, setWsDiscover] =
    useState<ApiResult<GoogleWorkspaceDiscoverMailboxesResult> | null>(null);
  const [wsConnectionId, setWsConnectionId] = useState<string | null>(null);
  const [wsMailboxes, setWsMailboxes] = useState<GoogleWorkspaceMailbox[]>([]);
  const [wsSelected, setWsSelected] = useState<Set<string>>(new Set());
  const [wsEnabling, setWsEnabling] = useState(false);
  const [wsEnable, setWsEnable] = useState<ApiResult<GoogleWorkspaceEnableMailboxesResult> | null>(
    null,
  );

  async function loadWsMailboxes(connectionId: string) {
    const res = await listWorkspaceMailboxes(connectionId);
    if (res.ok) {
      setWsMailboxes(res.data);
      setWsSelected(new Set(res.data.filter((m) => m.sync_enabled).map((m) => m.id)));
    }
  }

  async function runDiscover() {
    setWsDiscovering(true);
    setWsEnable(null);
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

  async function runEnable() {
    if (!wsConnectionId || wsSelected.size === 0) return;
    setWsEnabling(true);
    const res = await enableGoogleWorkspaceMailboxes({
      connectionId: wsConnectionId,
      mailboxIds: Array.from(wsSelected),
      syncEnabled: true,
    });
    setWsEnable(res);
    if (res.ok) await loadWsMailboxes(wsConnectionId);
    setWsEnabling(false);
  }

  // Workspace DWD message sync (diagnostic). Targets a DWD email_account
  // (status pending_tokenless_dwd | active_dwd) — reuses gmailAccounts loaded
  // above, filtered to DWD statuses.
  const dwdAccounts = gmailAccounts.filter(
    (a) => a.status === "pending_tokenless_dwd" || a.status === "active_dwd",
  );
  const [wsSyncAccountId, setWsSyncAccountId] = useState("");
  const [wsSyncing, setWsSyncing] = useState(false);
  const [wsSync, setWsSync] = useState<ApiResult<GmailSyncMessagesResult> | null>(null);

  async function runWorkspaceSync() {
    const id = wsSyncAccountId.trim();
    if (!id) return;
    setWsSyncing(true);
    setWsSync(await syncGmailWorkspaceMessages({ emailAccountId: id }));
    setWsSyncing(false);
  }

  // Access control: only owner/admin/ops may use the Admin console. The Edge
  // Functions enforce this too — this is the UI-side gate.
  if (!allowed) {
    return (
      <div className="rounded-2xl border border-hairline bg-white p-8 text-center">
        <div className="text-display text-lg font-semibold">Restricted</div>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The Admin console is available to owner, admin and ops roles only.
          {role ? ` Your role is "${role}".` : " Your account has no role assigned."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <Plug className="h-3 w-3" />
              </span>
              Admin · Integrations
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              Internal integration console.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Trigger backend inputs and inspect the latest sync health without the terminal.
              Internal tooling — visible to signed-in staff only.
            </p>
          </div>
          <div className="rounded-full border border-hairline bg-surface-alt px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            Tenant · <span className="font-mono">{tenantId || "—"}</span>
            {role ? <span className="ml-2 text-muted-foreground/70">· {role}</span> : null}
          </div>
        </div>
      </div>

      {/* Phone / VoIP — Simwood (active) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Phone className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Phone / VoIP · Simwood</div>
              <div className="text-xs text-muted-foreground">Call history & recording metadata</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-0.5 text-[11px] font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Active
          </span>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Phone automatic sync runs every 5 minutes. The buttons below are diagnostics/backfill.
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {/* Test connection */}
          <div className="rounded-xl border border-hairline p-4">
            <div className="text-sm font-semibold">Test connection</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Verify Simwood credentials and reachable accounts.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={runTest}
              disabled={running !== null}
            >
              {running === "test" ? "Testing…" : "Test connection"}
            </Button>
            <StatusPanel
              running={running === "test"}
              result={test}
              renderOk={(d) => [
                { label: "Provider", value: d.provider },
                { label: "Accounts", value: String(d.customerCount) },
              ]}
            />
          </div>

          {/* Sync calls */}
          <div className="rounded-xl border border-hairline p-4">
            <div className="text-sm font-semibold">Sync calls</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Ingest call history (default: last 24 hours).
            </p>
            <Button
              size="sm"
              className="mt-3 w-full"
              onClick={runCalls}
              disabled={running !== null}
            >
              {running === "calls" ? "Syncing…" : "Sync last 24h"}
            </Button>
            <StatusPanel
              running={running === "calls"}
              result={calls}
              renderOk={(d) => [
                { label: "Records", value: String(d.records_processed) },
                { label: "Sync run", value: d.sync_run_id ?? "—" },
                { label: "From", value: d.from },
                { label: "To", value: d.to },
              ]}
            />
          </div>

          {/* Sync recordings */}
          <div className="rounded-xl border border-hairline p-4">
            <div className="text-sm font-semibold">Sync recordings</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Ingest recording metadata (default: last 24 hours). No audio download.
            </p>
            <Button
              size="sm"
              className="mt-3 w-full"
              onClick={runRecordings}
              disabled={running !== null}
            >
              {running === "recordings" ? "Syncing…" : "Sync last 24h"}
            </Button>
            <StatusPanel
              running={running === "recordings"}
              result={recordings}
              renderOk={(d) => [
                { label: "Records", value: String(d.records_processed) },
                { label: "Sync run", value: d.sync_run_id ?? "—" },
                { label: "From", value: d.from },
                { label: "To", value: d.to },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Email — Gmail (OAuth connection only) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Mail className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Email · Gmail</div>
              <div className="text-xs text-muted-foreground">
                Connect a Google Workspace mailbox via OAuth
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-alt px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            Setup
          </span>
        </div>

        <div className="mt-5 max-w-xl">
          <p className="text-xs text-muted-foreground">
            Grants read-only access so ServiceOS can sync email later. You will be redirected to
            Google to approve the connection.
          </p>
          <Button size="sm" className="mt-3" onClick={connectGmail} disabled={connectingGmail}>
            {connectingGmail ? "Connecting…" : "Connect Gmail"}
          </Button>

          {gmailError && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {gmailError}
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            OAuth connection only. Connect above, then sync messages below.
          </p>
        </div>

        {/* Sync messages (Email Phase-2) */}
        <div className="mt-5 border-t border-hairline pt-5">
          <div className="text-sm font-semibold">Sync Gmail messages</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Gmail automatic sync runs every 5 minutes; this button is diagnostics/backfill. Pulls
            recent INBOX and SENT messages into the email feed. Metadata + body only — no
            attachments or AI analysis yet.
          </p>

          {gmailAccounts.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Connected:{" "}
              <span className="font-mono text-foreground">
                {gmailAccounts[0].email_address ?? "—"}
              </span>
              {gmailAccounts.length > 1 ? ` (+${gmailAccounts.length - 1} more)` : ""}
            </p>
          )}

          <div className="mt-3 max-w-xl">
            <label
              htmlFor="gmail-account-id"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
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
      </div>

      {/* Email — Google Workspace (domain-wide delegation) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Building2 className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Email · Google Workspace</div>
              <div className="text-xs text-muted-foreground">
                Admin-authorised, many-mailbox access via domain-wide delegation
              </div>
            </div>
          </div>
          {wsConn ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-alt px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {wsConn.status}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-alt px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              Not configured
            </span>
          )}
        </div>

        {/* Connection config (per-tenant domain + admin subject) */}
        <div className="mt-5 max-w-xl">
          <div className="text-sm font-semibold">Workspace connection</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure this tenant&apos;s Workspace domain and an admin mailbox to impersonate, then
            authorise the ServiceOS client ID in your Google Admin console.
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

        <div className="mt-5 max-w-xl border-t border-hairline pt-5">
          <p className="text-xs text-muted-foreground">
            Verifies the service account can impersonate the saved admin subject for this tenant —
            no email is synced yet.
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

        {/* Discover + bulk-enable mailboxes (Workspace v1) */}
        <div className="mt-5 border-t border-hairline pt-5">
          <div className="text-sm font-semibold">Discover mailboxes</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Lists every mailbox in the Workspace domain via domain-wide delegation, then lets you
            enable a subset. No email is synced yet.
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
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {wsMailboxes.length} discovered · {wsSelected.size} selected
                </span>
                <Button
                  size="sm"
                  onClick={runEnable}
                  disabled={wsEnabling || wsSelected.size === 0}
                >
                  {wsEnabling ? "Enabling…" : "Enable Selected Mailboxes"}
                </Button>
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
                    <span className="shrink-0 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {m.sync_enabled ? "enabled" : m.status}
                    </span>
                  </label>
                ))}
              </div>

              {wsEnable && (
                <div className="mt-3 text-xs">
                  {wsEnable.ok ? (
                    <span className="text-muted-foreground">
                      Enabled {wsEnable.data.enabled_count} · created{" "}
                      {wsEnable.data.email_accounts_created} email account(s).
                    </span>
                  ) : (
                    <span className="text-destructive">
                      {wsEnable.error.code}: {wsEnable.error.message}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sync a Workspace DWD mailbox (diagnostic) */}
        <div className="mt-5 border-t border-hairline pt-5">
          <div className="text-sm font-semibold">Sync Workspace mailbox (DWD)</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Syncs one enabled Workspace mailbox via domain-wide delegation (no OAuth token).
            Diagnostic; scheduled sync runs these automatically. No AI analysis yet.
          </p>

          {dwdAccounts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {dwdAccounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setWsSyncAccountId(a.id)}
                  className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {a.email_address ?? a.id}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 max-w-xl">
            <label
              htmlFor="ws-sync-account-id"
              className="text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Email account UUID (DWD)
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                id="ws-sync-account-id"
                value={wsSyncAccountId}
                onChange={(e) => setWsSyncAccountId(e.target.value)}
                placeholder="email_accounts.id"
                disabled={wsSyncing}
                className="font-mono"
              />
              <Button
                onClick={runWorkspaceSync}
                disabled={wsSyncing || wsSyncAccountId.trim() === ""}
              >
                {wsSyncing ? "Syncing…" : "Sync Workspace mailbox"}
              </Button>
            </div>
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
          </div>
        </div>
      </div>

      {/* Pipeline diagnostics (read-only) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Activity className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Pipeline diagnostics</div>
              <div className="text-xs text-muted-foreground">
                New recordings enrich automatically â this is read-only status
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={loadStatus} disabled={statusLoading}>
            <RotateCcw className="h-3.5 w-3.5" />
            {statusLoading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {status && !status.ok && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {status.error.code}: {status.error.message}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUS_TILES.map((tile) => {
            const value = status && status.ok ? status.data[tile.key] : null;
            return (
              <div key={tile.key} className="rounded-xl border border-hairline bg-surface-alt p-4">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {tile.label}
                </div>
                <div className={`text-display mt-2 text-2xl font-bold tabular ${tile.tone}`}>
                  {value === null ? "—" : value}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Retry pipeline */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center gap-3 border-b border-hairline pb-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
            <RotateCcw className="h-4 w-4 text-foreground" />
          </span>
          <div>
            <div className="text-sm font-semibold">Retry processing</div>
            <div className="text-xs text-muted-foreground">
              Re-run download → transcribe → analyse for one recording
            </div>
          </div>
        </div>

        <div className="mt-5 max-w-xl">
          <label
            htmlFor="retry-rec-id"
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            Recording UUID
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              id="retry-rec-id"
              value={retryId}
              onChange={(e) => setRetryId(e.target.value)}
              placeholder="294014bf-0e25-4904-8ad7-81c8526e2025"
              disabled={retrying}
              className="font-mono"
            />
            <Button onClick={runRetry} disabled={retrying || retryId.trim() === ""}>
              {retrying ? "Processing…" : "Retry processing"}
            </Button>
          </div>

          <StatusPanel
            running={retrying}
            result={retryResult}
            renderOk={(d) => [
              { label: "Downloaded", value: d.downloaded ? "yes" : "no" },
              { label: "Transcribed", value: d.transcribed ? "yes" : "no" },
              { label: "Analysed", value: d.analysed ? "yes" : "no" },
              { label: "Transcript", value: d.transcript_id ?? "—" },
              { label: "Insight", value: d.insight_id ?? "—" },
              { label: "Sync run", value: d.sync_run_id ?? "—" },
            ]}
          />
        </div>
      </div>

      {/* Other integrations — placeholders */}
      <div>
        <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          Other inputs · planned
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLACEHOLDERS.map((p) => (
            <div key={p.name} className="rounded-2xl border border-hairline bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
                  <p.icon className="h-4 w-4 text-muted-foreground" />
                </span>
                <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Planned
                </span>
              </div>
              <div className="mt-3 text-sm font-semibold">{p.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">{p.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const STATUS_TILES: {
  key: "pending" | "processing" | "failed" | "completed";
  label: string;
  tone: string;
}[] = [
  { key: "pending", label: "Pending", tone: "text-muted-foreground" },
  { key: "processing", label: "Processing", tone: "text-accent" },
  { key: "failed", label: "Failed", tone: "text-destructive" },
  { key: "completed", label: "Completed", tone: "text-success" },
];

const PLACEHOLDERS: { name: string; detail: string; icon: LucideIcon }[] = [
  {
    name: "Slack input",
    detail: "Team messages and alerts routed into ServiceOS.",
    icon: MessageSquare,
  },
  {
    name: "VoIP / phone input",
    detail: "Active via Simwood above; more providers to follow.",
    icon: Phone,
  },
  {
    name: "Commusoft / job system",
    detail: "Jobs, customers and invoices from the field system.",
    icon: Briefcase,
  },
];
