/** Bounded summary RPC; never reads raw scheduler/source tables in the browser. */
import { CADENCE_SEC } from "./health-model.ts";
import { schedulerOutcome, type SchedulerStatus } from "./scheduler-outcome.ts";
import type { ApiResult } from "./types.ts";
export interface SchedulerHealthItem {
  name: string;
  label: string;
  expectedIntervalSec: number;
  lastRunAt: string | null;
  status: SchedulerStatus;
}
interface SchedulerDef {
  name: string;
  label: string;
  expectedIntervalSec: number;
}
export const SCHEDULERS: SchedulerDef[] = [
  {
    name: "phone-scheduled-sync",
    label: "Phone sync",
    expectedIntervalSec: CADENCE_SEC.phoneSync,
  },
  {
    name: "phone-processing-scheduled-sync",
    label: "Phone processing",
    expectedIntervalSec: CADENCE_SEC.phoneProcessing,
  },
  {
    name: "email-scheduled-sync",
    label: "Gmail OAuth sync",
    expectedIntervalSec: CADENCE_SEC.emailGmail,
  },
  {
    name: "email-workspace-scheduled-sync",
    label: "Workspace email sync",
    expectedIntervalSec: CADENCE_SEC.emailWorkspace,
  },
  {
    name: "email-workspace-backfill-scheduled-sync",
    label: "Workspace backfill",
    expectedIntervalSec: CADENCE_SEC.emailWorkspaceBackfill,
  },
  {
    name: "interactions-scheduled-sync",
    label: "Signal build",
    expectedIntervalSec: CADENCE_SEC.interactions,
  },
  {
    name: "identity-scheduled-sync",
    label: "Identity engine",
    expectedIntervalSec: CADENCE_SEC.identity,
  },
  {
    name: "business-graph-scheduled-sync",
    label: "Business graph",
    expectedIntervalSec: CADENCE_SEC.businessGraph,
  },
  {
    name: "customer-card-scheduled-sync",
    label: "Customer cards",
    expectedIntervalSec: CADENCE_SEC.customerCards,
  },
  {
    name: "recommendation-scheduled-sync",
    label: "Recommendations",
    expectedIntervalSec: CADENCE_SEC.recommendations,
  },
];

export interface SchedulerReaderClient {
  rpc(name: string, args: { p_tenant: string }): PromiseLike<{ data: unknown; error: unknown }>;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const iso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).length === allowed.length && Object.keys(v).every((k) => allowed.includes(k));
const statuses = new Set([
  "success",
  "failed",
  "queued",
  "running",
  "succeeded",
  "retrying",
  "dead_letter",
  "cancelled",
  "unknown",
]);
const count = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 999999999);
export async function readSchedulerHealth(
  db: SchedulerReaderClient,
  tenantId: string,
  nowMs = Date.now(),
): Promise<ApiResult<SchedulerHealthItem[]>> {
  const unavailable: ApiResult<SchedulerHealthItem[]> = {
    ok: false,
    error: {
      code: "scheduler_health_unavailable",
      message: "Scheduler status could not be verified.",
    },
  };
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenantId)) return unavailable;
  try {
    const { data, error } = await db.rpc("learn_scheduler_health_read", { p_tenant: tenantId });
    if (
      error ||
      !record(data) ||
      !keys(data, ["version", "tenant_id", "checked_at", "rows"]) ||
      data.version !== "learn-scheduler-health/1" ||
      data.tenant_id !== tenantId ||
      !iso(data.checked_at) ||
      Date.parse(data.checked_at) > nowMs + 60000 ||
      !Array.isArray(data.rows) ||
      data.rows.length !== SCHEDULERS.length ||
      JSON.stringify(data).length > 24000
    )
      return unavailable;
    const seen = new Map<string, Record<string, unknown>>();
    for (const row of data.rows) {
      if (
        !record(row) ||
        !keys(row, [
          "name",
          "observed_at",
          "status",
          "capture_paused",
          "enqueue_unconfirmed",
          "inventory_unavailable",
        ]) ||
        typeof row.name !== "string" ||
        !SCHEDULERS.some((d) => d.name === row.name) ||
        seen.has(row.name) ||
        (row.observed_at !== null && !iso(row.observed_at)) ||
        (row.status !== null && !statuses.has(String(row.status))) ||
        !count(row.capture_paused) ||
        !count(row.enqueue_unconfirmed) ||
        (row.inventory_unavailable !== null && typeof row.inventory_unavailable !== "boolean")
      )
        return unavailable;
      seen.set(row.name, row);
    }
    return {
      ok: true,
      data: SCHEDULERS.map((def) => {
        const row = seen.get(def.name)!;
        return {
          ...def,
          ...schedulerOutcome(
            row.observed_at === null && row.status === null ? null : row,
            "observed_at",
            def.expectedIntervalSec,
            nowMs,
          ),
        };
      }),
    };
  } catch {
    return unavailable;
  }
}
