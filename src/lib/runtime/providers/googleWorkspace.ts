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
import { scoreOf } from "../ConnectorHealth";
import { buildLogs } from "../ConnectorLogs";
import { buildJobs, countJobs } from "../ConnectorJobRunner";
import { ago, latestError } from "../diagnostics";
import type { ConnectorProvider, DiagnosticGroup, RuntimeHealth } from "../types";

const descriptor = getConnector("google_workspace")!;
const ID = "google_workspace";

/**
 * Real Workspace status — no fake healthy. A saved-but-unverified connection is
 * NOT "connected"; it stays in setup (disconnected) so it never inflates the
 * platform "connected" count. Connected ⇒ a saved connection with status=active.
 * Healthy ⇒ active AND (a recent successful sync OR active mailboxes) AND no
 * recent failure / backfill error. Otherwise warning.
 */
function computeStatus(s: OperationsSnapshot): RuntimeHealth {
  const e = s.email;
  const hasConnection = e.connectionStatus !== null;

  // Nothing saved and nothing discovered → not present at all.
  if (!hasConnection && e.workspaceMailboxesTotal === 0) return "disconnected";
  // Delegation failed → surface it.
  if (e.connectionStatus === "error") return "critical";
  // Saved but not yet verified/active → belongs in setup, not "connected".
  if (e.connectionStatus !== "active") return "disconnected";

  // Active connection from here.
  if (e.workspaceFailures24h > 0 || e.backfillErrors > 0) return "warning";
  if (e.workspaceMailboxesTotal === 0) return "warning"; // active but nothing discovered
  if (e.backfillRunning > 0) return "backfilling";
  // Healthy only with proof of life: a recent success OR active mailboxes.
  if (e.workspaceLastSuccess !== null || e.workspaceMailboxesActive > 0) return "healthy";
  return "warning"; // active + mailboxes, but none enabled and never synced
}

export const googleWorkspaceProvider: ConnectorProvider = {
  descriptor,
  connect: () => actionOfKind(descriptor, "connect"),
  disconnect: () => actionOfKind(descriptor, "disconnect"),
  sync: () => actionOfKind(descriptor, "sync"),
  actions: () => actionsFor(descriptor),
  settings: () => ({ surface: "email", title: "Email", icon: Mail, Component: EmailOperations }),
  status: (s) => computeStatus(s),
  health: (s) => {
    const e = s.email;
    const status = computeStatus(s);
    const reasons: string[] = [];
    if (e.connectionStatus === "error") reasons.push("Delegation error");
    if (e.connectionStatus === "active" && e.workspaceMailboxesTotal === 0)
      reasons.push("No mailboxes discovered");
    if (e.workspaceFailures24h > 0) reasons.push(`${e.workspaceFailures24h} failed sync(s) in 24h`);
    if (e.backfillErrors > 0) reasons.push(`${e.backfillErrors} backfill error(s)`);
    if (
      e.connectionStatus === "active" &&
      e.workspaceMailboxesTotal > 0 &&
      e.workspaceLastSuccess === null &&
      e.workspaceMailboxesActive === 0
    )
      reasons.push("Awaiting first sync");
    return { status, score: scoreOf(status), reasons };
  },
  metrics: (s) => {
    const jc = countJobs(buildJobs(ID, s.syncRuns));
    return {
      connections: s.email.connectionStatus === "active" ? 1 : 0,
      activeAccounts: s.email.workspaceMailboxesActive,
      lastSync: s.email.workspaceLastSuccess,
      records: s.email.emailMessagesTotal,
      errors24h: s.email.workspaceFailures24h,
      runningJobs: jc.running,
      queuedJobs: jc.queued + s.email.backfillRunning,
      averageSyncTime: "—",
      healthScore: scoreOf(computeStatus(s)),
    };
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
  jobs: (s) => buildJobs(ID, s.syncRuns),
};
