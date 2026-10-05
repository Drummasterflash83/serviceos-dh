import assert from "node:assert/strict";
import test from "node:test";

import { nextLocalHourValue, toServerLocalDateTime } from "./schedule.ts";

test("converts a browser date and time to the governed local schedule format", () => {
  assert.equal(toServerLocalDateTime("2026-08-04T09:30"), "2026-08-04 09:30");
  assert.equal(toServerLocalDateTime("2026-08-04 09:30"), null);
  assert.equal(toServerLocalDateTime(""), null);
});

test("defaults to the next whole local hour", () => {
  assert.equal(nextLocalHourValue(new Date(2026, 7, 3, 18, 42)), "2026-08-03T19:00");
});
