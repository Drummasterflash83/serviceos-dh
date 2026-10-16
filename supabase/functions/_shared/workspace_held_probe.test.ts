import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRecheckHeldMailbox } from "./workspace_held_probe.ts";

const now = Date.parse("2026-10-16T18:00:00Z");
const held = { state: "blocked", block_code: "admin_delegation_missing" };
test("only an exact delegation hold receives a bounded read-only recheck", () => {
  assert.equal(shouldRecheckHeldMailbox(held, [], now), true);
  assert.equal(shouldRecheckHeldMailbox({ ...held, block_code: "persistence_failed" }, [], now), false);
  assert.equal(shouldRecheckHeldMailbox({ ...held, state: "ready" }, [], now), false);
  assert.equal(shouldRecheckHeldMailbox(null, [], now), false);
});
test("cooldown and two-hour attempt budget prevent repeated provider calls", () => {
  assert.equal(shouldRecheckHeldMailbox(held, ["2026-10-16T17:50:00Z"], now), false);
  assert.equal(shouldRecheckHeldMailbox(held, ["2026-10-16T17:44:59Z"], now), true);
  assert.equal(shouldRecheckHeldMailbox(held, ["2026-10-16T17:30:00Z", "2026-10-16T17:00:00Z"], now), false);
  assert.equal(shouldRecheckHeldMailbox(held, ["invalid"], now), false);
  assert.equal(shouldRecheckHeldMailbox(held, ["2026-10-16T18:01:00Z"], now), false);
});
