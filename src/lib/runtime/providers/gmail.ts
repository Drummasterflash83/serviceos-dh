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
import { ago, latestError } from "../diagnostics";
import type { ConnectorProvider, DiagnosticGroup, RuntimeHealth } from "../types";

const descriptor = getConnector("gmail")!;
const ID = "gmail";

/**
 * Gmail OAuth is "connected" only when a real OAuth mailbox exists. Healthy needs
 * an ACTIVE OAuth account and no recent failure; an account present but not active
 * (e.g. token error) is a warning, not healthy.
 */
function computeStatus(s: OperationsSnapshot): RuntimeHealth {
  const e = s.email;
  if (e.gmailOauthAccounts === 0) return "disconnected";
  if (e.gmailFailures24h > 0) return "warning";
  if (e.gmailOauthActive === 0) return "warning"; // connected but no active token
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
    const e = s.email;
    const status = computeStatus(s);
    const reasons: string[] = [];
    if (e.gmailOauthAccounts === 0) reasons.push("No OAuth mailbox connected");
    if (e.gmailFailures24h > 0) reasons.push(`${e.gmailFailures24h} failed sync(s) in 24h`);
    if (e.gmailOauthAccounts > 0 && e.gmailOauthActive === 0)
      reasons.push("Mailbox has no active token — reconnect");
    return { status, score: scoreOf(status), reasons };
  },
  metrics: (s) => {
    const jc = countJobs(buildJobs(ID, s.syncRuns));
    return {
      connections: s.email.gmailOauthAccounts,
      activeAccounts: s.email.gmailOauthActive,
      lastSync: s.email.gmailLastSuccess,
      records: s.email.emailMessagesTotal,
      errors24h: s.email.gmailFailures24h,
      runningJobs: jc.running,
      queuedJobs: jc.queued,
      averageSyncTime: "—",
      healthScore: scoreOf(computeStatus(s)),
    };
  },
  cardMetrics: (s) => {
    const e = s.email;
    return [
      { label: "OAuth mailboxes", value: e.gmailOauthAccounts },
      { label: "Active", value: e.gmailOauthActive },
      { label: "Messages", value: e.emailMessagesTotal },
      { label: "Errors 24h", value: e.gmailFailures24h },
    ];
  },
  diagnostics: (s): DiagnosticGroup[] => {
    const e = s.email;
    return [
      {
        title: "OAuth accounts",
        rows: [
          {
            label: "Connected accounts",
            value: String(e.gmailOauthAccounts),
            tone: e.gmailOauthAccounts > 0 ? "success" : "muted",
          },
          {
            label: "Active accounts",
            value: String(e.gmailOauthActive),
            tone: e.gmailOauthActive > 0 ? "success" : "warning",
          },
        ],
      },
      {
        title: "Sync",
        rows: [
          {
            label: "Last successful sync",
            value: ago(e.gmailLastSuccess),
            tone: e.gmailLastSuccess ? "success" : "muted",
          },
          {
            label: "Last failed sync",
            value: ago(e.gmailLastFailure),
            tone: e.gmailLastFailure ? "critical" : "muted",
          },
          {
            label: "Failures (24h)",
            value: String(e.gmailFailures24h),
            tone: e.gmailFailures24h > 0 ? "critical" : "success",
          },
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
