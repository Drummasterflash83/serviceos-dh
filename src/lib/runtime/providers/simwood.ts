/**
 * Simwood (Phone / VoIP) connector provider — wraps the existing call/recording/
 * transcription pipeline by mapping the tenant snapshot. Its settings surface is
 * the unchanged PhoneOperations UI. No behaviour change.
 */

import { Phone } from "lucide-react";

import { getConnector } from "@/lib/connectors/registry";
import { PhoneOperations } from "@/components/app/admin/PhoneOperations";
import type { OperationsSnapshot } from "@/lib/ops-metrics";
import { actionOfKind, actionsFor } from "../ConnectorActions";
import { scoreOf } from "../ConnectorHealth";
import { buildLogs } from "../ConnectorLogs";
import { buildJobs, countJobs } from "../ConnectorJobRunner";
import { ago, latestError, yesNo } from "../diagnostics";
import type { ConnectorProvider, DiagnosticGroup, RuntimeHealth } from "../types";

const descriptor = getConnector("simwood")!;
const ID = "simwood";

// Scheduled phone sync runs every ~5 min; if the durable watermark hasn't moved
// in this long, sync is stale (broken cron / credentials) — not "healthy".
const STALE_MINUTES = 20;

/** Minutes since an ISO timestamp, or null if absent/unparseable. */
function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 60000);
}

/** True when the most recent failure is newer than the most recent success. */
function failedAfterSuccess(p: OperationsSnapshot["phone"]): boolean {
  if (!p.connectorLastFailure) return false;
  if (!p.connectorLastSuccess) return true;
  return Date.parse(p.connectorLastFailure) > Date.parse(p.connectorLastSuccess);
}

/**
 * Phone status derives from CONFIG + durable sync freshness (Operational Truth):
 * "Connected" requires an enabled connector account; "Healthy" requires a proven
 * recent successful sync within the schedule window and no fresher failure. Never
 * healthy on unproven state.
 */
function computeStatus(s: OperationsSnapshot): RuntimeHealth {
  const p = s.phone;
  if (!p.configured) return "disconnected"; // no enabled connector account
  if (failedAfterSuccess(p)) return "warning"; // last run failed
  if (p.failures24h > 0) return "warning";
  const mins = minutesSince(p.connectorLastSuccess);
  if (mins === null || mins > STALE_MINUTES) return "warning"; // stale / never synced
  if (p.running > 0) return "syncing";
  return "healthy";
}

export const simwoodProvider: ConnectorProvider = {
  descriptor,
  connect: () => actionOfKind(descriptor, "connect"),
  disconnect: () => actionOfKind(descriptor, "disconnect"),
  sync: () => actionOfKind(descriptor, "sync"),
  actions: () => actionsFor(descriptor),
  settings: () => ({ surface: "phone", title: "Phone", icon: Phone, Component: PhoneOperations }),
  status: (s) => computeStatus(s),
  health: (s) => {
    const p = s.phone;
    const status = computeStatus(s);
    const reasons: string[] = [];
    if (!p.configured) reasons.push("Simwood not configured");
    if (p.configured && failedAfterSuccess(p))
      reasons.push(`Last sync failed${p.connectorLastError ? `: ${p.connectorLastError}` : ""}`);
    const mins = minutesSince(p.connectorLastSuccess);
    if (p.configured && !failedAfterSuccess(p)) {
      if (mins === null) reasons.push("Awaiting first successful sync");
      else if (mins > STALE_MINUTES)
        reasons.push(`Sync stale — last success ${Math.round(mins)}m ago`);
    }
    if (p.failures24h > 0) reasons.push(`${p.failures24h} failed sync(s) in 24h`);
    if (p.transcriptionsFailed > 0)
      reasons.push(`${p.transcriptionsFailed} failed transcription(s)`);
    return { status, score: scoreOf(status), reasons };
  },
  metrics: (s) => {
    const jc = countJobs(buildJobs(ID, s.syncRuns));
    return {
      connections: computeStatus(s) === "disconnected" ? 0 : 1,
      activeAccounts: 0,
      lastSync: s.phone.lastSuccess,
      records: s.phone.callsTotal,
      errors24h: s.phone.failures24h,
      runningJobs: jc.running,
      queuedJobs: jc.queued + s.phone.transcriptionsPending,
      averageSyncTime: "—",
      healthScore: scoreOf(computeStatus(s)),
    };
  },
  cardMetrics: (s) => {
    const p = s.phone;
    return [
      { label: "Calls", value: p.callsTotal },
      { label: "Today", value: p.callsToday },
      { label: "Recordings", value: p.recordingsTotal },
      { label: "Errors 24h", value: p.failures24h },
    ];
  },
  diagnostics: (s): DiagnosticGroup[] => {
    const p = s.phone;
    const mins = minutesSince(p.connectorLastSuccess);
    return [
      {
        title: "Configuration",
        rows: [
          {
            label: "Configured",
            value: p.configured ? "yes" : "no",
            tone: p.configured ? "success" : "critical",
          },
          {
            label: "Customer id",
            value: p.customerId ?? "—",
            tone: p.customerId ? "default" : "muted",
          },
          {
            label: "Last scheduled sync",
            value: ago(p.connectorLastSuccess),
            tone: mins !== null && mins <= STALE_MINUTES ? "success" : "warning",
          },
          {
            label: "Last scheduled failure",
            value: ago(p.connectorLastFailure),
            tone: p.connectorLastFailure ? "critical" : "muted",
          },
          {
            label: "Connector error",
            value: p.connectorLastError ?? "none",
            tone: p.connectorLastError ? "critical" : "muted",
          },
        ],
      },
      {
        title: "Connection",
        rows: [
          {
            label: "Connection test",
            value: p.testedOk ? "passed" : "not tested",
            tone: p.testedOk ? "success" : "warning",
          },
          {
            label: "Last successful call sync",
            value: ago(p.lastSuccess),
            tone: p.lastSuccess ? "success" : "muted",
          },
          {
            label: "Last failed call sync",
            value: ago(p.lastFailure),
            tone: p.lastFailure ? "critical" : "muted",
          },
          {
            label: "Failures (24h)",
            value: String(p.failures24h),
            tone: p.failures24h > 0 ? "critical" : "success",
          },
        ],
      },
      {
        title: "Pipeline",
        rows: [
          { label: "Calls total", value: String(p.callsTotal) },
          { label: "Calls today", value: String(p.callsToday) },
          { label: "Recordings total", value: String(p.recordingsTotal) },
          {
            label: "Pending transcriptions",
            value: String(p.transcriptionsPending),
            tone: p.transcriptionsPending > 0 ? "warning" : "muted",
          },
          {
            label: "Failed transcriptions",
            value: String(p.transcriptionsFailed),
            tone: p.transcriptionsFailed > 0 ? "critical" : "muted",
          },
          {
            label: "AI analysis pending",
            value: String(p.aiPending),
            tone: p.aiPending > 0 ? "warning" : "muted",
          },
          { label: "Sync running", value: yesNo(p.running > 0) },
          {
            label: "Latest error",
            value: latestError(ID, s.syncRuns) ?? "none",
            tone: latestError(ID, s.syncRuns) ? "critical" : "muted",
          },
        ],
      },
    ];
  },
  logs: (s) => buildLogs(ID, s.syncRuns),
  jobs: (s) => buildJobs(ID, s.syncRuns),
};
