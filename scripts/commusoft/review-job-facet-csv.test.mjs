import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FACET_COLUMNS, VISIT_COLUMNS_V2 } from "./prepare-job-facet-csv.mjs";
import { reviewJobFacetCsv } from "./review-job-facet-csv.mjs";

const base = { tenant_id: "00000000-0000-4000-8000-000000000001",
  connection_id: "00000000-0000-4000-8000-000000000002",
  source: "commusoft_csv", exported_at: "2026-10-19T09:00:00Z" };
const csv = (facet, rows) => [FACET_COLUMNS[facet].join(","), ...rows].join("\n") + "\n";
const visitV2 = { ...base, exported_at: '2026-10-20T09:00:00Z',
  facet: 'visits', contract: 'commusoft_visit_export/2',
  visit_export: { source_account_ref: 'drummonds-v2',
    covered_from: '2026-10-01T00:00:00+01:00', covered_to: '2026-10-20T00:00:00+01:00',
    source_timezone: 'Europe/London', coverage: 'complete_window',
    event_id_semantics: 'event_level_appointment_id', job_id_semantics: 'v2_jobs_id',
    correction_policy: 'same_id_newer_updated_at', field_dictionary_sha256: 'a'.repeat(64) } };

test('current visit export remains held while source ownership and semantics are checked', () => {
  const input = [VISIT_COLUMNS_V2.join(','),
    'event-1,955,001,2026-10-18T09:00:00+01:00,2026-10-18T10:00:00+01:00,user-2,Booked,,2026-10-19T11:00:00+01:00',
  ].join('\n') + '\n';
  const report = reviewJobFacetCsv(visitV2, input);
  assert.equal(report.version, 'commusoft-job-facet-review/2');
  assert.equal(report.freshness.record_updated_at, 'source_text_held');
  assert.equal(report.publication, 'off');
  assert.equal(report.records[0].shape, 'ready_for_source_review');
  assert.ok(report.records[0].hold_reasons.includes('export_scope_unverified'));
  assert.equal(JSON.stringify(report).includes('user-2'), false);
  const incomplete = reviewJobFacetCsv({ ...visitV2, visit_export: {
    ...visitV2.visit_export, coverage: 'partial_window', correction_policy: 'unknown',
  } }, input);
  assert.equal(incomplete.records[0].shape, 'needs_source_fields');
  assert.ok(incomplete.records[0].hold_reasons.includes('export_window_incomplete'));
  assert.ok(incomplete.records[0].hold_reasons.includes('correction_behavior_unknown'));
  const outOfWindow = reviewJobFacetCsv(visitV2, [VISIT_COLUMNS_V2.join(','),
    'event-2,955,001,2026-10-21T09:00:00+01:00,2026-10-21T10:00:00+01:00,user-2,Booked,,2026-10-21T11:00:00+01:00',
  ].join('\n') + '\n');
  assert.equal(outOfWindow.records[0].shape, 'needs_source_fields');
  assert.ok(outOfWindow.records[0].hold_reasons.includes('event_outside_export_window'));
  assert.ok(outOfWindow.records[0].hold_reasons.includes('event_updated_after_export'));
});

test("visit with an exact source job ID stays held until event and job authority are reviewed", () => {
  const report = reviewJobFacetCsv({ ...base, facet: "visits" }, csv("visits", [
    "event-1,955,001,2026-10-18T09:00:00+01:00,2026-10-18T10:00:00+01:00,user-2,Booked",
  ]));
  assert.equal(report.publication, "off");
  assert.equal(report.counts.held, 1);
  assert.equal(report.records[0].shape, "ready_for_source_review");
  assert.deepEqual(report.records[0].hold_reasons, [
    "parent_job_link_unreviewed", "event_id_semantics_unverified",
    "visit_status_unreviewed", "source_engineer_unmapped",
  ]);
  assert.equal(report.records[0].job_external_id, "955");
  assert.equal(report.freshness.record_updated_at, "not_supplied");
  assert.equal(JSON.stringify(report).includes("user-2"), false);
});

