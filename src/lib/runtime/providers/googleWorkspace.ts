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
import type { ConnectorProvider, RuntimeHealth } from "../types";

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
  logs: (s) => buildLogs(ID, s.syncRuns),
  jobs: (s) => buildJobs(ID, s.syncRuns),
};
