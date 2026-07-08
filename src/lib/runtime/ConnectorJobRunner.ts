/**
 * ConnectorJobRunner — one runtime job model. Connectors register their recent
 * sync runs as generic `ConnectorJob`s (no duplicated job UI). `retry`/`cancel`
 * are advertised hooks; the executable controls live in each connector's settings
 * surface today (server-side cron owns the real scheduling), so they reject with
 * a clear "not supported here" rather than silently doing nothing.
 */

import type { SyncRunRow } from "@/lib/ops-metrics";
import { eventLabel, runsForConnector } from "./ConnectorLogs";
import type { ConnectorJob, JobStatus } from "./types";

function jobStatus(status: string): JobStatus {
  if (status === "running") return "running";
  if (status === "success") return "success";
  if (status === "failed") return "failed";
  return "queued";
}

const unsupported = () =>
  Promise.reject(new Error("Run this action from the connector's settings surface."));

/** Build generic jobs for one connector from its recent sync runs. */
export function buildJobs(connectorId: string, runs: SyncRunRow[]): ConnectorJob[] {
  return runsForConnector(connectorId, runs)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      connector: connectorId,
      type: eventLabel(r.sync_type),
      status: jobStatus(r.status),
      startedAt: r.started_at,
      finishedAt: r.completed_at,
      recordsProcessed: r.records_processed ?? 0,
      errors: r.status === "failed" ? 1 : 0,
      metadata: { sync_type: r.sync_type },
      retry: unsupported,
      cancel: unsupported,
    }));
}

export function countJobs(jobs: ConnectorJob[]): { running: number; queued: number } {
  return {
    running: jobs.filter((j) => j.status === "running").length,
    queued: jobs.filter((j) => j.status === "queued").length,
  };
}
