import assert from "node:assert/strict";
import test from "node:test";
import { collectRecordedAttentionPages, groupRecordedAttention } from "./new-dawn-recorded-attention.ts";
import type { OpenJobPage, OpenJobRow } from "./new-dawn-open-job-page.ts";

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

const page = (rows: OpenJobRow[], nextCursor: string | null,
  snapshotAt = "2026-10-21T11:00:00Z"): OpenJobPage => ({
  tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  actorId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  auditId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  observedAt: "2026-10-21T11:00:01Z", snapshotAt,
  statusFilter: null, rows, nextCursor, creationOrderAvailable: true,
});

test("paged attention scan keeps one snapshot and stops at the first Open job", async () => {
  const cursors: Array<string | null> = [];
  const pages = [page([row("1", "20", "Example")], "next"),
    page([row("2", "20", "Example", undefined, "pending"),
      row("3", "20", "Example", undefined, "open")], "unneeded")];
  const result = await collectRecordedAttentionPages(async (cursor) => {
    cursors.push(cursor);
    return pages[cursors.length - 1];
  });
  assert.deepEqual(cursors, [null, "next"]);
  assert.deepEqual(result.rows.map((item) => item.external_id), ["1", "2"]);
  assert.equal(result.complete, true);
});

test("paged attention scan labels its cap and rejects drift, repeats and status regression", async () => {
  const first = page([row("1", "20", "Example")], "next");
  const capped = await collectRecordedAttentionPages(async () => first, 1);
  assert.equal(capped.complete, false);
  await assert.rejects(collectRecordedAttentionPages(async (cursor) =>
    cursor ? page([row("2", "20", "Example")], null, "2026-10-21T11:01:00Z") : first));
  await assert.rejects(collectRecordedAttentionPages(async (cursor) =>
    cursor ? page([row("1", "20", "Example")], null) : first));
  await assert.rejects(collectRecordedAttentionPages(async (cursor) =>
    cursor ? page([row("3", "20", "Example")], null) :
      page([row("2", "20", "Example", undefined, "pending")], "next")));
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
