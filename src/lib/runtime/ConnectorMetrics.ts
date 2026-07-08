/**
 * ConnectorMetrics — one metrics model. Every connector returns the same shape
 * and the same reusable card renders it, so there are no bespoke metric cards
 * (deliverable 6).
 */

import type { ConnectorMetric } from "@/lib/connectors/types";
import type { ConnectorMetrics } from "./types";

export function emptyMetrics(): ConnectorMetrics {
  return {
    connections: 0,
    activeAccounts: 0,
    lastSync: null,
    records: 0,
    errors24h: 0,
    runningJobs: 0,
    queuedJobs: 0,
    averageSyncTime: "—",
    healthScore: 0,
  };
}

/** Uniform mapping of the generic metrics to the reusable ConnectorCard tiles. */
export function toCardMetrics(m: ConnectorMetrics): ConnectorMetric[] {
  return [
    { label: "Accounts", value: m.activeAccounts },
    { label: "Records", value: m.records },
    { label: "Errors 24h", value: m.errors24h },
    { label: "Running jobs", value: m.runningJobs },
  ];
}
