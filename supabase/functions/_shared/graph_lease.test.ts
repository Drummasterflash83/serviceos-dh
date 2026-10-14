import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extendClaimedGraphLease } from "./platform_queue.ts";

test("graph lease extension is bounded to the exact live claim", async () => {
  const filters: Record<string, unknown> = {};
  let expiry = "";
  const query = {
    update(value: Record<string, string>) {
      expiry = value.lease_expires_at;
      return this;
    },
    eq(key: string, value: unknown) {
      filters[key] = value;
      return this;
    },
    gt(key: string, value: unknown) {
      filters[key] = value;
      return this;
    },
    select(column: string) {
      assert.equal(column, "id");
      return this;
    },
    async maybeSingle() {
      return { data: { id: "graph-job" }, error: null };
    },
  };
  const db = {
    from(table: string) {
      assert.equal(table, "platform_jobs");
      return query;
    },
  };
  const start = Date.now();
  assert.equal(
    await extendClaimedGraphLease(db as never, {
      tenantId: "tenant",
      jobId: "graph-job",
      claimedBy: "worker-one",
      attemptCount: 2,
    }),
    true,
  );
  assert.deepEqual(Object.keys(filters).sort(), [
    "attempt_count",
    "claimed_by",
    "id",
    "job_type",
    "lease_expires_at",
    "status",
    "tenant_id",
  ]);
  assert.equal(filters.claimed_by, "worker-one");
  assert.equal(filters.attempt_count, 2);
  assert.equal(filters.job_type, "graph.sync");
  assert.ok(Date.parse(expiry) >= start + 900_000);
  assert.ok(Date.parse(expiry) <= Date.now() + 900_000);
  assert.equal(
    await extendClaimedGraphLease(db as never, {
      tenantId: "tenant",
      jobId: "graph-job",
      claimedBy: "",
      attemptCount: 2,
    }),
    false,
  );
});
