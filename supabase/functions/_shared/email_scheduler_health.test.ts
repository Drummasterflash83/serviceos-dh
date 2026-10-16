import assert from "node:assert/strict";
import test from "node:test";
import { emptySchedulerCounts, recordSchedulerHeartbeat } from "./email_scheduler_health.ts";

test("a held capture is reported as a recovery failure while eligible work stays scheduled", async () => {
  let inserted: Record<string, unknown> | null = null;
  const db = { from: (table: string) => {
    assert.equal(table, "email_sync_runs");
    return { insert: async (row: Record<string, unknown>) => {
      inserted = row;
      return { error: null };
    } };
  } };
  const counts = { ...emptySchedulerCounts(), queued: 3 };
  assert.equal(await recordSchedulerHeartbeat(db as never, "tenant-1",
    "workspace_scheduled_sync", counts, {}, false, 0, 2), true);
  assert.equal(inserted?.status, "failed");
  assert.equal(inserted?.error_message, "Saved mailboxes need capture recovery review");
  assert.equal((inserted?.metadata as Record<string, unknown>)?.held_recovery, 2);
  assert.equal(inserted?.records_processed, 3);
});
