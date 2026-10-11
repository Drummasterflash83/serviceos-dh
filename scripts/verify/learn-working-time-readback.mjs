import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWorkingTimeItem } from "../../src/lib/learn-working-time.ts";
const rows = JSON.parse(
  readFileSync(0, "utf8")
    .split("\n")
    .find((s) => s.startsWith("[")),
);
const expected = {
  "partial-work": null,
  "partial-calendar": null,
  "dst-fold": 120,
  "dst-gap": 0,
  member: 240,
  "team-a": 90,
  "team-b": 150,
  "reversed-delays": 360,
  "missing-calendar": null,
  "missing-work": null,
  "direct-team": 240,
  microseconds: 0.000000083333,
};
assert.equal(rows.length, Object.keys(expected).length);
for (const row of rows) {
  const d = row.result;
  const scope = {
    tenantId: "aaa40000-0000-0000-0000-000000000004",
    objectId: "de1a0000-0000-4000-8000-000000000001",
    subject: d.subject,
    period: d.period,
    observedAt:
      row.name === "dst-fold"
        ? "2026-11-02T00:00:00Z"
        : row.name === "dst-gap"
          ? "2027-03-29T00:00:00Z"
          : "2026-10-06T00:00:00Z",
    states: d.states,
  };
  const snapshots = { calendar: row.calendar, delays: row.delays };
  const parsed = parseWorkingTimeItem(d, scope, snapshots);
  assert.equal(parsed.value, expected[row.name], row.name);
  for (const patch of [
    { assessedMicros: "999" },
    { knownValue: 999 },
    { complete: !d.complete },
    { value: 999 },
    { delayThrough: 999 },
    { states: ["invented"] },
    { unit: "hours" },
  ])
    assert.throws(() => parseWorkingTimeItem({ ...d, ...patch }, scope, snapshots));
  if (d.segments.length) {
    const segment = structuredClone(d.segments[0]);
    segment.assessedWindows = [{ start: d.period.start, end: d.period.end }];
    assert.throws(() =>
      parseWorkingTimeItem({ ...d, segments: [segment, ...d.segments.slice(1)] }, scope, snapshots),
    );
  }
}
console.log(
  "Actual SQL working-time results independently verified at microsecond precision: PASS (12 cases plus corrupted-result denials)",
);
