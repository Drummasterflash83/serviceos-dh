/**
 * PhoneOperations — the Simwood VoIP dashboard (Communications › Phone).
 *
 * Extracted from the former AdminView with NO behaviour change: the same API
 * calls, handlers and controls. Reorganised so the operational status (pipeline
 * health) is primary and the manual diagnostics/backfill collapse away.
 */

import { useCallback, useEffect, useState } from "react";
import { Phone, Activity, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  testSimwoodConnection,
  syncSimwoodCalls,
  syncSimwoodRecordings,
  processPhonePipeline,
  getPhonePipelineStatus,
} from "@/lib/api";
import type {
  ApiResult,
  SimwoodConnectionResult,
  SimwoodSyncCallsResult,
  SimwoodSyncRecordingsResult,
  ProcessPhonePipelineResult,
  PhonePipelineStatusResult,
} from "@/lib/types";
import { ConnectorStatusBadge } from "@/components/ops";
import { ADMIN_ROLES, RestrictedNotice, StatusPanel } from "./StatusPanel";

// TODO(integration): replace this hardcoded Simwood customer id with the
// tenant's integration config once provider connections are stored per tenant.
const PROVIDER_CUSTOMER_ID = "3950";

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

export function PhoneOperations() {
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
      await syncSimwoodRecordings({ tenantId, providerCustomerId: PROVIDER_CUSTOMER_ID }),
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

  const [showDiagnostics, setShowDiagnostics] = useState(false);

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
                Automatic sync every 5 minutes · call history, recordings &amp; transcription
              </div>
            </div>
          </div>
          <ConnectorStatusBadge status="connected" />
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Processing pipeline
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

      {/* Diagnostics & manual sync (collapsed by default) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
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
