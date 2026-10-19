import test from "node:test";
import assert from "node:assert/strict";
import { CommusoftThrottle } from "./retry_after.ts";

test("provider retry header is bounded and malformed values use a safe delay", () => {
  const now = Date.parse("2026-10-19T16:00:00Z");
  assert.equal(new CommusoftThrottle("120", now).retryAt, now + 120000);
  assert.equal(new CommusoftThrottle("999999", now).retryAt, now + 3600000);
  assert.equal(new CommusoftThrottle("-10", now).retryAt, now + 60000);
  assert.equal(new CommusoftThrottle(null, now).retryAt, now + 60000);
  assert.equal(new CommusoftThrottle("0", now).retryAt, now + 1000);
});
