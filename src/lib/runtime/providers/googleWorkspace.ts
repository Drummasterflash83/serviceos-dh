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

function computeStatus(s: OperationsSnapshot): RuntimeHealth {
  const e = s.email;
  const present = e.workspaceMailboxesTotal > 0 || e.connectionStatus !== null;
  if (!present) return "disconnected";
  if (e.connectionStatus === "error") return "critical";
  if (e.backfillRunning > 0) return "backfilling";
  if (e.workspaceFailures24h > 0 || e.backfillErrors > 0) return "warning";
  return "healthy";
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
    const status = computeStatus(s);
    const reasons: string[] = [];
    if (s.email.connectionStatus === "error") reasons.push("Delegation error");
    if (s.email.workspaceFailures24h > 0)
      reasons.push(`${s.email.workspaceFailures24h} failed sync(s) in 24h`);
    if (s.email.backfillErrors > 0) reasons.push(`${s.email.backfillErrors} backfill error(s)`);
    return { status, score: scoreOf(status), reasons };
  },
  metrics: (s) => {
    const jc = countJobs(buildJobs(ID, s.syncRuns));
    return {
      connections: s.email.connectionStatus ? 1 : 0,
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
