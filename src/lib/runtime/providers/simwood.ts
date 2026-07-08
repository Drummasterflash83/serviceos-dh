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
import { buildLogs } from "../ConnectorLogs";
import { countJobs, jobsForConnector } from "../ConnectorJobRunner";
import { calculateFreshness, deriveHealth, fmtAge, type ConnectorFreshness } from "../freshness";
import { ago, latestError, yesNo } from "../diagnostics";
import type {
  ConnectorHealthReport,
  ConnectorProvider,
  ConnectorWarning,
  DiagnosticGroup,
} from "../types";

const descriptor = getConnector("simwood")!;
const ID = "simwood";

// Phone sync runs on a ~5-minute cron; freshness is measured against that cadence.
const EXPECTED_INTERVAL_SEC = 5 * 60;

/** True when the most recent failure is newer than the most recent success. */
function failedAfterSuccess(p: OperationsSnapshot["phone"]): boolean {
  if (!p.connectorLastFailure) return false;
  if (!p.connectorLastSuccess) return true;
  return Date.parse(p.connectorLastFailure) > Date.parse(p.connectorLastSuccess);
}

/**
 * Single source of operational truth for Phone: freshness (from the durable sync
 * watermark) + evidence-based health. No auth-failure signal exists for Simwood
 * beyond failed runs, so authOk stays true and failures surface via freshness /
 * hasNewerFailure rather than a fake "offline".
 */
function evaluate(s: OperationsSnapshot): {
  freshness: ConnectorFreshness;
  health: ConnectorHealthReport;
} {
  const p = s.phone;
  const freshness = calculateFreshness({
    lastSuccess: p.connectorLastSuccess,
    lastFailure: p.connectorLastFailure,
    expectedIntervalSec: EXPECTED_INTERVAL_SEC,
    configured: p.configured,
    authOk: true,
  });
  const extraReasons: string[] = [];
  if (p.transcriptionsFailed > 0)
    extraReasons.push(`${p.transcriptionsFailed} failed transcription(s)`);
  const health = deriveHealth({
    freshness,
    configured: p.configured,
    authOk: true,
    hasNewerFailure: failedAfterSuccess(p),
    syncing: p.running > 0,
    extraReasons,
  });
  return { freshness, health };
}

export const simwoodProvider: ConnectorProvider = {
  descriptor,
  connect: () => actionOfKind(descriptor, "connect"),
  disconnect: () => actionOfKind(descriptor, "disconnect"),
  sync: () => actionOfKind(descriptor, "sync"),
  actions: () => actionsFor(descriptor),
  settings: () => ({ surface: "phone", title: "Phone", icon: Phone, Component: PhoneOperations }),
  status: (s) => evaluate(s).health.status,
  freshness: (s) => evaluate(s).freshness,
  health: (s) => evaluate(s).health,
  metrics: (s) => {
    const jc = countJobs(jobsForConnector(ID, s));
    return {
      connections: s.phone.configured ? 1 : 0,
      activeAccounts: s.phone.configured ? 1 : 0,
      lastSync: s.phone.connectorLastSuccess ?? s.phone.lastSuccess,
      records: s.phone.callsTotal,
      errors24h: s.phone.failures24h,
      runningJobs: jc.running,
      queuedJobs: jc.queued + s.phone.transcriptionsPending,
      averageSyncTime: "—",
      healthScore: evaluate(s).health.score,
    };
  },
  warnings: (s): ConnectorWarning[] => {
    const p = s.phone;
    const { freshness } = evaluate(s);
    const w: ConnectorWarning[] = [];
    if (!p.configured) {
      w.push({
        id: "simwood:not_configured",
        connector: ID,
        severity: "critical",
        title: "Phone connector not configured",
        detail: "No Simwood account for this tenant.",
        recommendedAction: "settings",
        actionLabel: "Open settings",
      });
      return w;
    }
    if (failedAfterSuccess(p)) {
      w.push({
        id: "simwood:failing",
        connector: ID,
        severity: "warning",
        title: "Phone sync failing",
        detail: p.connectorLastError ?? "Last run failed after the last success.",
        recommendedAction: "reconnect",
        actionLabel: "Test connection",
      });
    } else if (freshness.status === "never_run") {
      w.push({
        id: "simwood:never_run",
        connector: ID,
        severity: "warning",
        title: "Phone never synced",
        detail: "Connector configured but has no successful sync yet.",
        recommendedAction: "reconnect",
        actionLabel: "Test connection",
      });
    } else if (freshness.status === "stale") {
      w.push({
        id: "simwood:stale",
        connector: ID,
        severity: "warning",
        title: "Phone sync stale",
        detail: `Last successful sync ${fmtAge(freshness.age_seconds)} (expected every 5 min).`,
        recommendedAction: "sync",
        actionLabel: "Catch up 24h",
      });
    }
    return w;
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
    const { freshness } = evaluate(s);
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
            tone: freshness.status === "healthy" ? "success" : "warning",
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
  jobs: (s) => jobsForConnector(ID, s),
};
