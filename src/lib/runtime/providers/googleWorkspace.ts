/**
 * Google Workspace connector provider — wraps the existing DWD functionality by
 * mapping the tenant snapshot into the generic runtime shapes. No behaviour
 * change: its settings surface is the unchanged EmailOperations UI.
 */

import { Mail } from "lucide-react";

import { getConnector } from "@/lib/connectors/registry";
import { EmailOperations } from "@/components/app/admin/EmailOperations";
import type { OperationsSnapshot } from "@/lib/ops-metrics";
import { actionOfKind, actionsFor } from "../ConnectorActions";
import { buildLogs } from "../ConnectorLogs";
import { countJobs, jobsForConnector } from "../ConnectorJobRunner";
import { calculateFreshness, deriveHealth, fmtAge, type ConnectorFreshness } from "../freshness";
import { ago, latestError } from "../diagnostics";
import type {
  ConnectorHealthReport,
  ConnectorProvider,
  ConnectorWarning,
  DiagnosticGroup,
} from "../types";

const descriptor = getConnector("google_workspace")!;
const ID = "google_workspace";

// Workspace DWD mailboxes sync on a ~5-minute cron.
const EXPECTED_INTERVAL_SEC = 5 * 60;

/**
 * Workspace truth. "Configured" ⇒ a saved connection that is active OR errored
 * (a delegation error is still a present, broken connector; a merely pending/
 * unsaved one stays in setup as disconnected). "Authenticated" ⇒ active (an error
 * means delegation failed). Healthy needs proof-of-life within the sync window.
 */
function evaluate(s: OperationsSnapshot): {
  freshness: ConnectorFreshness;
  health: ConnectorHealthReport;
} {
  const e = s.email;
  const active = e.connectionStatus === "active";
  const errored = e.connectionStatus === "error";
  const configured = active || errored;
  const authOk = active;

  const freshness = calculateFreshness({
    lastSuccess: e.workspaceLastSuccess,
    lastFailure: e.workspaceLastFailure,
    expectedIntervalSec: EXPECTED_INTERVAL_SEC,
    configured,
    authOk,
  });
  const hasNewerFailure =
    !!e.workspaceLastFailure &&
    (!e.workspaceLastSuccess ||
      Date.parse(e.workspaceLastFailure) > Date.parse(e.workspaceLastSuccess));

  const extraReasons: string[] = [];
  if (errored) extraReasons.push("Delegation error — re-authorise DWD");

  const health = deriveHealth({
    freshness,
    configured,
    authOk,
    hasNewerFailure,
    runningFailures: e.backfillErrors,
    configIssue: active && e.workspaceMailboxesTotal === 0 ? "No mailboxes discovered" : null,
    backfilling: e.backfillRunning > 0,
    extraReasons,
  });
  return { freshness, health };
}

