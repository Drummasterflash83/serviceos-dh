import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkingTimeItem,
  workingMinutes,
  type WorkingTimeScope,
} from "./learn-working-time.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: WorkingTimeScope = {
  tenantId: id(1),
  objectId: id(2),
  subject: { kind: "member", id: id(3) },
  period: { start: "2026-10-05T08:00:00Z", end: "2026-10-05T10:00:00Z" },
  observedAt: "2026-10-06T00:00:00Z",
  states: ["waiting"],
};
const hours = [{ start: "2026-10-05T09:00:00Z", end: scope.period.end }];
const cuts = [{ start: "2026-10-05T09:15:00Z", end: "2026-10-05T09:30:00Z" }];
const remaining = [
  { start: hours[0].start, end: cuts[0].start },
  { start: cuts[0].end, end: scope.period.end },
];
const calendar = {
  contract: "work-calendar-snapshot@1",
  tenantId: scope.tenantId,
  period: scope.period,
  observedAt: scope.observedAt,
  complete: true,
  missing: [],
  versions: [{ publicationId: id(4), ...scope.period }],
  windows: hours,
};
const delays = {
  contract: "work-delay-snapshot@1",
  tenantId: scope.tenantId,
  objectId: scope.objectId,
  period: scope.period,
  observedAt: scope.observedAt,
  through: 1,
  approvals: [
    {
      id: id(5),
      tenantId: scope.tenantId,
      objectId: scope.objectId,
      revision: 1,
      decision: "approve",
      period: cuts[0],
      recordedAt: scope.observedAt,
    },
  ],
  windows: cuts,
};
const result = {
  ...scope,
  contract: "work-working-time-item@1",
  eligible: true,
  complete: true,
  ownershipComplete: true,
  calendarComplete: true,
  reasons: [],
  unit: "working_item_minutes",
  elapsedOwnedMicros: "7200000000",
  selectedOwnedMicros: "7200000000",
  calendarMicros: "3600000000",
  excludedMicros: "900000000",
  assessedMicros: "2700000000",
  knownValue: 45,
  value: 45,
  delayThrough: 1,
  delayApprovalIds: [id(5)],
  calendarPublicationIds: [id(4)],
  eventIds: [id(6)],
  segments: [
    {
      ownership: {
        ...scope.period,
        objectId: scope.objectId,
        status: "waiting",
        owner: `member:${scope.subject.id}`,
        workEventIds: [id(6)],
      },
      selectedState: true,
      calendarWindows: hours,
      excludedWindows: cuts,
      assessedWindows: remaining,
    },
  ],
};
const parse = (value: unknown = result, snapshots: any = { calendar, delays }, expected = scope) =>
  parseWorkingTimeItem(value, expected, snapshots);
