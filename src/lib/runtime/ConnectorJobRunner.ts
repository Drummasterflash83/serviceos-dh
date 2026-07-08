/**
 * ConnectorJobRunner — one runtime job model. Connectors register their recent
 * sync runs as generic `ConnectorJob`s (no duplicated job UI). `retry`/`cancel`
 * are advertised hooks; the executable controls live in each connector's settings
 * surface today (server-side cron owns the real scheduling), so they reject with
 * a clear "not supported here" rather than silently doing nothing.
 */

import type { OperationsSnapshot, PlatformJobLite, SyncRunRow } from "@/lib/ops-metrics";
import { eventLabel, runsForConnector } from "./ConnectorLogs";
import type { ConnectorJob, JobStatus, TimelineEvent } from "./types";

function jobStatus(status: string): JobStatus {
  if (status === "running") return "running";
  if (status === "success") return "success";
  if (status === "failed") return "failed";
  return "queued";
}

/** platform_jobs.status → the runtime's generic JobStatus. */
function platformJobStatus(status: string): JobStatus {
  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
    case "skipped":
      return "cancelled";
    default:
      return "queued"; // queued | retrying
  }
}

// A runtime connector id may differ from the value stored in platform_jobs (e.g.
// "google_workspace" vs the "google-workspace" written by the Edge Functions).
const CONNECTOR_ALIASES: Record<string, string[]> = {
  google_workspace: ["google_workspace", "google-workspace"],
  gmail: ["gmail"],
  simwood: ["simwood"],
};

function platformJobsForConnector(connectorId: string, jobs: PlatformJobLite[]): PlatformJobLite[] {
  const aliases = CONNECTOR_ALIASES[connectorId] ?? [connectorId];
  return jobs.filter((j) => j.connector_id !== null && aliases.includes(j.connector_id));
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

/** Build generic jobs for one connector from the durable platform_jobs rows. */
export function buildPlatformJobs(connectorId: string, jobs: PlatformJobLite[]): ConnectorJob[] {
  return platformJobsForConnector(connectorId, jobs)
    .slice(0, 10)
    .map((j) => ({
      id: j.id,
      connector: connectorId,
      type: j.job_type,
      status: platformJobStatus(j.status),
      startedAt: j.started_at,
      finishedAt: j.completed_at,
      recordsProcessed: j.records_processed ?? 0,
      errors: j.status === "failed" ? 1 : 0,
      metadata: {
        job_type: j.job_type,
        progress_current: j.progress_current,
        progress_total: j.progress_total,
        last_error: j.last_error,
      },
      retry: unsupported,
      cancel: unsupported,
    }));
}

/**
 * The runtime job list for a connector: PREFERS durable platform_jobs and falls
 * back to sync-run-derived jobs when none exist yet (so dashboards aren't blank
 * during migration). Used for both card counts and the jobs list.
 */
export function jobsForConnector(connectorId: string, s: OperationsSnapshot): ConnectorJob[] {
  const platform = buildPlatformJobs(connectorId, s.platformJobs);
  return platform.length > 0 ? platform : buildJobs(connectorId, s.syncRuns);
}

export function countJobs(jobs: ConnectorJob[]): { running: number; queued: number } {
  return {
    running: jobs.filter((j) => j.status === "running").length,
    queued: jobs.filter((j) => j.status === "queued").length,
  };
}

function timelineDetail(job: ConnectorJob): string | undefined {
  if (job.status === "failed") {
    const err = (job.metadata?.last_error as string | undefined) ?? null;
    return err ? err.slice(0, 120) : "Failed";
  }
  if (job.recordsProcessed > 0) return `${job.recordsProcessed} records`;
  return undefined;
}

/**
 * A connector's recent operational timeline — the same platform-jobs-first (with
 * sync-run fallback) source as the cards, mapped to display events. No fake
 * events: everything is a real job/run.
 */
export function buildTimeline(connectorId: string, s: OperationsSnapshot): TimelineEvent[] {
  return jobsForConnector(connectorId, s)
    .filter((j) => j.startedAt || j.finishedAt)
    .slice(0, 8)
    .map((j) => ({
      id: j.id,
      at: j.finishedAt ?? j.startedAt ?? "",
      title: j.type,
      detail: timelineDetail(j),
      status: j.status,
      records: j.recordsProcessed,
    }));
}
