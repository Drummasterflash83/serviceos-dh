import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  parseWorkCalendarRead,
  parseWorkCalendarPreview,
} from "../../src/lib/learn-work-calendars.ts";
import {
  prepareCalendarDraft,
  parseCalendarResolution,
} from "../../src/lib/learn-work-calendar-outbox.ts";
import { measureDeskTime } from "../../src/lib/learn-scorecards.ts";
const line = readFileSync(0, "utf8")
  .split("\n")
  .find((s) => s.startsWith("{"));
assert.ok(line, "Actual SQL JSON output required");
const d = JSON.parse(line),
  tenant = "aaa40000-0000-0000-0000-000000000004";
const read = parseWorkCalendarRead(d.read, tenant);
assert.equal(read.draft.revision, 2);
assert.equal(read.publication.version.revision, 2);
const period = { start: "2026-10-05T00:00:00Z", end: "2026-10-12T00:00:00Z" };
const preview = parseWorkCalendarPreview(
  d.preview,
  tenant,
  "ca140000-0000-4000-8000-000000000001",
  period,
);
assert.equal(preview.minutes, 1920);
const result = measureDeskTime({
  period,
  ownership: [period],
  businessHours: preview.windows,
  approvedExclusions: [],
});
assert.equal(result.businessMinutes, 1920);
assert.equal(result.assessedMinutes, 1920);
assert.equal(d.snapshot.complete, false);
assert.equal(d.snapshot.versions.length, 1);
assert.equal(d.snapshot.versions[0].revision, 1);
console.log(
  "Actual SQL calendar read/preview parsing, historical snapshot and desk-time interval integration: PASS",
);

const scope = {
  backend: "https://synthetic.invalid",
  tenantId: tenant,
  actorId: "bbb40000-0000-0000-0000-000000000004",
};
const draft = prepareCalendarDraft(scope, {
  kind: "save",
  requestId: "ca140000-0000-4000-8000-000000000001",
  payload: {
    expectedRevision: 0,
    definition: preview.version.definition,
    reason: "Initial company hours",
  },
});
assert.equal(parseCalendarResolution(d.resolution, scope, draft, false).state, "recorded");
console.log("Actual SQL calendar resolution passes exact client recovery parsing: PASS");
