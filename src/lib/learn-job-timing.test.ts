import test from "node:test";
import assert from "node:assert/strict";
import { jobTimingGaps, jobTimingFields } from "./learn-job-timing.ts";
import { projectLearnDetail } from "./learn-cards.ts";
import { loadPerformanceEvidence } from "./learn-performance-evidence.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = () => ({
  id: id(3),
  tenant_id: id(1),
  title: "Retained job",
  status: "completed",
  created_date: "2026-01-01T12:00:00Z",
  completed_date: null,
  time_evidence: {
    created: {
      state: "zoned",
      source: "2026-01-01T13:00:00+01:00",
      instant: "2026-01-01T12:00:00.000000Z",
    },
    completed: { state: "timezone_required", source: "2026-10-25 01:30:00", instant: null },
  },
});
test("uncertain source time stays literal while a usable job card displays the limitation", () => {
  const row = fixture(),
    gaps = jobTimingGaps(row);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /Completion time has no confirmed timezone/);
  const fields = jobTimingFields(row);
  assert.match(fields[1].value, /2026-10-25 01:30:00 — source time without a timezone/);
  assert.match(fields[1].value, /Excluded/);
  const card = projectLearnDetail({
    tenant: id(1),
    kind: "job",
    record: row,
    interactions: [],
    findings: [],
    members: [],
    now: Date.now(),
  });
  assert.equal(card.card.title, "Retained job");
  assert.ok(card.gaps.includes(gaps[0]));
});
test("legacy, malformed or contradictory metadata never attests an uncertain stored instant", () => {
  for (const mutate of [
    (p: any) => delete p.time_evidence,
    (p: any) => (p.completed_date = "2026-10-25T01:30:00Z"),
    (p: any) => (p.time_evidence.completed.source = "2026-02-30 01:30:00"),
    (p: any) => (p.time_evidence.completed.instant = "2026-10-25T01:30:00Z"),
    (p: any) => (p.time_evidence.created.instant = "2026-01-01T11:00:00Z"),
    (p: any) => (p.created_date = "2026-01-01T12:00:00.000001Z"),
  ]) {
    const row = fixture();
    mutate(row);
    assert.match(jobTimingGaps(row)[0], /unavailable or conflicts/);
    assert.equal(jobTimingFields(row).length, 1);
  }
});
test("absent timestamps are unknown, never a poor performance score", () => {
  const row: any = fixture();
  row.completed_date = null;
  row.time_evidence.completed = { state: "absent", source: null, instant: null };
  assert.match(jobTimingGaps(row)[0], /not evidence of poor performance/);
  row.status = "open";
  assert.deepEqual(jobTimingGaps(row), []);
});
test("performance source reader selects only timing metadata and presents uncertainty instead of a guessed date", async () => {
  let projection = "";
  const filters: any[] = [];
  const row = fixture();
  const q: any = {
    select: (v: string) => {
      projection = v;
      return q;
    },
    eq: (...v: any[]) => {
      filters.push(v);
      return q;
    },
    limit: () => q,
    then: (fn: any) => Promise.resolve({ data: [row], error: null }).then(fn),
  };
  const fields = await loadPerformanceEvidence(
    {
      from: (table: string) => {
        assert.equal(table, "jobs");
        return q;
      },
    },
    id(1),
    { table: "jobs", id: id(3) },
  );
  assert.match(projection, /time_evidence:metadata->learn_business_input->timestamps/);
  assert.ok(!projection.split(",").includes("metadata"));
  assert.deepEqual(filters, [
    ["tenant_id", id(1)],
    ["id", id(3)],
  ]);
  assert.match(fields.find((f) => f.label === "Completion time")!.value, /timezone unconfirmed/);
  assert.ok(!fields.some((f) => f.label === "completed date"));
});
