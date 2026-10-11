import test from "node:test";
import assert from "node:assert/strict";
import { readSchedulerHealth, SCHEDULERS } from "./scheduler-health-reader.ts";
const tenant = "00000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-10-11T14:00:00Z");
function response() {
  return {
    version: "learn-scheduler-health/1",
    tenant_id: tenant,
    checked_at: new Date(now).toISOString(),
    rows: SCHEDULERS.map((d) => ({
      name: d.name,
      observed_at: null as string | null,
      status: null as string | null,
      capture_paused: null as number | null,
      enqueue_unconfirmed: null as number | null,
      inventory_unavailable: null as boolean | null,
    })),
  };
}
const db = (data: unknown) => ({
  async rpc(name: string, args: { p_tenant: string }) {
    assert.equal(name, "learn_scheduler_health_read");
    assert.equal(args.p_tenant, tenant);
    return { data, error: null };
  },
});
test("one company-bound RPC returns ten distinct scheduling summaries", async () => {
  const body = response();
  body.rows[0].status = "failed";
  body.rows[0].observed_at = new Date(now - 1000).toISOString();
  body.rows[2].status = "success";
  body.rows[2].observed_at = new Date(now - 1000).toISOString();
  body.rows[2].capture_paused = 1;
  const r = await readSchedulerHealth(db(body), tenant, now);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.length, 10);
    assert.equal(r.data[0].status, "failed");
    assert.equal(r.data[2].status, "paused");
    assert.equal(r.data[1].status, "never");
  }
});
test("foreign tenant, malformed and incomplete responses never become healthy or empty", async () => {
  const mutations: Array<(x: ReturnType<typeof response>) => void> = [
    (x) => {
      x.tenant_id = "00000000-0000-4000-8000-000000000002";
    },
    (x) => {
      x.version = "old";
    },
    (x) => {
      x.rows.pop();
    },
    (x) => {
      x.rows[1] = x.rows[0];
    },
    (x) => {
      x.rows[0].name = "unknown";
    },
    (x) => {
      x.rows[0].status = "invented";
    },
    (x) => {
      x.rows[0].capture_paused = -1;
    },
    (x) => {
      x.rows[0].observed_at = "invalid";
    },
    (x) => {
      x.checked_at = new Date(now + 61000).toISOString();
    },
    (x) => {
      Object.assign(x.rows[0], { private: "PRIVATE" });
    },
  ];
  for (const mutate of mutations) {
    const body = response();
    mutate(body);
    const r = await readSchedulerHealth(db(body), tenant, now);
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
});
test("database errors, thrown errors and absent scope are safe failures", async () => {
  for (const client of [
    { rpc: async () => ({ data: null, error: { message: "PRIVATE" } }) },
    {
      rpc: async () => {
        throw Error("PRIVATE");
      },
    },
  ]) {
    const r = await readSchedulerHealth(client, tenant, now);
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
  assert.equal(
    (
      await readSchedulerHealth(
        {
          rpc: async () => {
            throw Error("Must not request");
          },
        },
        "",
        now,
      )
    ).ok,
    false,
  );
});
