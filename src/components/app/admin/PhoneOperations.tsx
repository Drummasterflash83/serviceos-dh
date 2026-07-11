/**
 * PhoneOperations — the Simwood VoIP dashboard (Communications › Phone).
 *
 * Operationally honest (Reliability v2): the primary card separates SCHEDULER,
 * WORKER and USEFUL-PROCESSING health; stage counts show what genuinely needs
 * work; current (unresolved) failures are distinct from resolved history; a
 * read-only diagnostic table lists the actual blocked items. The "Catch up 24h"
 * and "Process pending now" buttons are recovery overrides — normal operation
 * needs neither. All numbers come from the single source of truth,
 * phone-pipeline-status.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PhonePipelineDiagItem,
} from "@/lib/types";
import { ConnectorStatusBadge } from "@/components/ops";
import type { ConnectorStatus } from "@/lib/connectors/types";
import type { ConnectorSurfaceProps } from "@/lib/runtime/types";
import { getSimwoodAccount, type SimwoodAccount } from "@/lib/phone-feed";
import {
  listVoiceEndpoints,
  saveVoiceEndpoint,
  disableVoiceEndpoint,
  type UserVoiceEndpoint,
} from "@/lib/live-calls";
import { ADMIN_ROLES, RestrictedNotice, StatusPanel } from "./StatusPanel";

type ActionKey = "test" | "calls" | "recordings";

const HEALTH_TONE: Record<string, string> = {
  healthy: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
};

// Diagnostic-table filter chips → predicate over a diagnostic row.
const DIAG_FILTERS: { key: string; label: string; match: (d: PhonePipelineDiagItem) => boolean }[] =
  [
    { key: "all", label: "All", match: () => true },
    { key: "undownloaded", label: "Undownloaded", match: (d) => d.stage === "download" },
    { key: "transcription", label: "Transcription", match: (d) => d.stage === "transcribe" },
    { key: "analysis", label: "Analysis", match: (d) => d.stage === "analyse" },
    { key: "blocked", label: "Blocked", match: (d) => d.last_run_status === "failed" },
    {
      key: "retrying",
      label: "Retrying",
      match: (d) => d.attempts > 0 && d.last_run_status !== "failed",
    },
  ];

/** Humanise a duration in seconds ("just now" / "3m" / "2h 5m" / "1d 4h"). */
function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

