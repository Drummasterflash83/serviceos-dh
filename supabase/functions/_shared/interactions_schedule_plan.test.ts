import { test } from "node:test";
import assert from "node:assert/strict";
import { interactionProjectionSchedule } from "./interactions_schedule_plan.ts";

test("scheduled projection gives current Email its own bounded lane", () => {
  const tenant = "00000000-0000-0000-0000-000000000001";
  const plan = interactionProjectionSchedule(tenant);
  assert.deepEqual(plan.map((entry) => entry.payload.source), ["email", "phone", "email"]);
  assert.deepEqual(plan.map((entry) => entry.jobKey), [
    `interactions.sync:${tenant}:email:current`,
    `interactions.sync:${tenant}:phone`, `interactions.sync:${tenant}:email`,
  ]);
  assert.equal(new Set(plan.map((entry) => entry.jobKey)).size, 3);
  assert.ok(plan.every((entry) => entry.tenantId === tenant &&
    entry.jobType === "interactions.sync" && entry.connectorId === "openfolk-core"));
  assert.deepEqual(plan[0].payload, { source: "email", lane: "current", limit: 50 });
  assert.equal(plan[1].payload.limit, 100);
  assert.equal(plan[2].payload.limit, 10);
  assert.deepEqual(plan.map((entry) => entry.priority), [40, 50, 50]);
});
