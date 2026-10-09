import { test } from "node:test";
import assert from "node:assert/strict";
import { failJob, enqueueJob } from "./platform_queue.ts";
test("provider retry minimum never shortens queue backoff, and terminal errors stay terminal", async () => {
  for (const [minimum, retryable, delay] of [
    [120, true, 120],
    [10, true, 60],
    [undefined, true, 60],
    [-2, true, 60],
    [120, false, null],
  ] as const) {
    let update: any;
    const db: any = {
      from: () => ({
        update: (value: any) => {
          update = value;
          return { eq: async () => ({ error: null }) };
        },
      }),
    };
    const start = Date.now();
    const result = await failJob(
      db,
      { id: "fixture", attempt: 1, maxAttempts: 5 },
      { errorCode: "provider", message: "safe", retryable, retryAfterSeconds: minimum },
    );
    assert.equal(result, delay === null ? "dead_letter" : "retrying");
    if (delay !== null) {
      assert.ok(Date.parse(update.available_at) >= start + delay * 1000);
      assert.ok(Date.parse(update.available_at) <= Date.now() + delay * 1000);
      assert.equal(update.next_run_at, update.available_at);
    } else assert.equal(update.available_at, undefined);
  }
});
test("scheduled continuation time survives enqueue", async () => {
  let row: any;
  const db: any = {
    from: () => ({
      insert: (value: any) => {
        row = value;
        return {
          select: () => ({ single: async () => ({ data: { id: "fixture" }, error: null }) }),
        };
      },
    }),
  };
  await enqueueJob(db, {
    tenantId: "fixture-tenant",
    jobType: "slack.history_sync",
    jobKey: "fixture",
    availableAt: "2026-10-09T12:01:00.000Z",
  });
  assert.equal(row.available_at, "2026-10-09T12:01:00.000Z");
});