/** Absolute → relative "x ago" for a success/failure watermark. */
function fmtAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return `${fmtDuration(Math.max(0, Math.floor((Date.now() - ms) / 1000)))} ago`;
}

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

  // Pipeline diagnostics (read-only counts + per-item detail).
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<ApiResult<PhonePipelineStatusResult> | null>(null);

  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ApiResult<ProcessPendingPhoneResult> | null>(
    null,
  );

  // ONE source of truth: phone-pipeline-status returns health + stage backlog +
  // freshness + the per-item diagnostic rows (detail=true), so there is no second
  // client-side backlog computation to drift.
  const loadStatus = useCallback(async () => {
    if (!tenantId) return;
    setStatusLoading(true);
    setStatus(await getPhonePipelineStatus(tenantId, true));
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
  const [diagFilter, setDiagFilter] = useState("all");
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

  const data = status?.ok ? status.data : null;
  const diagRows = useMemo(() => data?.diagnostics ?? [], [data]);
  const filteredDiag = useMemo(() => {
    const f = DIAG_FILTERS.find((x) => x.key === diagFilter) ?? DIAG_FILTERS[0];
    return diagRows.filter(f.match);
  }, [diagRows, diagFilter]);

  // Honest header status: not-configured never reads as connected.
  const headerStatus: ConnectorStatus =
    accountLoaded && !configured
      ? "warning"
      : statusLoading
        ? "syncing"
        : status && !status.ok
          ? "error"
          : data && (data.recordings_total > 0 || data.eligible_backlog > 0)
            ? "connected"
            : "warning";

  if (!allowed) return <RestrictedNotice role={role} />;

  return (
    <div className="space-y-6">
      {/* Operational header + primary health (scheduler / worker / useful) */}
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
            Pipeline health
          </div>
          <div className="flex items-center gap-2">
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

        {data && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  HEALTH_TONE[data.health] ?? HEALTH_TONE.warning
                }`}
              >
                {data.health}
              </span>
              <span className="text-xs text-muted-foreground">{data.health_reason}</span>
            </div>

            {/* Scheduler vs worker health, separately (§8/§10) */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <HealthTile
                label="Scheduler"
                value={data.scheduler_healthy ? "healthy" : "stale"}
                tone={data.scheduler_healthy ? "text-success" : "text-warning"}
                sub={`enqueued ${fmtAgo(data.last_scheduler_at)}`}
              />
              <HealthTile
                label="Worker"
                value={data.worker_healthy ? "healthy" : "stale"}
                tone={data.worker_healthy ? "text-success" : "text-warning"}
                sub={`ran ${fmtAgo(data.last_worker_success_at)}`}
              />
              <HealthTile
                label="Eligible backlog"
                value={String(data.eligible_backlog)}
                tone={data.eligible_backlog > 0 ? "text-warning" : "text-success"}
                sub={data.eligible_backlog === 0 ? "clear" : "recordings need work"}
              />
              <HealthTile
                label="Current failures"
                value={String(data.current_unresolved_failures)}
                tone={
                  data.current_unresolved_failures > 0
                    ? "text-destructive"
                    : "text-muted-foreground"
                }
                sub={data.current_unresolved_failures > 0 ? "blocked now" : "none unresolved"}
              />
              <HealthTile
                label="Oldest waiting"
                value={
                  data.eligible_backlog === 0 ? "—" : fmtDuration(data.oldest_pending_age_seconds)
                }
                tone={
                  (data.oldest_pending_age_seconds ?? 0) > 1800
                    ? "text-destructive"
                    : "text-foreground"
                }
              />
              <HealthTile
                label="Last useful processing"
                value={fmtAgo(data.last_useful_at)}
                tone="text-foreground"
              />
              <HealthTile
                label="Throughput"
                value={
                  data.throughput_total_per_hour > 0
                    ? `${data.throughput_total_per_hour}/hr`
                    : "idle"
                }
                tone="text-foreground"
                sub={
                  data.throughput_total_per_hour > 0
                    ? `${data.throughput_downloads_per_hour}d · ${data.throughput_transcripts_per_hour}t · ${data.throughput_analyses_per_hour}a`
                    : undefined
                }
              />
              <HealthTile
                label="Est. drain"
                value={
                  data.eligible_backlog === 0
                    ? "clear"
                    : data.estimated_drain_seconds === null
                      ? "waiting"
                      : fmtDuration(data.estimated_drain_seconds)
                }
                tone="text-foreground"
                sub={
                  data.eligible_backlog > 0 && data.estimated_drain_seconds === null
                    ? "no recent throughput"
                    : undefined
                }
              />
            </div>
          </>
        )}
      </div>

      {/* Stage counts — truthful "what needs work" */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="text-sm font-semibold">Stage backlog</div>
        <div className="text-xs text-muted-foreground">
          Where each incomplete recording currently sits in the pipeline.
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StageTile
            label="Waiting for download"
            value={data?.not_downloaded ?? null}
            tone={data && data.not_downloaded > 0 ? "text-destructive" : "text-muted-foreground"}
          />
          <StageTile
            label="Waiting for transcription"
            value={data?.need_transcription ?? null}
            tone={data && data.need_transcription > 0 ? "text-warning" : "text-muted-foreground"}
          />
          <StageTile
            label="Waiting for analysis"
            value={data?.need_analysis ?? null}
            tone={data && data.need_analysis > 0 ? "text-warning" : "text-muted-foreground"}
          />
          <StageTile label="Completed" value={data?.completed ?? null} tone="text-success" />
          <StageTile
            label="Blocked"
            value={data?.current_unresolved_failures ?? null}
            tone={
              data && data.current_unresolved_failures > 0
                ? "text-destructive"
                : "text-muted-foreground"
            }
          />
        </div>
        {data && data.missing_provider_id > 0 && (
          <div className="mt-3 rounded-md border border-hairline bg-surface-alt px-3 py-2 text-xs text-muted-foreground">
            {data.missing_provider_id} recording(s) have no provider identifier and can never be
            downloaded — excluded from selection (operator action needed).
          </div>
        )}
      </div>

      {/* Recovery overrides — normal operation needs neither button */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">Recovery overrides</div>
              <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Admin only
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Processing runs automatically (scheduler every 2 min → worker). Use these only to
              force work now — day-to-day operation needs neither.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={runCalls}
              disabled={!configured || running !== null}
              title="Recovery override: re-sync the last 24 hours of calls"
            >
              {running === "calls" ? "Catching up…" : "Catch up 24h"}
            </Button>
            <Button
              size="sm"
              onClick={runProcessPending}
              disabled={processing || !tenantId}
              title="Recovery override: force-process a batch of the oldest pending recordings now"
            >
              {processing ? "Processing…" : "Process pending now"}
            </Button>
          </div>
        </div>

        {data?.last_failure_message &&
          (data.last_failure_is_current ? (
            <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Current pipeline failure: {data.last_failure_message}
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-hairline bg-surface-alt px-3 py-2 text-xs text-muted-foreground">
              Last failure (resolved by later work): {data.last_failure_message}
            </div>
          ))}

        <StatusPanel
          running={processing}
          result={processResult}
          renderOk={(d) => [
            { label: "Processed", value: String(d.processed) },
            { label: "Downloaded", value: String(d.downloaded) },
            { label: "Transcribed", value: String(d.transcribed) },
            { label: "Analysed", value: String(d.analysed) },
            { label: "Interaction ready", value: String(d.interaction_ready) },
            { label: "Failed", value: String(d.failed) },
            { label: "Backlog left", value: String(d.eligible_backlog) },
          ]}
        />
        {processResult?.ok && processResult.data.reason === "no_eligible_recordings" && (
          <div className="mt-3 rounded-md border border-hairline bg-surface-alt px-3 py-2 text-xs text-muted-foreground">
            Nothing eligible to process — the backlog is clear (not a skipped batch).
          </div>
        )}
        {processResult?.ok && processResult.data.last_error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Failed at{" "}
            <span className="font-mono">{processResult.data.failed_step ?? "unknown"}</span> —{" "}
            {processResult.data.last_error}
          </div>
        )}
      </div>

      {/* Unresolved items — the honest per-recording diagnostic table (§11) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Unresolved items</div>
            <div className="text-xs text-muted-foreground">
              Every recording that still needs work — read-only. No recording URLs or content.
            </div>
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

        {!data ? (
          <p className="mt-4 text-xs text-muted-foreground">Loading diagnostics…</p>
        ) : filteredDiag.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {diagRows.length === 0
              ? "No unresolved items — the pipeline is clear."
              : "No items match this filter."}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="border-b border-hairline text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Recorded</th>
                  <th className="py-2 pr-3 font-medium">Call ID</th>
                  <th className="py-2 pr-3 font-medium">Stage</th>
                  <th className="py-2 pr-3 font-medium">Age</th>
                  <th className="py-2 pr-3 font-medium">Attempts</th>
                  <th className="py-2 pr-3 font-medium">Last error</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredDiag.map((d) => (
                  <tr key={d.recording_id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {fmtAgo(d.started_at)}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                      {d.provider_call_id ?? "—"}
                    </td>
                    <td className="py-2 pr-3">{d.stage}</td>
                    <td className="py-2 pr-3 tabular whitespace-nowrap">
                      {fmtDuration(d.age_seconds)}
                    </td>
                    <td className="py-2 pr-3 tabular">{d.attempts}</td>
                    <td className="py-2 pr-3">
                      {d.last_error_code ? (
                        <span className="font-mono text-[11px] text-destructive">
                          {d.last_error_code}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          d.last_run_status === "failed"
                            ? "text-destructive"
                            : d.attempts === 0
                              ? "text-muted-foreground"
                              : "text-warning"
                        }
                      >
                        {d.attempts === 0 ? "waiting" : (d.last_run_status ?? "—")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
              Historical failures, connection test, on-demand backfill, retry one recording. Not
              needed day to day.
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
            {/* Historical / resolved failures — NOT current health */}
            {data && (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StageTile
                  label="Failures (24h)"
                  value={data.failures_24h}
                  tone={data.failures_24h > 0 ? "text-warning" : "text-muted-foreground"}
                />
                <StageTile
                  label="All-time failures"
                  value={data.historical_failures}
                  tone="text-muted-foreground"
                />
                <StageTile
                  label="Dead-letter jobs"
                  value={data.dead_letter_count}
                  tone={data.dead_letter_count > 0 ? "text-destructive" : "text-muted-foreground"}
                />
                <StageTile
                  label="Active jobs"
                  value={data.processing}
                  tone={data.processing > 0 ? "text-accent" : "text-muted-foreground"}
                />
              </div>
            )}

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

/** Compact health tile (value + optional sub-line). */
function HealthTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-alt p-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-display mt-1.5 text-lg font-bold tabular ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Big-number stage-count tile. */
function StageTile({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-alt p-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-display mt-2 text-2xl font-bold tabular ${tone}`}>
        {value === null ? "—" : value}
      </div>
    </div>
  );
}
