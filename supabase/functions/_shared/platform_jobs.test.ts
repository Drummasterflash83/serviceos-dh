import { strict as assert } from "node:assert";
import { test } from "node:test";
import { completePlatformJob, failPlatformJob, startPlatformJob } from "./platform_jobs.ts";

function client(confirmLease = true) {
  const changes: Array<{ table: string; row: Record<string, unknown>; id: string }> = [];
  return {
    changes,
    from(table: string) {
      return {
        update(row: Record<string, unknown>) {
          let id = "";
          const query = {
            eq(column: string, value: string) {
              if (column === "id") {
                id = value;
                changes.push({ table, row, id });
              } else {
                assert.equal(column, "status");
                assert.equal(value, "queued");
              }
              return query;
            },
            select(column: string) {
              assert.equal(column, "id");
              return query;
            },
            async maybeSingle() {
              return { data: confirmLease ? { id } : null, error: null };
            },
            then(resolve: (value: { error: null }) => unknown) {
              return resolve({ error: null });
            },
          };
          return query;
        },
      };
    },
  };
}

test("direct graph lease expires for worker recovery and clears on success", async () => {
  const db = client();
  const before = Date.now();
  assert.equal(await startPlatformJob(db as never, "graph-job", 1800), true);
  const after = Date.now();
  const started = db.changes.at(-1)?.row;
  assert.equal(started?.status, "running");
  const expiry = Date.parse(started?.lease_expires_at as string);
  assert.ok(expiry >= before + 1800_000 && expiry <= after + 1800_000);
  await completePlatformJob(db as never, "graph-job", { recordsProcessed: 7 });
  assert.equal(db.changes.at(-1)?.row.lease_expires_at, null);
  assert.equal(db.changes.at(-1)?.row.status, "succeeded");
});

test("unconfirmed direct graph claim cannot proceed as running", async () => {
  const db = client(false);
  assert.equal(await startPlatformJob(db as never, "graph-job", 1800), false);
});

test("failed direct graph lease clears and ordinary direct jobs stay unleased", async () => {
  const db = client();
  await startPlatformJob(db as never, "ordinary-job");
  assert.equal("lease_expires_at" in (db.changes.at(-1)?.row ?? {}), false);
  await startPlatformJob(db as never, "graph-job", 1800);
  await failPlatformJob(db as never, "graph-job", "synthetic failure");
  assert.equal(db.changes.at(-1)?.row.lease_expires_at, null);
  assert.equal(db.changes.at(-1)?.row.status, "failed");
});
