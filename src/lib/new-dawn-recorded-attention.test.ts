import assert from "node:assert/strict";
import test from "node:test";
import { groupRecordedAttention } from "./new-dawn-recorded-attention.ts";
import type { OpenJobRow } from "./new-dawn-open-job-page.ts";

const row = (id: string, customerId: string | null, name: string | null,
  connection = "11111111-1111-1111-1111-111111111111",
  status: OpenJobRow["status"] = "on_hold"): OpenJobRow => ({
  connection_id: connection, external_id: id,
  source_version_id: "22222222-2222-2222-2222-222222222222",
  source_observed_at: "2026-10-21T11:00:00Z", job_created_at: null,
  status_first_saved_at: "2026-10-21T11:00:00Z",
  status_evidence: "timing_unknown", status, title: null,
  source_customer: name, source_site: "A recorded site", source_postcode: null,
  property_external_id: "40", customer_external_id: customerId,
  context_state: customerId ? "source_customer_and_property" : "source_property_missing",
  identity_state: "awaiting_review",
});

test("exact provider customer ID groups jobs across sites without claiming a canonical link", () => {
  const result = groupRecordedAttention([
    row("1", "20", "Example Ltd"),
    row("2", "20", "Example Ltd", undefined, "pending"),
    row("3", "21", "Example Ltd"),
    row("4", "20", "Example Ltd", "33333333-3333-3333-3333-333333333333"),
  ], new Set());
  assert.equal(result.groups.length, 3);
  assert.equal(result.groups[0].onHold, 1);
  assert.equal(result.groups[0].pending, 1);
  assert.equal(result.groups[0].jobs.length, 2);
  assert.equal(result.shown, 4);
});

test("changed source names and missing parents remain separate; confirmed jobs are excluded", () => {
  const result = groupRecordedAttention([
    row("1", "20", "First name"), row("2", "20", "Different name"),
    row("3", null, "Unresolved"), row("4", "30", "Confirmed"),
  ], new Set(["11111111-1111-1111-1111-111111111111:4:22222222-2222-2222-2222-222222222222"]));
  assert.equal(result.groups.length, 0);
  assert.equal(result.ungrouped.length, 3);
  assert.equal(result.excludedConfirmed, 1);
  assert.equal(result.shown, 3);
});

test("a confirmed old source version never hides a changed current job", () => {
  const result = groupRecordedAttention([row("4", "30", "Example")],
    new Set(["11111111-1111-1111-1111-111111111111:4:33333333-3333-3333-3333-333333333333"]));
  assert.equal(result.shown, 1);
  assert.equal(result.excludedConfirmed, 0);
});

test("duplicate or non-attention pages fail instead of inflating customer work", () => {
  assert.throws(() => groupRecordedAttention([row("1", "20", "Example"),
    row("1", "20", "Example")], new Set()), /repeated job/);
  assert.throws(() => groupRecordedAttention([row("2", "20", "Example",
    undefined, "open")], new Set()), /non-attention/);
});
