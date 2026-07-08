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
import { buildLogs } from "../ConnectorLogs";
import { countJobs, jobsForConnector } from "../ConnectorJobRunner";
import { calculateFreshness, deriveHealth, type ConnectorFreshness } from "../freshness";
import { ago, latestError } from "../diagnostics";
import type {
  ConnectorHealthReport,
  ConnectorProvider,
  ConnectorWarning,
  DiagnosticGroup,
} from "../types";

const descriptor = getConnector("gmail")!;
const ID = "gmail";

// OAuth mailboxes sync on a ~5-minute cron (email-scheduled-sync).
const EXPECTED_INTERVAL_SEC = 5 * 60;

/**
 * Gmail OAuth truth: "connected" needs a real OAuth mailbox; "authenticated" needs
 * an ACTIVE token. No active token ⇒ authOk=false ⇒ freshness offline (evidence of
 * a disconnected mailbox), never a fake healthy.
 */
function evaluate(s: OperationsSnapshot): {
  freshness: ConnectorFreshness;
  health: ConnectorHealthReport;
} {
  const e = s.email;
  const configured = e.gmailOauthAccounts > 0;
  const authOk = e.gmailOauthActive > 0;
  const freshness = calculateFreshness({
    lastSuccess: e.gmailLastSuccess,
    lastFailure: e.gmailLastFailure,
    expectedIntervalSec: EXPECTED_INTERVAL_SEC,
    configured,
    authOk,
  });
  const hasNewerFailure =
    !!e.gmailLastFailure &&
    (!e.gmailLastSuccess || Date.parse(e.gmailLastFailure) > Date.parse(e.gmailLastSuccess));
  const health = deriveHealth({
    freshness,
    configured,
    authOk,
    hasNewerFailure,
    criticalIssue: configured && !authOk ? "OAuth mailbox has no active token" : null,
  });
  return { freshness, health };
}

export const gmailProvider: ConnectorProvider = {
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
      connections: s.email.gmailOauthAccounts,
      activeAccounts: s.email.gmailOauthActive,
      lastSync: s.email.gmailLastSuccess,
      records: s.email.emailMessagesTotal,
      errors24h: s.email.gmailFailures24h,
      runningJobs: jc.running,
      queuedJobs: jc.queued,
      averageSyncTime: "—",
      healthScore: evaluate(s).health.score,
    };
  },
  warnings: (s): ConnectorWarning[] => {
    const e = s.email;
    // Not configured is NORMAL for a DWD-primary tenant — not a warning.
    if (e.gmailOauthAccounts === 0) return [];
    const w: ConnectorWarning[] = [];
    if (e.gmailOauthActive === 0) {
      w.push({
        id: "gmail:no_token",
        connector: ID,
        severity: "warning",
        title: "OAuth mailbox disconnected",
        detail: "The connected mailbox has no active token.",
        recommendedAction: "reconnect",
        actionLabel: "Reconnect Gmail",
      });
    }
    if (e.gmailFailures24h > 0) {
      w.push({
        id: "gmail:failures",
        connector: ID,
        severity: "warning",
        title: "Gmail sync failures",
        detail: `${e.gmailFailures24h} failed sync(s) in the last 24h.`,
        recommendedAction: "reconnect",
        actionLabel: "Reconnect Gmail",
      });
    }
    return w;
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
  jobs: (s) => jobsForConnector(ID, s),
};
