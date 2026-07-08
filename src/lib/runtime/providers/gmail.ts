/**
 * Gmail OAuth connector provider — wraps the existing per-mailbox OAuth sync by
 * mapping the tenant snapshot. Shares the "email" settings surface (EmailOperations)
 * with Google Workspace. No behaviour change.
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

const descriptor = getConnector("gmail")!;
const ID = "gmail";

function computeStatus(s: OperationsSnapshot): RuntimeHealth {
  const e = s.email;
  if (e.gmailOauthAccounts === 0) return "disconnected";
  if (e.gmailFailures24h > 0) return "warning";
  return "healthy";
}

export const gmailProvider: ConnectorProvider = {
  descriptor,
  connect: () => actionOfKind(descriptor, "connect"),
  disconnect: () => actionOfKind(descriptor, "disconnect"),
  sync: () => actionOfKind(descriptor, "sync"),
  actions: () => actionsFor(descriptor),
  settings: () => ({ surface: "email", title: "Email", icon: Mail, Component: EmailOperations }),
  status: (s) => computeStatus(s),
  health: (s) => {
    const status = computeStatus(s);
    const reasons =
      s.email.gmailFailures24h > 0 ? [`${s.email.gmailFailures24h} failed sync(s) in 24h`] : [];
    return { status, score: scoreOf(status), reasons };
  },
  metrics: (s) => {
    const jc = countJobs(buildJobs(ID, s.syncRuns));
    return {
      connections: s.email.gmailOauthAccounts,
      activeAccounts: s.email.gmailOauthAccounts,
      lastSync: s.email.gmailLastSuccess,
      records: s.email.emailMessagesTotal,
      errors24h: s.email.gmailFailures24h,
      runningJobs: jc.running,
      queuedJobs: jc.queued,
      averageSyncTime: "—",
      healthScore: scoreOf(computeStatus(s)),
    };
  },
  logs: (s) => buildLogs(ID, s.syncRuns),
  jobs: (s) => buildJobs(ID, s.syncRuns),
};
