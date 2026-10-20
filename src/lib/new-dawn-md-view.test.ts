import assert from "node:assert/strict";
import test from "node:test";
import { drummondsTenantId, readMdViewReceipt } from "./new-dawn-md-view.ts";

const actor = "11111111-1111-4111-8111-111111111111";
const now = Date.now();
const response = {
  version: "new-dawn-drummonds-md-view/1",
  tenant_id: drummondsTenantId, actor_id: actor,
  audit_id: "22222222-2222-4222-8222-222222222222",
  opened_at: new Date(now).toISOString(),
  expires_at: new Date(now + 15 * 60_000).toISOString(), read_only: true,
};

test("MD presentation needs a fresh, actor-scoped, read-only audit receipt", () => {
  assert.equal(readMdViewReceipt(response, actor, now).actorId, actor);
  assert.throws(() => readMdViewReceipt({ ...response, actor_id: drummondsTenantId }, actor, now));
  assert.throws(() => readMdViewReceipt({ ...response, tenant_id: actor }, actor, now));
  assert.throws(() => readMdViewReceipt({ ...response, read_only: false }, actor, now));
  assert.throws(() => readMdViewReceipt(response, actor, now + 15 * 60_000));
});
