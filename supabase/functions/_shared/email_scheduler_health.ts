import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { EnqueueInput, EnqueueResult } from "./platform_queue.ts";

export type SchedulerCounts = {
  queued: number;
  duplicates: number;
  paused: number;
  unconfirmed: number;
};
export const emptySchedulerCounts = (): SchedulerCounts => ({
  queued: 0,
  duplicates: 0,
  paused: 0,
  unconfirmed: 0,
});

/** An unknown enqueue outcome must not be presented as a successful no-op. */
export async function scheduleAndCount(
  client: SupabaseClient,
  input: EnqueueInput,
  counts: SchedulerCounts,
  enqueue: (client: SupabaseClient, input: EnqueueInput) => Promise<EnqueueResult>,
): Promise<void> {
  try {
    const result = await enqueue(client, input);
    if (result.captureWaiting === "paused") counts.paused++;
    else if (result.captureWaiting || !result.id) counts.unconfirmed++;
    else if (result.duplicate) counts.duplicates++;
    else counts.queued++;
  } catch {
    // Exceptions can include database/provider details. Only retain the category.
    counts.unconfirmed++;
  }
}

export async function recordSchedulerHeartbeat(
  client: SupabaseClient,
  tenantId: string,
  syncType: "scheduled_sync" | "workspace_scheduled_sync" | "workspace_backfill_scheduled",
  counts: SchedulerCounts,
  metadata: Record<string, number> = {},
  readFailure = false,
  knownIneligible = 0,
): Promise<boolean> {
  const now = new Date().toISOString();
  const failed = readFailure || counts.unconfirmed > 0 || knownIneligible > 0;
  try {
    const { error } = await client.from("email_sync_runs").insert({
      tenant_id: tenantId,
      provider: "gmail",
      sync_type: syncType,
      status: failed ? "failed" : "success",
      started_at: now,
      completed_at: now,
      records_processed: counts.queued,
      error_message:
        knownIneligible > 0
          ? "Saved mailboxes need source-authority reconciliation"
          : failed
            ? "Scheduler could not confirm all requested work"
            : null,
      metadata: {
        heartbeat: true,
        ...metadata,
        queued: counts.queued,
        duplicates: counts.duplicates,
        capture_paused: counts.paused,
        enqueue_unconfirmed: counts.unconfirmed,
        inventory_unavailable: readFailure,
        known_ineligible: knownIneligible,
      },
    });
    return !error;
  } catch {
    return false;
  }
}
