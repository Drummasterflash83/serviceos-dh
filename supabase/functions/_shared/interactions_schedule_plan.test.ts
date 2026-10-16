import { test } from "node:test";
import assert from "node:assert/strict";
import { interactionProjectionSchedule } from "./interactions_schedule_plan.ts";

test("scheduled projection isolates Email from Phone and retains both sources", () => {
  const tenant = "00000000-0000-0000-0000-000000000001";
  const plan = interactionProjectionSchedule(tenant);
  assert.deepEqual(plan.map((entry) => entry.payload.source), ["phone", "email"]);
  assert.deepEqual(plan.map((entry) => entry.jobKey), [
    `interactions.sync:${tenant}:phone`, `interactions.sync:${tenant}:email`,
  ]);
  assert.equal(new Set(plan.map((entry) => entry.jobKey)).size, 2);
  assert.ok(plan.every((entry) => entry.tenantId === tenant &&
    entry.jobType === "interactions.sync" && entry.connectorId === "openfolk-core"));
  assert.equal(plan[0].payload.limit, 100);
  assert.equal(plan[1].payload.limit, 200);
  assert.deepEqual(plan.map((entry) => entry.priority), [50, 50]);
});
