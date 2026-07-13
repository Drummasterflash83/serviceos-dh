// ServiceOS — the ONE authoritative health model (edge mirror).
//
// A scheduler / connector / worker is "stale" when its newest success is older
// than `expectedIntervalSec × HEALTH_STALE_MULTIPLIER`. Edge health surfaces
// (email_health, phone-pipeline-status) derive their staleness from HERE so they
// agree with the frontend Operations Centre — no magic minute constants.
//
// This is a byte-for-byte mirror of src/lib/health-model.ts (the browser bundle
// and Deno edge runtime cannot import a shared module). The multiplier and the
// cadences below MUST stay identical to that file, and the cadences MUST match
// the cron schedules in supabase/migrations/*_scheduler_cron.sql.
//
// Worked examples (multiplier 4): 2-min → 8-min, 5-min → 20-min, 15-min → 60-min.

/** How many missed ticks before a signal is considered stale. */
export const HEALTH_STALE_MULTIPLIER = 4;

/** Real cron cadences in seconds — keep in lockstep with the cron migrations. */
export const CADENCE_SEC = {
  worker: 60, // platform-worker            '* * * * *'
  phoneSync: 300, // phone-scheduled-sync   '*/5 * * * *'
  phoneProcessing: 120, // phone-processing  '*/2 * * * *'
  emailGmail: 300, // email-scheduled-sync  '*/5 * * * *'
  emailWorkspace: 300, // email-workspace-.. '*/5 * * * *'
  emailWorkspaceBackfill: 900, // backfill   '*/15 * * * *'
  interactions: 300, // interactions        '*/5 * * * *'
} as const;

/** The single staleness threshold: cadence × multiplier, in seconds. */
export function staleAfterSec(expectedIntervalSec: number): number {
  return expectedIntervalSec * HEALTH_STALE_MULTIPLIER;
}

/** Same threshold in milliseconds. */
export function staleAfterMs(expectedIntervalSec: number): number {
  return staleAfterSec(expectedIntervalSec) * 1000;
}
