import test from "node:test";
import assert from "node:assert/strict";
import { careHealth, type CareSummary } from "./care-health.ts";
const now = Date.parse("2026-09-28T10:00:00Z");
const sample = (): CareSummary => ({
  monitoring: { enabled: true, last_scan_at: new Date(now).toISOString(), scan_state: "complete" },
  reviews: { observed: 5, reviewed: 5, queued: 0, processing: 0, failed: 0, awaiting_evidence: 0 },
  alerts: { pending: 0, failed: 0, delivery_unknown: 0, sent: 1 },
  practice: { total: 2, completed: 1, with_feedback: 1 },
});
test("disabled, missing, stale and failed monitoring never look healthy", () => {
  for (const m of [
    { enabled: false },
    { last_scan_at: null },
    { last_scan_at: "2026-09-27T10:00:00Z" },
    { scan_error: "review_credit_required" },
  ]) {
    const s = sample();
    Object.assign(s.monitoring, m);
    assert.notEqual(careHealth(s, now).tone, "good");
  }
});
test("unknown Slack delivery is not successful care", () => {
  const s = sample();
  s.alerts.delivery_unknown = 1;
  assert.equal(careHealth(s, now).tone, "attention");
});
test("empty observed population is awaiting evidence, never 100 percent", () => {
  const s = sample();
  s.reviews.observed = 0;
  s.reviews.reviewed = 0;
  assert.equal(careHealth(s, now).tone, "waiting");
});
test("backlog and missing evidence remain visible", () => {
  const s = sample();
  s.reviews.awaiting_evidence = 1;
  assert.equal(careHealth(s, now).tone, "working");
});
test("completed recent checks say only what the evidence supports", () => {
  assert.equal(careHealth(sample(), now).title, "Last check complete");
  assert.match(careHealth(sample(), now).detail, /not an audio-quality guarantee/);
});
