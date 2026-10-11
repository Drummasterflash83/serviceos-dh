import { staleAfterSec } from "./health-model.ts";

export type SchedulerStatus = "healthy" | "stale" | "never" | "unknown" | "failed" | "paused";

/** Fresh activity alone does not prove successful scheduling or completed capture. */
export function schedulerOutcome(
  row: Record<string, unknown> | null,
  timestampColumn: string,
  expectedIntervalSec: number,
  nowMs = Date.now(),
): { lastRunAt: string | null; status: SchedulerStatus } {
  if (!row) return { lastRunAt: null, status: "never" };
  const lastRunAt =
    typeof row[timestampColumn] === "string" ? (row[timestampColumn] as string) : null;
  const at = lastRunAt ? Date.parse(lastRunAt) : NaN;
  if (!Number.isFinite(at) || at > nowMs + 60_000) return { lastRunAt, status: "unknown" };
  if (
    ["failed", "dead_letter", "retrying"].includes(String(row.status)) ||
    row.inventory_unavailable === true ||
    (typeof row.enqueue_unconfirmed === "number" && row.enqueue_unconfirmed > 0)
  )
    return { lastRunAt, status: "failed" };
  if (!["success", "succeeded", "queued", "running"].includes(String(row.status)))
    return { lastRunAt, status: "unknown" };
  // Pauses are observed settings at this tick, not indefinitely current settings.
  if ((nowMs - at) / 1000 > staleAfterSec(expectedIntervalSec))
    return { lastRunAt, status: "stale" };
  if (typeof row.capture_paused === "number" && row.capture_paused > 0)
    return { lastRunAt, status: "paused" };
  return { lastRunAt, status: "healthy" };
}

export const schedulerStatusLabels: Record<SchedulerStatus, string> = {
  healthy: "On schedule",
  stale: "Overdue",
  never: "Not observed",
  unknown: "Unverified",
  failed: "Needs attention",
  paused: "Includes paused inputs",
};