export const googleWorkspaceProvider: ConnectorProvider = {
  descriptor,
  connect: () => actionOfKind(descriptor, "connect"),
  disconnect: () => actionOfKind(descriptor, "disconnect"),
  sync: () => actionOfKind(descriptor, "sync"),
  actions: () => actionsFor(descriptor),
  settings: () => ({ surface: "email", title: "Email", icon: Mail, Component: EmailOperations }),
  status: (s) => evaluate(s).health.status,
  freshness: (s) => evaluate(s).freshness,
  health: (s) => evaluate(s).health,
  metrics: (s) => {
    const jc = countJobs(jobsForConnector(ID, s));
    return {
      connections: s.email.connectionStatus === "active" ? 1 : 0,
      activeAccounts: s.email.workspaceMailboxesActive,
      lastSync: s.email.workspaceLastSuccess,
      records: s.email.emailMessagesTotal,
      errors24h: s.email.workspaceFailures24h,
      runningJobs: jc.running,
      queuedJobs: jc.queued + s.email.backfillRunning,
      averageSyncTime: "—",
      healthScore: evaluate(s).health.score,
    };
  },
  warnings: (s): ConnectorWarning[] => {
    const e = s.email;
    const { freshness } = evaluate(s);
    const w: ConnectorWarning[] = [];
    if (e.connectionStatus === "error") {
      w.push({
        id: "google_workspace:delegation",
        connector: ID,
        severity: "critical",
        title: "Workspace delegation failed",
        detail: e.connectionError ?? "Domain-wide delegation could not authenticate.",
        recommendedAction: "reconnect",
        actionLabel: "Re-test delegation",
      });
      return w;
    }
    if (e.connectionStatus !== "active") return w; // pending/unsaved lives in setup
    if (e.workspaceMailboxesTotal === 0) {
      w.push({
        id: "google_workspace:no_mailboxes",
        connector: ID,
        severity: "warning",
        title: "No mailboxes discovered",
        detail: "Workspace is connected but no mailboxes have been discovered.",
        recommendedAction: "settings",
        actionLabel: "Discover mailboxes",
      });
    }
    if (freshness.status === "stale" || freshness.status === "never_run") {
      w.push({
        id: "google_workspace:stale",
        connector: ID,
        severity: "warning",
        title: freshness.status === "never_run" ? "Workspace never synced" : "Workspace sync stale",
        detail:
          freshness.status === "never_run"
            ? "Connected but no successful sync yet."
            : `Last successful sync ${fmtAge(freshness.age_seconds)} (expected every 5 min).`,
        recommendedAction: "reconnect",
        actionLabel: "Re-test delegation",
      });
    }
    if (e.backfillErrors > 0) {
      w.push({
        id: "google_workspace:backfill_errors",
        connector: ID,
        severity: "warning",
        title: "Backfill errors",
        detail: `${e.backfillErrors} mailbox backfill(s) errored.`,
        recommendedAction: "settings",
        actionLabel: "Open backfill",
      });
    }
    return w;
  },
  cardMetrics: (s) => {
    const e = s.email;
    return [
      { label: "Mailboxes", value: e.workspaceMailboxesTotal },
      { label: "Sync enabled", value: e.workspaceMailboxesActive },
      { label: "Messages", value: e.emailMessagesTotal },
      { label: "Errors 24h", value: e.workspaceFailures24h },
    ];
  },
  diagnostics: (s): DiagnosticGroup[] => {
    const e = s.email;
    const saved = e.connectionStatus !== null;
    return [
      {
        title: "Connection",
        rows: [
          {
            label: "Connection saved",
            value: saved ? "yes" : "no",
            tone: saved ? "success" : "muted",
          },
          {
            label: "Status",
            value: e.connectionStatus ?? "not connected",
            tone:
              e.connectionStatus === "active"
                ? "success"
                : e.connectionStatus === "error"
                  ? "critical"
                  : "warning",
          },
          { label: "Domain", value: e.connectionDomain ?? "—" },
          { label: "Impersonation subject", value: e.connectionSubject ?? "—" },
          { label: "Last verified", value: ago(e.connectionLastVerified) },
          {
            label: "DWD validation",
            value: e.connectionStatus === "active" ? "passed" : "not verified",
            tone: e.connectionStatus === "active" ? "success" : "warning",
          },
        ],
      },
      {
        title: "Mailboxes",
        rows: [
          { label: "Discovered", value: String(e.workspaceMailboxesTotal) },
          {
            label: "Active DWD (enabled)",
            value: String(e.workspaceMailboxesActive),
            tone: e.workspaceMailboxesActive > 0 ? "success" : "muted",
          },
          { label: "Disabled", value: String(e.workspaceMailboxesDisabled), tone: "muted" },
        ],
      },
      {
        title: "Sync & backfill",
        rows: [
          {
            label: "Last successful sync",
            value: ago(e.workspaceLastSuccess),
            tone: e.workspaceLastSuccess ? "success" : "muted",
          },
          {
            label: "Last failed sync",
            value: ago(e.workspaceLastFailure),
            tone: e.workspaceLastFailure ? "critical" : "muted",
          },
          {
            label: "Failures (24h)",
            value: String(e.workspaceFailures24h),
            tone: e.workspaceFailures24h > 0 ? "critical" : "success",
          },
          {
            label: "Running syncs",
            value: String(e.workspaceRunning),
            tone: e.workspaceRunning > 0 ? "warning" : "muted",
          },
          {
            label: "Backfill running",
            value: String(e.backfillRunning),
            tone: e.backfillRunning > 0 ? "warning" : "muted",
          },
          {
            label: "Backfill completed",
            value: String(e.backfillCompleted),
            tone: e.backfillCompleted > 0 ? "success" : "muted",
          },
          {
            label: "Backfill errors",
            value: String(e.backfillErrors),
            tone: e.backfillErrors > 0 ? "critical" : "muted",
          },
          {
            label: "Latest error",
            value: e.connectionError ?? latestError(ID, s.syncRuns) ?? "none",
            tone: e.connectionError || latestError(ID, s.syncRuns) ? "critical" : "muted",
          },
        ],
      },
    ];
  },
  logs: (s) => buildLogs(ID, s.syncRuns),
  jobs: (s) => jobsForConnector(ID, s),
};
