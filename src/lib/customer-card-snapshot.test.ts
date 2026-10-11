import test from "node:test";
import assert from "node:assert/strict";
import { describeCustomerCardSnapshot } from "./customer-card-snapshot.ts";
const now = Date.parse("2026-10-11T15:00:00Z");
test("missing, malformed and future dates never imply a fresh summary", () => {
  for (const date of [null, "", {}, "invalid", "2026-10-12T00:00:00Z"]) {
    assert.equal(describeCustomerCardSnapshot(date, null, now).label, "Snapshot date not established");
  }
});
test("newer recorded activity is distinguished from the retained snapshot", () => {
  const result = describeCustomerCardSnapshot("2026-10-10T09:00:00Z", "2026-10-11T09:00:00Z", now);
  assert.match(result.label, /10\/10\/2026.*09:00:00.*UTC/);
  assert.match(result.note, /does not yet include/);
});
test("a recent summary still does not prove provider coverage", () => {
  for (const activity of [null, "invalid", "2026-10-10T09:00:00Z", "2026-10-12T00:00:00Z"])
    assert.match(describeCustomerCardSnapshot("2026-10-11T14:59:00Z", activity, now).note, /coverage has not been verified/);
});
