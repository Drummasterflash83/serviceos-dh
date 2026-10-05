/**
 * ConnectorLogs — one log model. Connectors turn their sync runs into generic
 * `ConnectorLog`s; the Overview simply reads them. Also owns the mapping from a
 * raw sync-run row to the connector it belongs to (the only vendor knowledge,
 * kept declarative).
 */

import type { SyncRunRow } from "@/lib/ops-metrics";
import type { ConnectorLog, LogSeverity } from "./types";

function isWorkspaceSyncType(syncType: string): boolean {
  return syncType.startsWith("workspace");
}

/** Which connector a raw sync-run row belongs to. */
export function runConnectorId(run: SyncRunRow): string {
  if (run.provider === "simwood") return "simwood";
  if (run.provider === "google_workspace") return "google_workspace";
  if (run.provider === "gmail") {
    return isWorkspaceSyncType(run.sync_type) ? "google_workspace" : "gmail";
  }
  return run.provider;
}

export function runsForConnector(id: string, runs: SyncRunRow[]): SyncRunRow[] {
  return runs.filter((r) => runConnectorId(r) === id);
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

export function eventLabel(syncType: string): string {
  return EVENT_LABELS[syncType] ?? syncType.replace(/_/g, " ");
}

export function severityOf(status: string): LogSeverity {
  if (status === "failed") return "error";
  if (status === "running") return "info";
  return "info";
}

/** The noun a connector's records represent, for human-readable summaries. */
function recordNoun(connectorId: string, syncType: string): string {
  if (connectorId === "simwood") {
    if (syncType.includes("recording")) return "recordings";
    if (syncType.includes("transcript")) return "transcripts";
    if (syncType.includes("insight")) return "insights";
    return "calls";
  }
  if (syncType.includes("discover")) return "mailboxes";
  return "messages";
}

/**
 * Human-readable summary for one sync run (deliverable: better recent activity).
 * Robust to missing metadata — falls back to the event label + status.
 */
function summarise(connectorId: string, r: SyncRunRow): string {
  const label = eventLabel(r.sync_type);
  if (r.status === "failed") {
    return `${label} failed${r.error_message ? `: ${r.error_message}` : ""}`;
  }
  if (r.status === "running") return `${label} running…`;
  const n = r.records_processed ?? 0;
  const noun = recordNoun(connectorId, r.sync_type);
  if (r.sync_type.includes("discover")) {
    return `${label} · ${n} ${noun} found`;
  }
  if (n === 0) return `${label} · no new ${noun}`;
  return `${label} · ${n} ${noun} imported`;
}

/** Build generic logs for one connector from its recent sync runs. */
export function buildLogs(connectorId: string, runs: SyncRunRow[]): ConnectorLog[] {
  return runsForConnector(connectorId, runs).map((r) => ({
    id: r.id,
    timestamp: r.completed_at ?? r.started_at ?? "",
    connector: connectorId,
    severity: severityOf(r.status),
    message: summarise(connectorId, r),
    metadata: { sync_type: r.sync_type, status: r.status, records: r.records_processed ?? 0 },
  }));
}
