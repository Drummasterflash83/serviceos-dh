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
import type { ConnectorProvider, RuntimeHealth } from "../types";

const descriptor = getConnector("simwood")!;
const ID = "simwood";

function computeStatus(s: OperationsSnapshot): RuntimeHealth {
  const p = s.phone;
  const present = p.callsTotal > 0 || p.recordingsTotal > 0 || p.lastSuccess !== null;
  if (!present) return "disconnected";
  if (p.failures24h > 0) return "warning";
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
    const status = computeStatus(s);
    const reasons = s.phone.failures24h > 0 ? [`${s.phone.failures24h} failed sync(s) in 24h`] : [];
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
  logs: (s) => buildLogs(ID, s.syncRuns),
  jobs: (s) => buildJobs(ID, s.syncRuns),
};