test("working-time proof independently verifies opening hours and an approved exclusion", () => {
  assert.equal(parse().value, 45);
  assert.equal(parse().elapsedOwnedMicros, "7200000000");
});
test("microsecond conversion matches decimal numeric rounding without losing the exact integer", () => {
  assert.equal(workingMinutes(5n), 0.000000083333);
  assert.equal(workingMinutes(1n), 0.000000016667);
  assert.equal(workingMinutes(31622400000000n), 527040);
  assert.equal(workingMinutes(31622400000001n), 527040.000000016667);
  assert.throws(() => workingMinutes(-1n));
});
test("scope, period, observation, selected states and references cannot be swapped", () => {
  for (const patch of [
    { tenantId: id(9) },
    { objectId: id(9) },
    { subject: { kind: "member", id: id(9) } },
    { states: ["ready"] },
    { observedAt: "2026-10-06T00:00:00.000001Z" },
    { period: { ...scope.period, start: "2026-10-05T08:00:00.000001Z" } },
    { delayApprovalIds: [] },
    { calendarPublicationIds: [id(9)] },
    { delayThrough: 0 },
    { unit: "hours" },
  ])
    assert.throws(() => parse({ ...result, ...patch }));
  for (const patch of [
    { states: [] },
    { states: ["waiting", "waiting"] },
    { states: [" waiting"] },
    { tenantId: "" },
  ])
    assert.throws(() => parse(result, { calendar, delays }, { ...scope, ...patch }));
});
test("invented totals, double counting and altered source segments are rejected", () => {
  for (const key of [
    "elapsedOwnedMicros",
    "selectedOwnedMicros",
    "calendarMicros",
    "excludedMicros",
    "assessedMicros",
  ]) {
    assert.throws(() => parse({ ...result, [key]: "0" }));
    assert.throws(() => parse({ ...result, [key]: Number((result as any)[key]) }));
  }
  assert.throws(() => parse({ ...result, segments: [result.segments[0], result.segments[0]] }));
  for (const patch of [
    { selectedState: false },
    { calendarWindows: [] },
    { excludedWindows: [] },
    { assessedWindows: hours },
    { ownership: { ...result.segments[0].ownership, owner: `member:${id(9)}` } },
    { ownership: { ...result.segments[0].ownership, workEventIds: [id(9)] } },
    { ownership: { ...result.segments[0].ownership, start: "2026-10-05T07:59:59.999999Z" } },
  ])
    assert.throws(() => parse({ ...result, segments: [{ ...result.segments[0], ...patch }] }));
});
test("delay union cannot subtract another item's exclusions or invent an unapproved interval", () => {
  for (const patch of [
    { objectId: id(9) },
    { through: 0 },
    { approvals: [] },
    { windows: hours },
    { approvals: [delays.approvals[0], delays.approvals[0]] },
    { approvals: [{ ...delays.approvals[0], recordedAt: "2026-10-07T00:00:00Z" }] },
  ])
    assert.throws(() => parse(result, { calendar, delays: { ...delays, ...patch } }));
});
test("unknown calendar and ownership coverage withhold a value without losing known arithmetic", () => {
  const missingCalendar = {
    ...calendar,
    complete: false,
    missing: [scope.period],
    versions: [],
    windows: [],
  };
  const empty = {
    ...result,
    complete: false,
    calendarComplete: false,
    reasons: ["calendar_history_incomplete"],
    calendarPublicationIds: [],
    calendarMicros: "0",
    excludedMicros: "0",
    assessedMicros: "0",
    knownValue: 0,
    value: null,
    segments: [
      { ...result.segments[0], calendarWindows: [], excludedWindows: [], assessedWindows: [] },
    ],
  };
  assert.equal(parse(empty, { calendar: missingCalendar, delays }).value, null);
  assert.throws(() => parse({ ...empty, value: 0 }, { calendar: missingCalendar, delays }));
  const unknown = {
    ...result,
    complete: false,
    ownershipComplete: false,
    reasons: ["ownership_history_incomplete"],
    value: null,
  };
  assert.equal(parse(unknown).knownValue, 45);
  assert.throws(() => parse({ ...unknown, value: 45 }));
  assert.throws(() => parse({ ...unknown, reasons: [] }));
});
test("calendar windows must be supported by complete or explicitly missing publication intervals", () => {
  for (const patch of [
    { complete: false },
    { missing: [scope.period] },
    { versions: [] },
    { tenantId: id(9) },
    { windows: [{ start: "2026-10-05T07:00:00Z", end: scope.period.end }] },
  ])
    assert.throws(() => parse(result, { calendar: { ...calendar, ...patch }, delays }));
});
test("equivalent explicit timezone offsets preserve exact snapshot identity", () => {
  const offset = {
    ...result,
    period: { start: "2026-10-05T09:00:00+01:00", end: "2026-10-05T11:00:00+01:00" },
  };
  assert.equal(parse(offset).value, 45);
  assert.throws(() =>
    parse({ ...offset, period: { ...offset.period, start: "2026-10-05T09:00:00.000001+01:00" } }),
  );
});

test("overlapping publication periods and repeated decision revisions cannot support a receipt", () => {
  const overlapping = {
    ...calendar,
    versions: [calendar.versions[0], { ...calendar.versions[0], publicationId: id(8) }],
  };
  assert.throws(() =>
    parse({ ...result, calendarPublicationIds: [id(4), id(8)] }, { calendar: overlapping, delays }),
  );
  const duplicateRevision = {
    ...delays,
    approvals: [delays.approvals[0], { ...delays.approvals[0], id: id(8) }],
  };
  assert.throws(() =>
    parse({ ...result, delayApprovalIds: [id(5), id(8)] }, { calendar, delays: duplicateRevision }),
  );
});
