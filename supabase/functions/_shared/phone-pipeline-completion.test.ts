import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmPhonePipelineCompletion } from "./phone-pipeline-completion.ts";
const input = {
  tenantId: "tenant-one",
  runId: "run-one",
  status: "success" as const,
  recordsProcessed: 1,
  metadata: { recording_id: "recording-one", trace: { analysed: true, count: 1 } },
  errorMessage: null,
};
function database(mutate: (row: any) => any = (row) => row, lostReply = false) {
  let row: any,
    writes = 0,
    reads = 0;
  const db = {
    from(table: string) {
      assert.equal(table, "phone_sync_runs");
      let patch: any;
      const filters: any[] = [];
      const q: any = {
        update(value: any) {
          patch = value;
          return q;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return q;
        },
        select() {
          return q;
        },
        async maybeSingle() {
          const expected = [
            ["id", input.runId],
            ["tenant_id", input.tenantId],
            ["provider", "pipeline"],
            ["sync_type", "pipeline"],
          ];
          assert.deepEqual(filters, patch ? [...expected, ["status", "running"]] : expected);
          if (patch) {
            writes++;
            row = mutate({
              id: input.runId,
              tenant_id: input.tenantId,
              provider: "pipeline",
              sync_type: "pipeline",
              ...patch,
            });
            if (lostReply) throw Error("private failure");
          } else reads++;
          return { data: row, error: null };
        },
      };
      return q;
    },
  };
  return { db, stats: () => ({ writes, reads }) };
}
test("terminal write uses tenant/type/running guards and accepts PostgreSQL JSON order and equivalent timestamp", async () => {
  const f = database((row) => ({
    ...row,
    completed_at: row.completed_at.replace("Z", "+00:00"),
    metadata: { trace: { count: 1, analysed: true }, recording_id: "recording-one" },
  }));
  assert.equal(await confirmPhonePipelineCompletion(f.db, input), true);
  assert.deepEqual(f.stats(), { writes: 1, reads: 0 });
});
test("lost write reply recovers only the exact saved attempt, with no repeated mutation", async () => {
  const f = database((row) => row, true);
  assert.equal(await confirmPhonePipelineCompletion(f.db, input), true);
  assert.deepEqual(f.stats(), { writes: 1, reads: 1 });
});
test("foreign, missing, conflicting and stale terminal rows cannot confirm completion", async () => {
  for (const mutate of [
    () => null,
    (r: any) => ({ ...r, id: "other" }),
    (r: any) => ({ ...r, tenant_id: "other" }),
    (r: any) => ({ ...r, provider: "simwood" }),
    (r: any) => ({ ...r, sync_type: "recordings" }),
    (r: any) => ({ ...r, status: "failed" }),
    (r: any) => ({ ...r, records_processed: 0 }),
    (r: any) => ({ ...r, error_message: "different" }),
    (r: any) => ({ ...r, metadata: {} }),
    (r: any) => ({ ...r, completed_at: "2020-01-01T00:00:00Z" }),
  ]) {
    const f = database(mutate, true);
    assert.equal(await confirmPhonePipelineCompletion(f.db, input), false);
    assert.deepEqual(f.stats(), { writes: 1, reads: 1 });
  }
});
