/**
 * Operations Centre — the ONE authoritative health model (frontend).
 *
 * A scheduler / connector / worker is "stale" when its newest success is older
 * than `expectedIntervalSec × HEALTH_STALE_MULTIPLIER`. Every Operations Centre
 * panel, badge and KPI derives freshness from THIS calculation, so they always
 * agree — no magic numbers (15/20/30 min) sprinkled through the codebase.
 *
 * Two invariants keep the platform honest:
 *   1. `CADENCE_SEC` MUST match the real cron schedules in
 *      supabase/migrations/*_scheduler_cron.sql and *_platform_job_queue.sql.
 *   2. This file has a byte-for-byte edge mirror at
 *      supabase/functions/_shared/health_model.ts (browser and Deno can't share
 *      a module). The multiplier + cadences in both MUST stay identical.
 *
 * Worked examples with the default multiplier of 4:
 *   • 2-minute scheduler  → stale after 8 minutes
 *   • 5-minute scheduler  → stale after 20 minutes
 *   • 15-minute scheduler → stale after 60 minutes
 */

/** How many missed ticks before a signal is considered stale. */
export const HEALTH_STALE_MULTIPLIER = 4;

/**
 * Real cron cadences in seconds. Keys are the logical scheduler/worker each
 * health surface tracks. Keep in lockstep with the cron migrations.
 */
export const CADENCE_SEC = {
  worker: 60, // platform-worker                     '* * * * *'
  phoneSync: 300, // phone-scheduled-sync            '*/5 * * * *'
  phoneProcessing: 120, // phone-processing-...       '*/2 * * * *'
  emailGmail: 300, // email-scheduled-sync           '*/5 * * * *'
  emailWorkspace: 300, // email-workspace-...         '*/5 * * * *'
  emailWorkspaceBackfill: 900, // ...backfill         '*/15 * * * *'
  interactions: 300, // interactions-scheduled-sync  '*/5 * * * *'
  identity: 300, // identity-scheduled-sync          '*/5 * * * *'
  businessGraph: 300, // business-graph-...           '*/5 * * * *'
  customerCards: 300, // customer-card-...            '*/5 * * * *'
  recommendations: 300, // recommendation-...         '*/5 * * * *'
} as const;

/** The single staleness threshold: cadence × multiplier, in seconds. */
export function staleAfterSec(expectedIntervalSec: number): number {
  return expectedIntervalSec * HEALTH_STALE_MULTIPLIER;
}

/** Same threshold in milliseconds (for callers comparing epoch ms). */
export function staleAfterMs(expectedIntervalSec: number): number {
  return staleAfterSec(expectedIntervalSec) * 1000;
}

export type FreshnessVerdict = "healthy" | "stale" | "never" | "unknown";

/**
 * Pure freshness verdict from a last-success timestamp and its cadence. The one
 * place "is this fresh?" is decided; every surface routes through it.
 */
export function freshnessVerdict(
  lastAtIso: string | null,
  expectedIntervalSec: number,
  nowMs: number = Date.now(),
): FreshnessVerdict {
  if (!lastAtIso) return "never";
  const t = Date.parse(lastAtIso);
  if (Number.isNaN(t)) return "unknown";
  const ageSec = (nowMs - t) / 1000;
  return ageSec <= staleAfterSec(expectedIntervalSec) ? "healthy" : "stale";
}
