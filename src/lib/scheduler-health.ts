/**
 * Scheduler health — tenant-scoped reads (RLS browser client) that report, for
 * each scheduled/background function, when it last ran and whether that is fresh
 * for its expected cadence. Derived entirely from real evidence (sync-run rows +
 * platform_jobs). Honest: a function whose cron isn't configured yet shows
 * "never" rather than a fake healthy state.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type SchedulerStatus = "healthy" | "stale" | "never" | "unknown";

export interface SchedulerHealthItem {
  name: string;
  label: string;
  /** Expected cadence in seconds (documentation of the intended interval). */
  expectedIntervalSec: number;
  lastRunAt: string | null;
  status: SchedulerStatus;
}

interface SchedulerDef {
  name: string;
  label: string;
  table: "phone_sync_runs" | "email_sync_runs" | "platform_jobs";
  typeColumn: "sync_type" | "job_type";
  typeValue: string;
  tsColumn: "started_at" | "created_at";
  expectedIntervalSec: number;
}

// The platform's scheduled processing cadence (Signal Processing v1).
const SCHEDULERS: SchedulerDef[] = [
  {
    name: "phone-scheduled-sync",
    label: "Phone sync",
    table: "phone_sync_runs",
    typeColumn: "sync_type",
    typeValue: "scheduled_sync",
    tsColumn: "started_at",
    expectedIntervalSec: 300,
  },
  {
    name: "phone-processing-scheduled-sync",
    label: "Phone processing",
    table: "platform_jobs",
    typeColumn: "job_type",
    typeValue: "phone.process_pending",
    tsColumn: "created_at",
    expectedIntervalSec: 600,
  },
  {
    name: "email-scheduled-sync",
    label: "Gmail OAuth sync",
    table: "email_sync_runs",
    typeColumn: "sync_type",
    typeValue: "scheduled_sync",
    tsColumn: "started_at",
    expectedIntervalSec: 300,
  },
  {
    name: "email-workspace-scheduled-sync",
    label: "Workspace email sync",
    table: "email_sync_runs",
    typeColumn: "sync_type",
    typeValue: "workspace_scheduled_sync",
    tsColumn: "started_at",
    expectedIntervalSec: 300,
  },
  {
    name: "email-workspace-backfill-scheduled-sync",
    label: "Workspace backfill",
    table: "email_sync_runs",
    typeColumn: "sync_type",
    typeValue: "workspace_backfill_scheduled",
    tsColumn: "started_at",
    expectedIntervalSec: 900,
  },
  {
    name: "interactions-scheduled-sync",
    label: "Signal build",
    table: "platform_jobs",
    typeColumn: "job_type",
    typeValue: "interactions.sync",
    tsColumn: "created_at",
    expectedIntervalSec: 600,
  },
  {
    name: "identity-scheduled-sync",
    label: "Identity engine",
    table: "platform_jobs",
    typeColumn: "job_type",
    typeValue: "identity.resolve",
    tsColumn: "created_at",
    expectedIntervalSec: 300,
  },
  {
    name: "business-graph-scheduled-sync",
    label: "Business graph",
    table: "platform_jobs",
    typeColumn: "job_type",
    typeValue: "graph.sync",
    tsColumn: "created_at",
    expectedIntervalSec: 300,
  },
  {
    name: "customer-card-scheduled-sync",
    label: "Customer cards",
    table: "platform_jobs",
    typeColumn: "job_type",
    typeValue: "customer_card.sync",
    tsColumn: "created_at",
    expectedIntervalSec: 300,
  },
  {
    name: "recommendation-scheduled-sync",
    label: "Recommendations",
    table: "platform_jobs",
    typeColumn: "job_type",
    typeValue: "recommendation.sync",
    tsColumn: "created_at",
    expectedIntervalSec: 300,
  },
];

function statusFor(lastRunAt: string | null, expectedIntervalSec: number): SchedulerStatus {
  if (!lastRunAt) return "never";
  const t = Date.parse(lastRunAt);
  if (Number.isNaN(t)) return "unknown";
  const ageSec = (Date.now() - t) / 1000;
  // Generous grace (4× cadence) — a couple of missed ticks isn't "stale".
  return ageSec <= expectedIntervalSec * 4 ? "healthy" : "stale";
}

/** Per-scheduler last-run + freshness. Best-effort per item (read error → unknown). */
export async function getSchedulerHealth(): Promise<ApiResult<SchedulerHealthItem[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();

  const items = await Promise.all(
    SCHEDULERS.map(async (def): Promise<SchedulerHealthItem> => {
      try {
        const { data, error } = await supabase
          .from(def.table)
          .select(def.tsColumn)
          .eq(def.typeColumn, def.typeValue)
          .order(def.tsColumn, { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          return {
            name: def.name,
            label: def.label,
            expectedIntervalSec: def.expectedIntervalSec,
            lastRunAt: null,
            status: "unknown",
          };
        }
        const row = data as Record<string, string | null> | null;
        const lastRunAt = row ? (row[def.tsColumn] ?? null) : null;
        return {
          name: def.name,
          label: def.label,
          expectedIntervalSec: def.expectedIntervalSec,
          lastRunAt,
          status: statusFor(lastRunAt, def.expectedIntervalSec),
        };
      } catch {
        return {
          name: def.name,
          label: def.label,
          expectedIntervalSec: def.expectedIntervalSec,
          lastRunAt: null,
          status: "unknown",
        };
      }
    }),
  );

  return { ok: true, data: items };
}
