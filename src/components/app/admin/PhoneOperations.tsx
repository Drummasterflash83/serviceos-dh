/**
 * PhoneOperations — the Simwood VoIP dashboard (Communications › Phone).
 *
 * Extracted from the former AdminView with NO behaviour change: the same API
 * calls, handlers and controls. Reorganised so the operational status (pipeline
 * health) is primary and the manual diagnostics/backfill collapse away.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Activity, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  testSimwoodConnection,
  syncSimwoodCalls,
  syncSimwoodRecordings,
  processPhonePipeline,
  processPendingPhone,
  getPhonePipelineStatus,
} from "@/lib/api";
import type {
  ApiResult,
  SimwoodConnectionResult,
  SimwoodSyncCallsResult,
  SimwoodSyncRecordingsResult,
  ProcessPhonePipelineResult,
  ProcessPendingPhoneResult,
  PhonePipelineStatusResult,
} from "@/lib/types";
import { ConnectorStatusBadge } from "@/components/ops";
import type { ConnectorStatus } from "@/lib/connectors/types";
import type { ConnectorSurfaceProps } from "@/lib/runtime/types";
import {
  getSimwoodAccount,
  getPhonePipelineBacklog,
  type SimwoodAccount,
  type PhonePipelineBacklog,
} from "@/lib/phone-feed";
import {
  listVoiceEndpoints,
  saveVoiceEndpoint,
  disableVoiceEndpoint,
  type UserVoiceEndpoint,
} from "@/lib/live-calls";
import { ADMIN_ROLES, RestrictedNotice, StatusPanel } from "./StatusPanel";

type ActionKey = "test" | "calls" | "recordings";

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

export function PhoneOperations({ focus, focusNonce }: ConnectorSurfaceProps = {}) {
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  const tenantId = profile?.tenant_id ?? "";
  const allowed = role !== null && (ADMIN_ROLES as readonly string[]).includes(role);

  const [running, setRunning] = useState<ActionKey | null>(null);
  const [test, setTest] = useState<ApiResult<SimwoodConnectionResult> | null>(null);
  const [calls, setCalls] = useState<ApiResult<SimwoodSyncCallsResult> | null>(null);
  const [recordings, setRecordings] = useState<ApiResult<SimwoodSyncRecordingsResult> | null>(null);

  // Configured Simwood connector account (customer id from config, not hardcoded).
  const [account, setAccount] = useState<SimwoodAccount | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);

  const loadAccount = useCallback(async () => {
    const res = await getSimwoodAccount();
    if (res.ok) setAccount(res.data);
    setAccountLoaded(true);
  }, []);

  useEffect(() => {
    if (allowed) void loadAccount();
  }, [allowed, loadAccount]);

  const customerId = account?.providerCustomerId ?? "";
  const configured = account !== null;

  async function runTest() {
    if (!configured) return;
    setRunning("test");
    setTest(await testSimwoodConnection(tenantId, customerId));
    setRunning(null);
  }
  async function runCalls() {
    if (!configured) return;
    setRunning("calls");
    // No from/to → the function defaults to the last 24 hours (safe catch-up).
    setCalls(await syncSimwoodCalls({ tenantId, providerCustomerId: customerId }));
    setRunning(null);
    void loadAccount(); // refresh watermarks after a sync
  }
  async function runRecordings() {
    if (!configured) return;
    setRunning("recordings");
    // No from/to → the function defaults to the last 24 hours.
    setRecordings(await syncSimwoodRecordings({ tenantId, providerCustomerId: customerId }));
    setRunning(null);
  }

  // Pipeline diagnostics (read-only counts).
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<ApiResult<PhonePipelineStatusResult> | null>(null);

  // Processing backlog (truthful "what still needs work") + the latest failure.
  const [backlog, setBacklog] = useState<ApiResult<PhonePipelineBacklog> | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ApiResult<ProcessPendingPhoneResult> | null>(
    null,
  );

  const loadStatus = useCallback(async () => {
    if (!tenantId) return;
    setStatusLoading(true);
    const [st, bl] = await Promise.all([
      getPhonePipelineStatus(tenantId),
      getPhonePipelineBacklog(),
    ]);
    setStatus(st);
    setBacklog(bl);
    setStatusLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function runProcessPending() {
    if (!tenantId) return;
    setProcessing(true);
    setProcessResult(await processPendingPhone({ tenantId }));
    setProcessing(false);
    void loadStatus();
  }

  // User ↔ VoIP extension mapping (drives Live Call Card assignment).
  const [endpoints, setEndpoints] = useState<UserVoiceEndpoint[]>([]);
  const [newExt, setNewExt] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [endpointError, setEndpointError] = useState<string | null>(null);

  const loadEndpoints = useCallback(async () => {
    const res = await listVoiceEndpoints();
    if (res.ok) setEndpoints(res.data);
  }, []);

  useEffect(() => {
    if (allowed) void loadEndpoints();
  }, [allowed, loadEndpoints]);

  async function addEndpoint() {
    if (!newExt.trim() || !newEmail.trim()) return;
    setSavingEndpoint(true);
    setEndpointError(null);
    const res = await saveVoiceEndpoint({
      extension: newExt.trim(),
      email: newEmail.trim(),
      displayName: newName.trim() || undefined,
    });
    setSavingEndpoint(false);
    if (!res.ok) {
      setEndpointError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setNewExt("");
    setNewEmail("");
    setNewName("");
    await loadEndpoints();
  }

  async function toggleEndpoint(id: string) {
    await disableVoiceEndpoint(id);
    await loadEndpoints();
  }

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

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const diagnosticsRef = useRef<HTMLDivElement>(null);

  // Deep-link handoff from the Operations Overview (Settings action).
  useEffect(() => {
    if (focus !== "diagnostics") return;
    setShowDiagnostics(true);
    setTimeout(
      () => diagnosticsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
    // Keyed on focusNonce so the same target re-applies when clicked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Honest header status: not-configured never reads as connected.
  const pipelineTotal =
    status && status.ok
      ? status.data.pending + status.data.processing + status.data.failed + status.data.completed
      : 0;
  const headerStatus: ConnectorStatus =
    accountLoaded && !configured
      ? "warning"
      : statusLoading
        ? "syncing"
        : status && !status.ok
          ? "error"
          : status && status.ok && pipelineTotal > 0
            ? "connected"
            : "warning";

  if (!allowed) return <RestrictedNotice role={role} />;

  return (
    <div className="space-y-6">
      {/* Operational header + pipeline status (primary) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Phone className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Phone / VoIP · Simwood</div>
              <div className="text-xs text-muted-foreground">
                {configured
                  ? `Customer ${customerId} · automatic sync every 5 minutes`
                  : accountLoaded
                    ? "Not configured — no Simwood connector account for this tenant"
                    : "Loading connector configuration…"}
              </div>
            </div>
          </div>
          <ConnectorStatusBadge status={headerStatus} />
        </div>

        {accountLoaded && !configured && (
          <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Simwood is not configured for this tenant. Add a connector account to enable sync.
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Processing pipeline
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={runCalls}
              disabled={!configured || running !== null}
              title="Catch up: re-sync the last 24 hours of calls"
            >
              {running === "calls" ? "Catching up…" : "Catch up 24h"}
            </Button>
            <Button size="sm" variant="outline" onClick={loadStatus} disabled={statusLoading}>
              <RotateCcw className="h-3.5 w-3.5" />
              {statusLoading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>

        {status && !status.ok && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {status.error.code}: {status.error.message}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      {/* Processing backlog — truthful "what still needs work" + one-click drain */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Processing backlog</div>
            <div className="text-xs text-muted-foreground">
              Download → transcribe → analyse runs server-side (no session needed).
            </div>
          </div>
          <Button
            size="sm"
            onClick={runProcessPending}
            disabled={processing || !tenantId}
            title="Process a batch of pending recordings now"
          >
            {processing ? "Processing…" : "Process pending now"}
          </Button>
        </div>

        {backlog && !backlog.ok ? (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Backlog unavailable — {backlog.error.code}: {backlog.error.message}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: "Not downloaded",
                value: backlog?.ok ? backlog.data.notDownloaded : null,
                tone:
                  backlog?.ok && backlog.data.notDownloaded > 0
                    ? "text-destructive"
                    : "text-muted-foreground",
              },
              {
                label: "Need transcription",
                value: backlog?.ok ? backlog.data.needTranscription : null,
                tone:
                  backlog?.ok && backlog.data.needTranscription > 0
                    ? "text-warning"
                    : "text-muted-foreground",
              },
              {
                label: "Need analysis",
                value: backlog?.ok ? backlog.data.needAnalysis : null,
                tone:
                  backlog?.ok && backlog.data.needAnalysis > 0
                    ? "text-warning"
                    : "text-muted-foreground",
              },
              {
                label: "Downloaded",
                value: backlog?.ok ? backlog.data.downloaded : null,
                tone: "text-success",
              },
            ].map((t) => (
              <div key={t.label} className="rounded-xl border border-hairline bg-surface-alt p-4">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t.label}
                </div>
                <div className={`text-display mt-2 text-2xl font-bold tabular ${t.tone}`}>
                  {t.value === null ? "—" : t.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {backlog?.ok && backlog.data.latestFailureMessage && (
          <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Latest pipeline failure: {backlog.data.latestFailureMessage}
          </div>
        )}

        <StatusPanel
          running={processing}
          result={processResult}
          renderOk={(d) => [
            { label: "Processed", value: String(d.processed) },
            { label: "Downloaded", value: String(d.downloaded) },
            { label: "Transcribed", value: String(d.transcribed) },
            { label: "Analysed", value: String(d.analysed) },
            { label: "Failed", value: String(d.failed) },
          ]}
        />
      </div>

      {/* User phone extensions — maps a user to a VoIP extension (Live Call Card) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="text-sm font-semibold">User phone extensions</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Map a user to a VoIP extension so live calls on that extension surface to only that person
          (e.g. Mary → 102).
        </p>

        {endpoints.length > 0 && (
          <div className="mt-4 divide-y divide-hairline rounded-xl border border-hairline">
            {endpoints.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-foreground">
                    Ext {e.extension}
                    {e.display_name ? ` · ${e.display_name}` : ""}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{e.user_id}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      e.enabled
                        ? "border-success/20 bg-success/10 text-success"
                        : "border-hairline bg-surface-alt text-muted-foreground"
                    }`}
                  >
                    {e.enabled ? "enabled" : "disabled"}
                  </span>
                  {e.enabled && (
                    <Button size="sm" variant="ghost" onClick={() => void toggleEndpoint(e.id)}>
                      Disable
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Input
            value={newExt}
            onChange={(ev) => setNewExt(ev.target.value)}
            placeholder="Extension (102)"
            className="font-mono"
          />
          <Input
            value={newEmail}
            onChange={(ev) => setNewEmail(ev.target.value)}
            placeholder="User email"
            className="sm:col-span-2"
          />
          <Input
            value={newName}
            onChange={(ev) => setNewName(ev.target.value)}
            placeholder="Display name (optional)"
          />
        </div>
        <Button
          size="sm"
          className="mt-3"
          onClick={addEndpoint}
          disabled={savingEndpoint || newExt.trim() === "" || newEmail.trim() === ""}
        >
          {savingEndpoint ? "Saving…" : "Add mapping"}
        </Button>
        {endpointError && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {endpointError}
          </div>
        )}
      </div>

      {/* Diagnostics & manual sync (collapsed by default) */}
      <div ref={diagnosticsRef} className="rounded-2xl border border-hairline bg-white p-6">
        <button
          onClick={() => setShowDiagnostics((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <div className="text-sm font-semibold">Diagnostics &amp; manual sync</div>
            <div className="text-xs text-muted-foreground">
              Test the connection, backfill on demand, or retry one recording. Not needed day to
              day.
            </div>
          </div>
          {showDiagnostics ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showDiagnostics && (
          <>
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
                  disabled={!configured || running !== null}
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
                  disabled={!configured || running !== null}
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
                  disabled={!configured || running !== null}
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

            {/* Retry pipeline */}
            <div className="mt-5 max-w-xl border-t border-hairline pt-5">
              <div className="text-sm font-semibold">Retry processing</div>
              <div className="text-xs text-muted-foreground">
                Re-run download → transcribe → analyse for one recording.
              </div>
              <label
                htmlFor="retry-rec-id"
                className="mt-3 block text-[11px] uppercase tracking-wider text-muted-foreground"
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
          </>
        )}
      </div>
    </div>
  );
}