test("historical diary-like times and missing parent ID remain held for source fields", () => {
  const report = reviewJobFacetCsv({ ...base, facet: "visits" }, csv("visits", [
    "event-2,,008,2026-10-18 09:00:00,2026-10-18 10:00:00,,Complete",
    "event-3,955,001,2026-10-18T10:00:00Z,2026-10-18T09:00:00Z,,Complete",
  ]));
  assert.equal(report.counts.needs_source_fields, 2);
  assert.ok(report.records[0].hold_reasons.includes("parent_job_id_missing"));
  assert.ok(report.records[0].hold_reasons.includes("visit_start_end_unverified"));
  assert.ok(report.records[1].hold_reasons.includes("visit_start_end_unverified"));
  assert.equal(report.records[0].job_external_id, null);
});

test("syntactically zoned but invalid visit time cannot be ready for source review", () => {
  const report = reviewJobFacetCsv({ ...base, facet: "visits" }, csv("visits", [
    "event-4,955,001,2026-10-18T99:00:00Z,2026-10-18T10:00:00Z,,Booked",
    "event-5,955,001,2026-10-18T09:00:00Z,2026-10-18T99:00:00Z,,Booked",
  ]));
  assert.equal(report.counts.needs_source_fields, 2);
  for (const row of report.records) {
    assert.equal(row.shape, "needs_source_fields");
    assert.ok(row.hold_reasons.includes("visit_start_end_unverified"));
  }
});

test("engineer, estimate, invoice and parts rows do not become staff or money claims", () => {
  const engineer = reviewJobFacetCsv({ ...base, facet: "engineers" }, csv("engineers", [
    "user-1,Alex,Active",
  ]));
  assert.ok(engineer.records[0].hold_reasons.includes("openfolk_staff_link_absent"));
  for (const facet of ["estimates", "invoices"]) {
    const report = reviewJobFacetCsv({ ...base, facet }, csv(facet, [
      "doc-1,955,001,2026-10-18T09:00:00Z,Issued,100.00,GBP",
    ]));
    assert.equal(report.records[0].state, "held");
    assert.ok(report.records[0].hold_reasons.includes("job_document_link_unverified"));
    assert.equal(JSON.stringify(report).includes("100.00"), false);
  }
  const part = reviewJobFacetCsv({ ...base, facet: "parts_costs" }, csv("parts_costs", [
    "line-1,955,001,Valve,2,10.50,GBP",
  ]));
  assert.ok(part.records[0].hold_reasons.includes("line_item_and_cost_semantics_unreviewed"));
  assert.equal(part.records[0].state, "held");
});

test("invalid financial shape stays held and CLI writes only private review output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m2-facet-review-"));
  try {
    const manifest = { ...base, facet: "invoices" };
    const input = csv("invoices", ["doc-1,955,001,2026-10-18 09:00:00,Issued,1,000.00,GBP"]);
    assert.throws(() => reviewJobFacetCsv(manifest, input), /csv_columns_invalid/);
    const valid = csv("invoices", ["doc-1,955,001,2026-10-18 09:00:00,Issued,unknown,gbp"]);
    const scope = join(dir, "scope.json"), file = join(dir, "source.csv"), out = join(dir, "review.json");
    await writeFile(scope, JSON.stringify(manifest));
    await writeFile(file, valid);
    const stdout = JSON.parse(execFileSync(process.execPath, [
      new URL("./review-job-facet-csv.mjs", import.meta.url).pathname,
      "--manifest", scope, "--csv", file, "--out", out,
    ], { encoding: "utf8" }));
    assert.deepEqual(stdout.counts, { rows: 1, held: 1,
      ready_for_source_review: 0, needs_source_fields: 1 });
    assert.equal(stdout.records, undefined);
    assert.equal((await stat(out)).mode & 0o777, 0o600);
    assert.ok(JSON.parse(await readFile(out, "utf8")).records[0].hold_reasons
      .includes("amount_or_currency_shape_unverified"));
    assert.throws(() => execFileSync(process.execPath, [
      new URL("./review-job-facet-csv.mjs", import.meta.url).pathname,
      "--manifest", scope, "--csv", file, "--out", out,
    ], { stdio: "pipe" }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
